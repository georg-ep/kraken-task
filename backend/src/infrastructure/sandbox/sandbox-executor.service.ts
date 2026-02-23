import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, spawn } from 'child_process';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Name of the Docker named volume that holds the one-time-installed verification
 * toolchain (jest, ts-jest, typescript, supertest and their @types).
 * The volume is populated once on worker startup and then reused for every job —
 * meaning subsequent jobs pay zero npm-install cost.
 */
const TOOLCHAIN_VOLUME = 'kraken-node-modules';


@Injectable()
export class SandboxExecutorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SandboxExecutorService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Runs once after the worker module is fully initialised.
   * Installs the verification toolchain packages into the persistent
   * kraken-node-modules volume. Because the volume persists across restarts,
   * this only ever runs once (or on a cold/fresh volume).
   *
   * The volume is mounted at /app/node_modules in every sandbox run, giving
   * every job instant access to jest, ts-jest, typescript, supertest etc.
   * with zero per-job installation cost.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('Checking verification toolchain volume…');
    try {
      // Check for a marker file that we write after a successful install.
      const checkResult = await this.runCommand('docker', [
        'run', '--rm',
        '-v', `${TOOLCHAIN_VOLUME}:/toolchain`,
        'node:20-alpine',
        'sh', '-c', 'test -f /toolchain/node_modules/.bin/jest && test -f /toolchain/node_modules/.bin/gemini && echo WARM || echo COLD',
      ], process.cwd(), {}, 30000);

      if (checkResult.output.trim() === 'WARM') {
        this.logger.log('Verification toolchain already warm — skipping install.');
        return;
      }

      this.logger.log('Verification toolchain cold — running one-off install…');

      // Install packages into a temp /work dir, then copy node_modules/* directly
      // to the volume root.  This means when we later mount the volume at
      // /app/node_modules the packages appear at /app/node_modules/jest etc.
      const installScript = [
        'set -e',
        'mkdir -p /work && cd /work',
        'npm init -y',
        'npm install --prefer-offline --ignore-scripts supertest @types/supertest jest ts-jest typescript @types/jest @google/gemini-cli',
        'cp -r node_modules /toolchain/',
        'echo INSTALLED',
      ].join(' && ');

      const installResult = await this.runCommand('docker', [
        'run', '--rm',
        '--user', 'root',
        '--network', 'bridge',
        '-v', `${TOOLCHAIN_VOLUME}:/toolchain`,
        '-v', 'kraken-npm-cache:/root/.npm',
        'node:20-alpine',
        'sh', '-c', installScript,
      ], process.cwd(), {}, 300000);

      if (installResult.output.includes('INSTALLED')) {
        this.logger.log('Verification toolchain installed and ready.');
      } else {
        this.logger.error(`Toolchain install may have failed:\n${installResult.output}`);
      }
    } catch (err) {
      this.logger.error('Failed to warm verification toolchain:', err);
    }
  }

  async runSandboxedCommand(
    command: string,
    args: string[],
    localRepoPath: string,
    env: Record<string, string> = {},
    timeoutMs = 120000,
    allowNetwork = false,
    runAsRoot = false,
  ): Promise<{ success: boolean; output: string }> {
    const hostBase = this.configService.get<string>('HOST_CLONE_BASE_PATH') || '/tmp/clones';
    const folderName = path.basename(localRepoPath);
    const hostRepoPath = path.join(hostBase, folderName);

    const fullCommand = `${command} ${args.join(' ')}`;

    const dockerArgs = [
      'run', '--rm',
      '--user', runAsRoot ? 'root' : 'node',
      '--network', allowNetwork ? 'bridge' : 'none',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      '-v', `${hostRepoPath}:/app`,
      // Shared persistent toolchain — pre-warmed once at startup; zero install cost per job.
      '-v', `${TOOLCHAIN_VOLUME}:/toolchain`,
      '-w', '/app',
      'node:20-alpine',
      'sh', '-c', `NODE_PATH=/toolchain/node_modules ${fullCommand}`,
    ];

    this.logger.debug(`[SANDBOX] docker ${dockerArgs.join(' ')}`);
    return this.runCommand('docker', dockerArgs, process.cwd(), env, timeoutMs);
  }

  async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string> = {},
    timeoutMs = 120000,
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
      });
      let output = '';

      const timeout = setTimeout(() => {
        child.kill();
        this.logger.error(`Command ${command} ${args.join(' ')} timed out after ${timeoutMs}ms`);
        resolve({ success: false, output: output + '\nTIMEOUT' });
      }, timeoutMs);

      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ success: code === 0, output: output.trim() });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`Failed to start command ${command}: ${err.message}`);
        resolve({ success: false, output: err.message });
      });
    });
  }

  async executeCommand(command: string, options: { cwd: string; timeout?: number; maxBuffer?: number; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string }> {
    return execAsync(command, {
      ...options,
      env: { ...process.env, ...options.env },
    });
  }

  async resolveInstallCmd(localPath: string): Promise<string> {
    const exists = async (p: string) => fsp.access(p).then(() => true).catch(() => false);
    if (await exists(path.join(localPath, 'package-lock.json'))) {
      return 'npm ci --ignore-scripts';
    }
    if (await exists(path.join(localPath, 'yarn.lock'))) {
      return 'yarn install --frozen-lockfile --ignore-scripts';
    }
    return 'npm install --ignore-scripts';
  }
}
