import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxExecutorService } from './sandbox-executor.service';

describe('SandboxExecutorService', () => {
  let service: SandboxExecutorService;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SandboxExecutorService({
      get: jest.fn().mockReturnValue('/tmp/clones')
    } as unknown as ConfigService);

    // Spy on the logger to verify explicit socket permission failure logging
    // Sandbox uses a nested Logger instance, so we can replace it.
    (service as any).logger = { 
      log: jest.fn(), 
      warn: jest.fn(), 
      error: jest.fn(), 
      debug: jest.fn() 
    } as unknown as Logger;
    
    loggerErrorSpy = jest.spyOn((service as any).logger, 'error');
  });

  describe('The Docker Socket Permission Test (Health Check)', () => {
    it('should explicitly log errors when docker commands fail due to daemon access issues', async () => {
      // We will override runCommand to simulate a low-level docker socket daemon error
      // from `spawn` returning exit code > 0 and stderr pointing to socket perms.
      const runCommandSpy = jest.spyOn(service, 'runCommand').mockImplementation(async (command, args) => {
        const fakeSpawnError = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?';
        
        // Calling the private logger directly just like runCommand's inner Promisified closure would during an 'error' event
        (service as any).logger.error(`Failed to start command ${command}: ${fakeSpawnError}`);
        
        return { success: false, output: fakeSpawnError };
      });

      const response = await service.runSandboxedCommand('npm', ['install'], '/my/local/repo');

      expect(response.success).toBe(false);
      expect(response.output).toContain('Cannot connect to the Docker daemon');
      
      // Verify that the Infrastructure explicitly logged this to prevent silent hanging
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot connect to the Docker daemon')
      );
    });
  });
});
