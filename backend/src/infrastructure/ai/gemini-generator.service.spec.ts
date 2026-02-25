import { ConfigService } from '@nestjs/config';
import { DependencyAnalyzerService } from '../ast/dependency-analyzer.service';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';
import { TestValidatorService } from '../validation/test-validator.service';
import { GeminiGeneratorService } from './gemini-generator.service';
import { TestPromptBuilder } from './test-prompt.builder';

describe('GeminiGeneratorService', () => {
  let service: GeminiGeneratorService;
  let sandboxExecutor: jest.Mocked<SandboxExecutorService>;
  let testValidator: jest.Mocked<TestValidatorService>;
  let dependencyAnalyzer: jest.Mocked<DependencyAnalyzerService>;
  let promptBuilder: jest.Mocked<TestPromptBuilder>;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockImplementation((key: string, defaultVal?: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-api-key';
        if (key === 'GEMINI_MODEL')
          return defaultVal ?? 'gemini-2.0-flash-lite';
        return undefined;
      }),
    } as unknown as ConfigService;

    sandboxExecutor = {
      runSandboxedCommand: jest.fn(),
    } as unknown as jest.Mocked<SandboxExecutorService>;

    testValidator = {
      validateTest: jest.fn(),
    } as unknown as jest.Mocked<TestValidatorService>;

    dependencyAnalyzer = {
      analyze: jest.fn().mockResolvedValue([]),
      formatContext: jest.fn().mockReturnValue(''),
    } as unknown as jest.Mocked<DependencyAnalyzerService>;

    promptBuilder = {
      buildSystemInstruction: jest
        .fn()
        .mockReturnValue('You are a test engineer.'),
      buildPrompt: jest.fn().mockReturnValue('Generate test for foo.ts'),
    } as unknown as jest.Mocked<TestPromptBuilder>;

    service = new GeminiGeneratorService(
      configService,
      dependencyAnalyzer,
      sandboxExecutor,
      testValidator,
      promptBuilder,
    );
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  });

  describe('constructor', () => {
    it('should throw if GEMINI_API_KEY is not set', () => {
      const badConfig = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService;

      expect(
        () =>
          new GeminiGeneratorService(
            badConfig,
            dependencyAnalyzer,
            sandboxExecutor,
            testValidator,
            promptBuilder,
          ),
      ).toThrow('GEMINI_API_KEY is not defined');
    });
  });

  describe('cleanResponse() (private method)', () => {
    it('should strip typescript markdown code blocks', () => {
      const clean = (service as any).cleanResponse.bind(service);
      expect(clean('```typescript\nconst x = 1;\n```')).toBe('const x = 1;');
    });

    it('should strip ts markdown code blocks', () => {
      const clean = (service as any).cleanResponse.bind(service);
      expect(clean('```ts\nconst y = 2;\n```')).toBe('const y = 2;');
    });

    it('should return plain content unchanged', () => {
      const clean = (service as any).cleanResponse.bind(service);
      expect(clean('const z = 3;')).toBe('const z = 3;');
    });

    it('should strip javascript code blocks too', () => {
      const clean = (service as any).cleanResponse.bind(service);
      expect(clean('```javascript\nlet a = 1;\n```')).toBe('let a = 1;');
    });
  });

  describe('shouldSkipFile() (private method)', () => {
    it('should skip files in node_modules', () => {
      expect((service as any).shouldSkipFile('node_modules/some/lib.ts')).toBe(
        true,
      );
    });

    it('should skip .spec.ts files', () => {
      expect((service as any).shouldSkipFile('src/foo.spec.ts')).toBe(true);
    });

    it('should skip .test.ts files', () => {
      expect((service as any).shouldSkipFile('src/foo.test.ts')).toBe(true);
    });

    it('should skip main.ts', () => {
      expect((service as any).shouldSkipFile('src/main.ts')).toBe(true);
    });

    it('should skip .module.ts files', () => {
      expect((service as any).shouldSkipFile('src/app.module.ts')).toBe(true);
    });

    it('should skip files inside dto folders', () => {
      expect((service as any).shouldSkipFile('src/dto/create-user.ts')).toBe(
        true,
      );
    });

    it('should NOT skip regular service files', () => {
      expect(
        (service as any).shouldSkipFile('src/services/user.service.ts'),
      ).toBe(false);
    });

    it('should NOT skip regular controller files', () => {
      expect((service as any).shouldSkipFile('src/api/api.controller.ts')).toBe(
        false,
      );
    });
  });

  describe('getRelativeImportPath() (private method)', () => {
    it('should compute relative path from test file to source file', () => {
      const rel = (service as any).getRelativeImportPath(
        'src/services/user.service.ts',
        'src/services/user.service.test.ts',
      );
      expect(rel).toBe('./user.service');
    });

    it('should prefix with ./ when in same directory', () => {
      const rel = (service as any).getRelativeImportPath(
        'src/foo.ts',
        'src/foo.test.ts',
      );
      expect(rel).toMatch(/^.\//);
    });

    it('should use ../ when test is in a subdirectory', () => {
      const rel = (service as any).getRelativeImportPath(
        'src/foo.ts',
        'src/__tests__/foo.test.ts',
      );
      expect(rel).toBe('../foo');
    });
  });

  describe('getPackages() (private method)', () => {
    it('should return comma-separated package names from package.json', async () => {
      const mockFs = { readFile: jest.fn() };
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValueOnce(
        JSON.stringify({
          dependencies: { express: '^4.0.0' },
          devDependencies: { jest: '^29.0.0' },
        }),
      );
      const result = await (service as any).getPackages('/tmp/repo');
      expect(result).toContain('express');
      expect(result).toContain('jest');
    });

    it('should return "unknown" when package.json cannot be read', async () => {
      jest
        .spyOn(require('fs').promises, 'readFile')
        .mockRejectedValueOnce(new Error('ENOENT'));
      const result = await (service as any).getPackages('/missing/path');
      expect(result).toBe('unknown');
    });
  });

  describe('generateTest()', () => {
    let fsp: typeof import('fs/promises');

    beforeEach(() => {
      fsp = require('fs/promises');
      jest.spyOn(fsp, 'readFile').mockResolvedValue('source code');
      jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fsp, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fsp, 'unlink').mockResolvedValue(undefined);
      jest.spyOn(fsp, 'rename').mockResolvedValue(undefined);
      jest.spyOn(fsp, 'stat').mockResolvedValue({ size: 1024 } as any);
      jest.spyOn(fsp, 'rm').mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const mockValidationSuccess = {
      success: true,
      hasSyntaxError: false,
      hasTypescriptError: false,
      hasFailingTests: false,
      consoleOutput: '',
      coverage: 100,
      error: '',
    };
    const mockValidationFailure = {
      success: false,
      hasSyntaxError: false,
      hasTypescriptError: true,
      hasFailingTests: false,
      consoleOutput: 'validation error',
      error: 'this is the error string',
      coverage: 0,
    };

    it('should generate a test successfully and pass validation on the first attempt', async () => {
      sandboxExecutor.runSandboxedCommand.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '```ts\nexpect(true).toBe(true);\n```' }],
              },
            },
          ],
        }),
      });
      testValidator.validateTest.mockResolvedValue(mockValidationSuccess);

      await service.generateTest(
        'src/foo.ts',
        'src/foo.spec.ts',
        '/tmp/repo',
        80,
      );

      expect(fsp.readFile).toHaveBeenCalledWith('/tmp/repo/src/foo.ts', 'utf8');
      expect(fsp.writeFile).toHaveBeenCalledWith(
        '/tmp/repo/.gemini-prompt.txt',
        expect.any(String),
        'utf8',
      );
      expect(sandboxExecutor.runSandboxedCommand).toHaveBeenCalledTimes(1);
      expect(testValidator.validateTest).toHaveBeenCalledTimes(1);

      // Verification check replaces Verification file with real file using fs.rename internally
      expect(fsp.rename).toHaveBeenCalledWith(
        '/tmp/repo/src/foo.verification.test.ts',
        '/tmp/repo/src/foo.spec.ts',
      );
    });

    it('should retry if validation fails, and succeed on the second attempt', async () => {
      // First attempt: returns some code, but validation fails
      sandboxExecutor.runSandboxedCommand.mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({ response: 'bad code' }), // testing alternate JSON structure
      });
      testValidator.validateTest.mockResolvedValueOnce(mockValidationFailure);

      // Second attempt: returns good code, validation passes
      sandboxExecutor.runSandboxedCommand.mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({ text: 'good code' }),
      });
      testValidator.validateTest.mockResolvedValueOnce(mockValidationSuccess);

      await service.generateTest(
        'src/bar.ts',
        'src/bar.spec.ts',
        '/tmp/repo',
        80,
      );

      expect(sandboxExecutor.runSandboxedCommand).toHaveBeenCalledTimes(2);
      expect(testValidator.validateTest).toHaveBeenCalledTimes(2);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed validation'),
      );
      expect(fsp.rename).toHaveBeenCalledTimes(1);
    });

    it('should hit max attempts and keep the last generated file if all validations fail', async () => {
      sandboxExecutor.runSandboxedCommand.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'still bad' }] } }],
        }),
      });
      testValidator.validateTest.mockResolvedValue(mockValidationFailure);

      await expect(
        service.generateTest('src/baz.ts', 'src/baz.spec.ts', '/tmp/repo', 80),
      ).rejects.toThrow(/Failed to generate a valid test for src\/baz.ts/);

      expect(sandboxExecutor.runSandboxedCommand).toHaveBeenCalledTimes(3);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Generation failed'),
      );
    });

    it('should throw if the CLI fails to execute', async () => {
      sandboxExecutor.runSandboxedCommand.mockResolvedValue({
        success: false,
        output: 'Docker error',
      });
      await expect(
        service.generateTest('src/err.ts', 'src/err.spec.ts', '/tmp/repo', 80),
      ).rejects.toThrow(
        'Isolated AI CLI execution failed: CLI returned non-zero exit: Docker error',
      );
    });

    it('should throw if the CLI returns invalid JSON', async () => {
      sandboxExecutor.runSandboxedCommand.mockResolvedValue({
        success: true,
        output: 'Not JSON',
      });
      await expect(
        service.generateTest('src/err.ts', 'src/err.spec.ts', '/tmp/repo', 80),
      ).rejects.toThrow(
        /Isolated AI CLI execution failed: Failed to parse AI CLI JSON/,
      );
    });

    it('should throw if the CLI returns an error message in JSON', async () => {
      sandboxExecutor.runSandboxedCommand.mockResolvedValue({
        success: true,
        output: JSON.stringify({ error: { message: 'Quota exceeded' } }),
      });
      await expect(
        service.generateTest('src/err.ts', 'src/err.spec.ts', '/tmp/repo', 80),
      ).rejects.toThrow(
        /Isolated AI CLI execution failed: AI CLI returned error: Quota exceeded/,
      );
    });

    it('should skip file if shouldSkipFile returns true', async () => {
      await service.generateTest(
        'node_modules/skip.ts',
        'node_modules/skip.spec.ts',
        '/tmp/repo',
        80,
      );
      expect((service as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping excluded file'),
      );
      expect(sandboxExecutor.runSandboxedCommand).not.toHaveBeenCalled();
    });
  });
});
