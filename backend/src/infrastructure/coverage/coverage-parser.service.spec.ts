import { Logger } from '@nestjs/common';
import * as fsp from 'fs/promises';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';
import { CoverageParserService } from './coverage-parser.service';

jest.mock('fs/promises');

describe('CoverageParserService', () => {
  let service: CoverageParserService;
  let sandboxExecutor: jest.Mocked<SandboxExecutorService>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    sandboxExecutor = {
      resolveInstallCmd: jest.fn().mockResolvedValue('npm install --ignore-scripts'),
      executeCommand: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    } as unknown as jest.Mocked<SandboxExecutorService>;

    service = new CoverageParserService(sandboxExecutor);
    (service as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger;
  });

  describe('The "Broken Repository" Test (Resilience)', () => {
    it('should gracefully fallback to walkTs when coverage-summary.json is missing or path is broken without crashing', async () => {
      // 1. Mock fs access to simulate node_modules missing so install runs
      (fsp.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      // 2. Mock fs read to simulate package.json missing or invalid (no jest config)
      (fsp.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (fsp.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fsp.unlink as jest.Mock).mockResolvedValue(undefined);

      // 3. Mock sandbox executor:
      // First call (npm install) succeeds
      sandboxExecutor.executeCommand.mockResolvedValueOnce({ stdout: 'installed', stderr: '' });
      // Second call (jest) fails, preventing coverage-summary.json from being generated.
      sandboxExecutor.executeCommand.mockRejectedValueOnce(
        Object.assign(new Error('jest failed'), { code: 1, stderr: 'Jest failed to run correctly' })
      );

      // 4. Mock fsp.readdir to simulate our fallback walkTs behavior
      // A mock src directory with one valid TS file
      (fsp.readdir as jest.Mock).mockImplementation(async (dir) => {
        if (dir === '/broken/repo') {
          return [
            { isDirectory: () => true, isFile: () => false, name: 'src' },
          ];
        } else if (dir === '/broken/repo/src') {
          return [
            { isDirectory: () => false, isFile: () => true, name: 'main.ts' }, // Skips this because it's listed in SKIP_FILE_REGEXES
            { isDirectory: () => false, isFile: () => true, name: 'user.controller.ts' }, // Should be captured
          ];
        }
        return [];
      });

      // Execute scan Coverage
      const results = await service.scanCoverage('/broken/repo');

      // Assertions
      expect(sandboxExecutor.resolveInstallCmd).toHaveBeenCalledWith('/broken/repo');
      
      // We expect the fallback walkTs behavior: return mapped string[] array of valid TS files at 0%
      expect(results).toHaveLength(1);
      
      // Node path.relative logic might map differently but it should contain user.controller.ts
      expect(results[0].filePath).toMatch(/user\.controller\.ts$/);
      expect(results[0].linesCoverage).toBe(0);

      // Verify the warning was logged
      expect((service as any).logger.warn).toHaveBeenCalledWith('No coverage-summary.json produced. Returning all source files at 0%.');
    });
  });
});
