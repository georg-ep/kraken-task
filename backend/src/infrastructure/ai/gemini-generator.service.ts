import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { IAIGenerator } from '../../domain/job/ai-generator.interface';
import { DependencyAnalyzerService } from '../ast/dependency-analyzer.service';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';
import { TestValidatorService } from '../validation/test-validator.service';
import { TestPromptBuilder } from './test-prompt.builder';

@Injectable()
export class GeminiGeneratorService implements IAIGenerator {
  private readonly logger = new Logger(GeminiGeneratorService.name);
  private readonly modelName: string;
  private readonly apiKey: string;

  // --- IGNORE STRATEGY (Safety) ---
  private readonly SKIP_FILES = [
    'app.ts',
    'main.ts',
    'index.ts',
    'jest.config.ts',
  ];
  private readonly SKIP_FOLDERS = [
    'interfaces',
    'dto',
    'entities',
    'migrations',
    'node_modules',
    'dist',
    'coverage',
    'types',
  ];
  private readonly SKIP_EXTENSIONS = [
    '.interface.ts',
    '.d.ts',
    '.module.ts',
    '.entity.ts',
    '.dto.ts',
    '.spec.ts',
    '.test.ts',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    private readonly sandboxExecutor: SandboxExecutorService,
    private readonly testValidator: TestValidatorService,
    private readonly promptBuilder: TestPromptBuilder,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }
    this.modelName = this.configService.get<string>(
      'GEMINI_MODEL',
      'gemini-2.0-flash-lite',
    );
  }

  async generateTest(
    sourceFilePath: string,
    testFilePath: string,
    localRepoPath: string,
    targetCoverage: number = 80,
  ): Promise<void> {
    if (this.shouldSkipFile(sourceFilePath)) {
      this.logger.debug(`Skipping excluded file: ${sourceFilePath}`);
      return;
    }

    this.logger.log(
      `Starting isolated AI CLI generation for ${sourceFilePath}...`,
    );

    const fullSourceFilePath = path.join(localRepoPath, sourceFilePath);
    const fullTestFilePath = path.join(localRepoPath, testFilePath);
    const tempTestFilePath = fullTestFilePath.replace(
      /\.(spec|test)\.ts$/,
      '.verification.test.ts',
    );

    try {
      // 1. Context Awareness (AST Analysis)
      const [sourceCode, availablePackages, dependencyContext] =
        await Promise.all([
          fs.readFile(fullSourceFilePath, 'utf8'),
          this.getPackages(localRepoPath),
          this.dependencyAnalyzer.analyze(fullSourceFilePath, localRepoPath),
        ]);

      // 2. Derive import path and dependency signatures for the prompt
      const importPath = this.getRelativeImportPath(
        sourceFilePath,
        testFilePath,
      );
      const dependencySignatures =
        this.dependencyAnalyzer.formatContext(dependencyContext);
      const systemInstruction =
        this.promptBuilder.buildSystemInstruction(targetCoverage);

      let currentError = '';
      const MAX_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        this.logger.log(
          `Attempt ${attempt}/${MAX_ATTEMPTS} for ${sourceFilePath}`,
        );

        const prompt = this.promptBuilder.buildPrompt(
          sourceFilePath,
          testFilePath,
          sourceCode,
          availablePackages,
          importPath,
          dependencySignatures,
          currentError,
        );

        // SECURE ISOLATION: Execute the Gemini CLI inside the Docker sandbox.
        // The CLI v0.29.5 uses .gemini/system.md for system instructions.
        const geminiDir = path.join(localRepoPath, '.gemini');
        const promptFile = path.join(localRepoPath, '.gemini-prompt.txt');
        const systemFile = path.join(geminiDir, 'system.md');

        await fs.mkdir(geminiDir, { recursive: true });
        await fs.writeFile(promptFile, prompt, 'utf8');
        await fs.writeFile(systemFile, systemInstruction, 'utf8');

        this.logger.debug(`Executing isolated AI CLI command in sandbox...`);
        let generatedCode = '';

        try {
          // We use the sandboxed command runner for strict isolation.
          // Note: we must allow network for the AI to reach Google APIs.
          const cliResult = await this.sandboxExecutor.runSandboxedCommand(
            '/toolchain/node_modules/.bin/gemini',
            [
              '--model',
              this.modelName,
              '--output-format',
              'json',
              '--prompt',
              '"$(cat .gemini-prompt.txt)"',
            ],
            localRepoPath,
            {
              GEMINI_API_KEY: this.apiKey,
              GEMINI_SYSTEM_MD: 'true',
            },
            120_000,
            true, // allowNetwork
          );

          if (!cliResult.success) {
            throw new Error(`CLI returned non-zero exit: ${cliResult.output}`);
          }

          this.logger.debug(`Raw CLI Output: ${cliResult.output}`);

          // The CLI returns JSON output
          let parsed: any;
          try {
            parsed = JSON.parse(cliResult.output);
          } catch (e) {
            throw new Error(
              `Failed to parse AI CLI JSON: ${e.message}\nOutput: ${cliResult.output}`,
            );
          }

          generatedCode = Array.isArray(parsed)
            ? parsed
                .map((p) => p.candidates?.[0]?.content?.parts?.[0]?.text)
                .join('')
            : parsed.response ||
              parsed.text ||
              parsed.candidates?.[0]?.content?.parts?.[0]?.text;

          if (!generatedCode && parsed.error) {
            throw new Error(
              `AI CLI returned error: ${parsed.error.message || JSON.stringify(parsed.error)}`,
            );
          }
        } catch (execError) {
          throw new Error(
            `Isolated AI CLI execution failed: ${execError.message}`,
          );
        } finally {
          // Clean up prompt and system files
          await fs.unlink(promptFile).catch(() => {});
          await fs
            .rm(geminiDir, { recursive: true, force: true })
            .catch(() => {});
        }

        if (!generatedCode) {
          throw new Error('AI CLI returned empty or unparseable text.');
        }

        generatedCode = this.cleanResponse(generatedCode);

        // Step 1: Write to temp file for validation
        await fs.mkdir(path.dirname(tempTestFilePath), { recursive: true });
        await fs.writeFile(tempTestFilePath, generatedCode, 'utf8');
        const stats = await fs.stat(tempTestFilePath);
        this.logger.debug(
          `Wrote verification test: ${tempTestFilePath} (${stats.size} bytes)`,
        );

        // Step 2: Validate (TSC first, then Jest + Coverage)
        this.logger.log(`Validating attempt ${attempt}...`);
        const validation = await this.testValidator.validateTest(
          tempTestFilePath,
          localRepoPath,
          targetCoverage,
        );

        if (validation.success) {
          // Success! Move temp file to actual test path and clean up
          await fs.rename(tempTestFilePath, fullTestFilePath);
          this.logger.log(
            `Successfully generated valid test for ${sourceFilePath} after ${attempt} attempts.`,
          );
          return;
        }

        this.logger.warn(
          `Attempt ${attempt} failed validation: ${validation.error.substring(0, 500)}`,
        );
        this.logger.debug(
          `Generated code for attempt ${attempt}:\n${generatedCode}`,
        );
        currentError = validation.error;
      }

      // Cleanup temp file on final failure
      try {
        await fs.unlink(tempTestFilePath);
      } catch {}

      throw new Error(
        `Failed to generate a valid test for ${sourceFilePath} after ${MAX_ATTEMPTS} attempts. Last error: ${currentError}`,
      );
    } catch (error) {
      this.logger.error(`Generation failed: ${error.message}`);
      throw error;
    }
  }

  private shouldSkipFile(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/');
    const fileName = path.basename(normalizedPath);
    const pathParts = normalizedPath.split('/');

    return (
      pathParts.some((part) => this.SKIP_FOLDERS.includes(part)) ||
      this.SKIP_FILES.includes(fileName) ||
      this.SKIP_EXTENSIONS.some((ext) => fileName.endsWith(ext))
    );
  }

  private getRelativeImportPath(sourcePath: string, testPath: string): string {
    const testDir = path.dirname(testPath);
    let relative = path.relative(testDir, sourcePath);
    relative = relative.replace(/\.(ts|js)$/, '');
    return relative.startsWith('.') ? relative : `./${relative}`;
  }

  private async getPackages(repoPath: string): Promise<string> {
    try {
      const pkgPath = path.join(repoPath, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(
        ', ',
      );
    } catch {
      return 'unknown';
    }
  }

  private cleanResponse(content: string): string {
    // Attempt to extract from a markdown code block first
    const codeBlockRegex =
      /```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/im;
    const match = content.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // If no code block, return the trimmed content assuming it is pure code
    return content.trim();
  }
}
