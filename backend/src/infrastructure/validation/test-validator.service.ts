import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';

export interface ValidationResult {
  success: boolean;
  error: string;
}

export interface ValidationResultWithCoverage extends ValidationResult {
    coverage: number;
}

@Injectable()
export class TestValidatorService {
  private readonly logger = new Logger(TestValidatorService.name);

  constructor(private readonly sandboxExecutor: SandboxExecutorService) {}

  async validateTest(testFilePath: string, repoPath: string, targetCoverage: number): Promise<ValidationResultWithCoverage> {
    try {
      const targetTestPath = path.relative(repoPath, testFilePath);
      const relativeTestPath = targetTestPath; // alias for clarity

      // Write a minimal tsconfig that scopes TSC to just the one test file.
      // isolatedModules: true means TypeScript doesn't cross-reference other
      // modules, so compilation is ~2s instead of ~90s.
      const tsconfigPath = path.join(repoPath, 'tsconfig.validation.json');
      await fs.writeFile(tsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
        },
        files: [relativeTestPath],
      }, null, 2));

      // Step A: TSC Validation using isolated tsconfig for speed.
      const tscArgs = [
        '--noEmit',
        '--project', 'tsconfig.validation.json',
      ];

      this.logger.debug(`Running sandboxed TSC: tsc ${tscArgs.join(' ')}`);
      const tscResult = await this.sandboxExecutor.runSandboxedCommand('/toolchain/node_modules/.bin/tsc', tscArgs, repoPath);

      // If TSC fails, we check if it's a "fatal" error (like syntax) or just missing types (TS2307)
      const isFatalTscError = tscResult.output.split('\n').some(line => {
        // Ignore common type mismatch/missing errors that don't prevent execution
        const ignorableCodes = ['TS2307', 'TS2305', 'TS2339', 'TS2503', 'TS2345', 'TS2322', 'TS2304'];
        const isError = line.includes('error TS');
        const isIgnorable = ignorableCodes.some(code => line.includes(code));
        return isError && !isIgnorable;
      });

      if (!tscResult.success && isFatalTscError) {
        return { success: false, error: `TSC (Compilation) Error:\n${tscResult.output}`, coverage: 0 };
      }

      // Step B: Jest Validation
      const jestConfigPath = path.join(repoPath, 'jest.config.verification.js');
      const relativeSourceFilePath = path.relative(repoPath, testFilePath.replace(/\.verification\.test\.ts$/, '.ts'));
      const jestConfigContent = `
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\\\.tsx?$': ['ts-jest', { 
      diagnostics: false
    }]
  },
  testMatch: ['**/${path.basename(testFilePath)}'],
  coverageDirectory: 'coverage',
  collectCoverage: true,
  collectCoverageFrom: ['${relativeSourceFilePath}'],
  reporters: [['default', { silent: true }]]
};
`;
      await fs.writeFile(jestConfigPath, jestConfigContent, 'utf8');

      const jestArgs = [
        'jest',
        '--json',
        '--config', path.basename(jestConfigPath),
        '--passWithNoTests',
        '--no-cache',
        '--forceExit',
        '--detectOpenHandles',
        '--runInBand',
        '--testTimeout=15000',
        targetTestPath
      ];

      this.logger.debug(`Running sandboxed Jest with config: ${path.basename(jestConfigPath)}`);
      const jestResult = await this.sandboxExecutor.runSandboxedCommand(
        '/toolchain/node_modules/.bin/jest',
        jestArgs.slice(1),
        repoPath,
        { NODE_PATH: '/toolchain/node_modules' },
        120000,
      );

      // Clean up config
      try { await fs.unlink(jestConfigPath); } catch {}

      let cleanJson = '';
      const jestJsonMarkers = ['{"numFailedTestSuites"', '{"success"', '{"numPassedTests"', '{"coverageMap"'];
      for (const marker of jestJsonMarkers) {
        const index = jestResult.output.lastIndexOf(marker);
        if (index !== -1) {
          cleanJson = jestResult.output.substring(index);
          break;
        }
      }

      this.logger.debug(`Clean JSON length: ${cleanJson.length}`);

      if (!cleanJson.includes('"coverageMap"')) {
        this.logger.warn(`Jest failed to produce coverage JSON for ${path.basename(testFilePath)}. Full output: ${jestResult.output.substring(0, 1000)}`);
        if (!jestResult.success) {
          return { success: false, error: `Jest (Execution) Error:\n${jestResult.output}\n\n${!tscResult.success ? `TSC (Type) Context:\n${tscResult.output}` : ''}`, coverage: 0 };
        }
      }

      this.logger.debug(`Target coverage for ${path.basename(testFilePath)}: ${targetCoverage}%`);

      // Step C: Coverage Verification
      try {
        const jestJson = JSON.parse(cleanJson);
        const coverageMap = jestJson.coverageMap || {};
        const sourcePath = testFilePath.replace(/\.verification\.test\.ts$/, '.ts');
        const sourceBase = path.basename(sourcePath);
	const targetRelativePath = path.relative(repoPath, sourcePath);
        
        const sourceFileKey = Object.keys(coverageMap).find(key => 
          key.endsWith(targetRelativePath) || key.endsWith(sourceBase)
        );
        
        if (!sourceFileKey) {
          this.logger.warn(`Could not find coverage for ${sourceBase} in keys: ${Object.keys(coverageMap).join(', ')}`);
          return { success: false, error: `COVERAGE ERROR: Could not find coverage data for ${sourceBase}. Jest might have failed to collect it.`, coverage: 0 };
        }

        const stats = coverageMap[sourceFileKey];
        let pct = 0;

        if (stats.s && typeof stats.s.pct === 'number') {
          pct = stats.s.pct;
        } else if (stats.s) {
          // Calculate manually from hits map
          const statementHits = stats.s;
          const total = Object.keys(statementHits).length;
          const covered = Object.values(statementHits).filter(v => (v as number) > 0).length;
          pct = total > 0 ? (covered / total) * 100 : 0;
          this.logger.debug(`Calculated coverage for ${sourceBase}: ${covered}/${total} statements (${pct.toFixed(2)}%)`);
          
          if (pct === 0 && total > 0) {
            this.logger.debug(`Coverage is 0%. Sample stats.s: ${JSON.stringify(stats.s).substring(0, 200)}`);
          }
        }

        this.logger.log(`Enforcing coverage: ${sourceBase} is ${pct.toFixed(2)}% (Target: ${targetCoverage}%)`);

        if (pct < targetCoverage) {
          const uncoveredLines = stats.s ? Object.entries(stats.s)
            .filter(([_, count]) => (count as number) === 0)
            .map(([id]) => id) : [];
          
          return { 
            success: false, 
            error: `COVERAGE TOO LOW: Statement coverage is ${pct.toFixed(2)}%, target is ${targetCoverage}%. \nUncovered statements: ${uncoveredLines.slice(0, 20).join(', ')}...`,
            coverage: pct 
          };
        }

        return { success: true, error: '', coverage: pct };
      } catch (e) {
        this.logger.warn(`Failed to parse coverage JSON: ${e.message}`);
        return { success: false, error: `VALIDATION ERROR: Failed to parse coverage results: ${e.message}`, coverage: 0 };
      }

    } catch (e) {
      return { success: false, error: `System error during validation: ${e.message}`, coverage: 0 };
    }
  }
}
