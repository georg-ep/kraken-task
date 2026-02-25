import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as childProcess from 'child_process';
import * as fsp from 'fs/promises';
import { SandboxExecutorService } from './sandbox-executor.service';

// We need to spy on spawn and exec, not mock the entire module
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  exec: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  access: jest.fn(),
}));

describe('SandboxExecutorService', () => {
  let service: SandboxExecutorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SandboxExecutorService({
      get: jest.fn().mockReturnValue('/tmp/clones'),
    } as unknown as ConfigService);
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
  });

  describe('resolveInstallCmd()', () => {
    it('should return npm ci when package-lock.json exists', async () => {
      (fsp.access as jest.Mock).mockImplementation(async (p: string) => {
        if (p.endsWith('package-lock.json')) return;
        throw new Error('ENOENT');
      });
      const cmd = await service.resolveInstallCmd('/tmp/repo');
      expect(cmd).toBe('npm ci --ignore-scripts');
    });

    it('should return yarn install when yarn.lock exists', async () => {
      (fsp.access as jest.Mock).mockImplementation(async (p: string) => {
        if (p.endsWith('yarn.lock')) return;
        throw new Error('ENOENT');
      });
      const cmd = await service.resolveInstallCmd('/tmp/repo');
      expect(cmd).toBe('yarn install --frozen-lockfile --ignore-scripts');
    });

    it('should return npm install when neither lock file exists', async () => {
      (fsp.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      const cmd = await service.resolveInstallCmd('/tmp/repo');
      expect(cmd).toBe('npm install --ignore-scripts');
    });
  });

  describe('runCommand()', () => {
    function mockSpawn(exitCode: number, stdout = '', stderr = '') {
      const EventEmitter = require('events');
      const stdoutEmitter = new EventEmitter();
      const stderrEmitter = new EventEmitter();
      const processEmitter = new EventEmitter();

      (childProcess.spawn as jest.Mock).mockReturnValueOnce({
        stdout: stdoutEmitter,
        stderr: stderrEmitter,
        on: processEmitter.on.bind(processEmitter),
        kill: jest.fn(),
      });

      // Emit events on the next tick
      setImmediate(() => {
        stdoutEmitter.emit('data', Buffer.from(stdout));
        stderrEmitter.emit('data', Buffer.from(stderr));
        processEmitter.emit('close', exitCode);
      });
    }

    it('should return success=true when command exits 0', async () => {
      mockSpawn(0, 'hello world');
      const result = await service.runCommand('echo', ['hello'], '/tmp');
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    it('should return success=false when command exits non-zero', async () => {
      mockSpawn(1, '', 'error message');
      const result = await service.runCommand('cat', ['missing'], '/tmp');
      expect(result.success).toBe(false);
      expect(result.output).toContain('error message');
    });

    it('should handle spawn errors gracefully', async () => {
      const EventEmitter = require('events');
      const processEmitter = new EventEmitter();
      (childProcess.spawn as jest.Mock).mockReturnValueOnce({
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        on: processEmitter.on.bind(processEmitter),
        kill: jest.fn(),
      });
      setImmediate(() => {
        processEmitter.emit('error', new Error('spawn ENOENT'));
      });

      const result = await service.runCommand('nonexistent', [], '/tmp');
      expect(result.success).toBe(false);
      expect(result.output).toContain('spawn ENOENT');
    });
  });

  describe('runSandboxedCommand()', () => {
    it('should call runCommand with docker args and the correct host path', async () => {
      const runCommandSpy = jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: 'done' });

      const result = await service.runSandboxedCommand(
        'node',
        ['-e', 'console.log(1)'],
        '/tmp/clones/my-repo',
      );

      expect(result.success).toBe(true);
      expect(runCommandSpy).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining([
          'run',
          '--rm',
          '-v',
          expect.stringContaining('my-repo'),
        ]),
        expect.any(String),
        expect.any(Object),
        expect.any(Number),
      );
    });

    it('should include env vars in docker args when provided', async () => {
      const runCommandSpy = jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: '' });

      await service.runSandboxedCommand('cmd', [], '/tmp/clones/repo', {
        MY_VAR: 'hello',
      });

      const dockerArgs: string[] = runCommandSpy.mock.calls[0][1];
      expect(dockerArgs).toContain('-e');
      expect(dockerArgs).toContain('MY_VAR=hello');
    });

    it('should use --network none by default for isolation', async () => {
      const runCommandSpy = jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: '' });

      await service.runSandboxedCommand('cmd', [], '/tmp/clones/repo');

      const dockerArgs: string[] = runCommandSpy.mock.calls[0][1];
      expect(dockerArgs).toContain('none');
    });

    it('should use --network bridge when allowNetwork=true', async () => {
      const runCommandSpy = jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: '' });

      await service.runSandboxedCommand(
        'cmd',
        [],
        '/tmp/clones/repo',
        {},
        30000,
        true,
      );

      const dockerArgs: string[] = runCommandSpy.mock.calls[0][1];
      expect(dockerArgs).toContain('bridge');
    });

    it('should use --user root when runAsRoot=true', async () => {
      const runCommandSpy = jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: '' });

      await service.runSandboxedCommand(
        'cmd',
        [],
        '/tmp/clones/repo',
        {},
        30000,
        false,
        true,
      );

      const dockerArgs: string[] = runCommandSpy.mock.calls[0][1];
      expect(dockerArgs).toContain('root');
    });
  });

  describe('executeCommand()', () => {
    it('should call execAsync with provided options', async () => {
      (childProcess.exec as unknown as jest.Mock).mockImplementation(
        (undefinedCmd: any, undefinedOpts: any, callback: any) => {
          // Because jest.mock strips the util.promisify.custom symbol from exec,
          // promisify will treat it like a standard Node callback and return only the FIRST success argument.
          // We pass the expected { stdout, stderr } object as the first success argument.
          callback(null, { stdout: 'done execution', stderr: '' });
        },
      );

      const result = await service.executeCommand('ls -l', {
        cwd: '/tmp',
        timeout: 5000,
      });
      expect(result.stdout).toBe('done execution');
      expect(childProcess.exec).toHaveBeenCalledWith(
        'ls -l',
        expect.objectContaining({ cwd: '/tmp', timeout: 5000 }),
        expect.any(Function),
      );
    });

    it('should reject on exec error', async () => {
      (childProcess.exec as unknown as jest.Mock).mockImplementation(
        (cmd: any, opts: any, callback: any) => {
          callback(new Error('exec failed'), '', 'some stderr');
        },
      );

      await expect(
        service.executeCommand('ls fakedir', { cwd: '/tmp' }),
      ).rejects.toThrow('exec failed');
    });
  });

  describe('onApplicationBootstrap()', () => {
    it('should skip install if toolchain is already WARM', async () => {
      jest
        .spyOn(service, 'runCommand')
        .mockResolvedValue({ success: true, output: 'WARM\n' });
      await service.onApplicationBootstrap();

      expect(service.runCommand).toHaveBeenCalledTimes(1); // Only the check is run
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Verification toolchain already warm — skipping install.',
      );
    });

    it('should run one-off install if toolchain is COLD', async () => {
      const runCommandSpy = jest.spyOn(service, 'runCommand');
      runCommandSpy.mockResolvedValueOnce({ success: true, output: 'COLD\n' });
      runCommandSpy.mockResolvedValueOnce({
        success: true,
        output: '... INSTALLED\n',
      });

      await service.onApplicationBootstrap();

      expect(runCommandSpy).toHaveBeenCalledTimes(2);
      expect((service as any).logger.log).toHaveBeenCalledWith(
        'Verification toolchain installed and ready.',
      );
    });

    it('should log an error if toolchain install fails (no INSTALLED in output)', async () => {
      const runCommandSpy = jest.spyOn(service, 'runCommand');
      runCommandSpy.mockResolvedValueOnce({ success: true, output: 'COLD\n' });
      runCommandSpy.mockResolvedValueOnce({
        success: false,
        output: 'npm err',
      });

      await service.onApplicationBootstrap();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Toolchain install may have failed'),
      );
    });

    it('should catch and log errors during bootstrap', async () => {
      jest
        .spyOn(service, 'runCommand')
        .mockRejectedValue(new Error('Docker not found'));

      await service.onApplicationBootstrap();

      expect((service as any).logger.error).toHaveBeenCalledWith(
        'Failed to warm verification toolchain:',
        expect.any(Error),
      );
    });
  });
});
