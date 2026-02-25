import { Logger } from '@nestjs/common';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';
import { TestValidatorService } from './test-validator.service';

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
  },
}));

describe('TestValidatorService', () => {
  let service: TestValidatorService;
  let sandboxExecutor: jest.Mocked<SandboxExecutorService>;

  const repoPath = '/tmp/repo';
  const testFilePath = '/tmp/repo/src/foo.verification.test.ts';

  beforeEach(() => {
    jest.clearAllMocks();

    sandboxExecutor = {
      runSandboxedCommand: jest.fn(),
    } as unknown as jest.Mocked<SandboxExecutorService>;

    service = new TestValidatorService(sandboxExecutor);
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
  });

  describe('validateTest()', () => {
    it('should return success=false with a TSC error message when tsc finds a fatal error', async () => {
      // TS2300 is NOT in the ignorable list, so it's treated as fatal
      sandboxExecutor.runSandboxedCommand.mockResolvedValueOnce({
        success: false,
        output: "src/foo.test.ts(5,10): error TS2300: Duplicate identifier 'x'",
      });

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(false);
      expect(result.error).toContain('TSC (Compilation) Error');
      // Jest should not have been called at all after a fatal TSC error
      expect(sandboxExecutor.runSandboxedCommand).toHaveBeenCalledTimes(1);
    });

    it('should tolerate ignorable TSC errors (TS2307 missing module) and proceed to Jest', async () => {
      sandboxExecutor.runSandboxedCommand
        .mockResolvedValueOnce({
          success: false,
          // TS2307 is ignorable
          output: "error TS2307: Cannot find module './something'",
        })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({
            numFailedTestSuites: 0,
            coverageMap: {
              '/tmp/repo/src/foo.ts': {
                s: { 1: 1, 2: 1, 3: 1 },
              },
            },
          }),
        });

      const result = await service.validateTest(testFilePath, repoPath, 80);
      // Should reach Jest and get a coverage result
      expect(sandboxExecutor.runSandboxedCommand).toHaveBeenCalledTimes(2);
    });

    it('should return success=false when Jest exits non-zero and produces no coverage JSON', async () => {
      sandboxExecutor.runSandboxedCommand
        .mockResolvedValueOnce({ success: true, output: '' }) // tsc passes
        .mockResolvedValueOnce({
          success: false,
          output: 'Jest crashed with exit code 1',
        }); // jest fails

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Jest (Execution) Error');
    });

    it('should return success=false when coverage is below target', async () => {
      sandboxExecutor.runSandboxedCommand
        .mockResolvedValueOnce({ success: true, output: '' }) // tsc passes
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({
            numFailedTestSuites: 0,
            coverageMap: {
              '/tmp/repo/src/foo.ts': {
                // Only 1 out of 4 covered — 25%
                s: { 1: 1, 2: 0, 3: 0, 4: 0 },
              },
            },
          }),
        });

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(false);
      expect(result.error).toContain('COVERAGE TOO LOW');
      expect(result.coverage).toBe(25);
    });

    it('should return success=true when coverage meets or exceeds target', async () => {
      // 4 out of 4 statements covered = 100%
      const coverageMap = {
        '/tmp/repo/src/foo.ts': {
          s: { 1: 1, 2: 1, 3: 1, 4: 1 },
        },
      };

      sandboxExecutor.runSandboxedCommand
        .mockResolvedValueOnce({ success: true, output: '' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({ numFailedTestSuites: 0, coverageMap }),
        });

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(true);
      expect(result.coverage).toBe(100);
      expect(result.error).toBe('');
    });

    it('should return success=false when coverage key cannot be found', async () => {
      sandboxExecutor.runSandboxedCommand
        .mockResolvedValueOnce({ success: true, output: '' })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify({
            numFailedTestSuites: 0,
            coverageMap: {
              '/tmp/repo/src/totally-different-file.ts': { s: { 1: 1 } },
            },
          }),
        });

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(false);
      expect(result.error).toContain('COVERAGE ERROR');
    });

    it('should handle system-level exceptions gracefully', async () => {
      sandboxExecutor.runSandboxedCommand.mockRejectedValueOnce(
        new Error('Docker daemon not running'),
      );

      const result = await service.validateTest(testFilePath, repoPath, 80);

      expect(result.success).toBe(false);
      expect(result.error).toContain('System error during validation');
    });
  });
});
