import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { IRepositoryHost } from '../../domain/repository/repository-host.interface';

@Injectable()
export class GitHubService implements IRepositoryHost {
  private readonly logger = new Logger(GitHubService.name);
  private octokit: Octokit;

  constructor(private configService: ConfigService) {
    this.octokit = new Octokit({
      auth: this.configService.get<string>('GITHUB_TOKEN'),
    });
  }

  // Used for checking if the repository has specific dependencies (like 'jest')
  async hasRequiredDependencies(
    repositoryUrl: string,
    dependencies: string[],
  ): Promise<boolean> {
    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
    }
    const [, owner, repoName] = match;
    const repo = repoName.replace(/\.git$/, '');

    try {
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'package.json',
      });

      if (
        !Array.isArray(response.data) &&
        response.data.type === 'file' &&
        response.data.content
      ) {
        const content = Buffer.from(response.data.content, 'base64').toString(
          'utf8',
        );
        const pkg = JSON.parse(content);

        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };

        return dependencies.every((dep) => !!allDeps[dep]);
      }
      return false;
    } catch (error) {
      this.logger.error(
        `Error checking dependencies for ${owner}/${repo}: ${error.message}`,
      );
      return false;
    }
  }

  // Used for checking if the token has push ('write') or admin access
  async checkPermissions(repositoryUrl: string): Promise<boolean> {
    if (!this.configService.get<string>('GITHUB_TOKEN')) {
      this.logger.warn(
        'No GITHUB_TOKEN set, mocking permission check (returning true).',
      );
      return true;
    }

    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
    }
    const [, owner, repo] = match;

    try {
      const response = await this.octokit.rest.repos.get({
        owner,
        repo: repo.replace(/\.git$/, ''),
      });

      // Check if the token has push ('write') or admin access
      return !!(
        response.data.permissions?.push || response.data.permissions?.admin
      );
    } catch (error) {
      this.logger.error(
        `Error checking permissions for ${owner}/${repo}:`,
        error.message,
      );
      return false; // Typically 403 or 404 if no access
    }
  }

  async cloneRepository(
    repositoryUrl: string,
    branch?: string,
  ): Promise<string> {
    const clonesBase = '/app/clones';
    try {
      await fs.access(clonesBase);
    } catch {
      await fs.mkdir(clonesBase, { recursive: true });
    }
    const tmpDir = await fs.mkdtemp(
      path.join(clonesBase, 'coverage-improver-'),
    );
    this.logger.log(`Cloning ${repositoryUrl} to ${tmpDir}`);

    const git: SimpleGit = simpleGit();

    // Avoid injecting the token directly into the URL where it can be logged.
    // Instead we pass it securely via git config (http.extraHeader).
    const token = this.configService.get<string>('GITHUB_TOKEN');
    const cloneOptions = [];

    if (branch) {
      cloneOptions.push('--branch', branch, '--single-branch');
    }

    if (token) {
      const basicAuth = Buffer.from(`x-access-token:${token}`).toString(
        'base64',
      );
      cloneOptions.push(
        '-c',
        `http.extraHeader=AUTHORIZATION: basic ${basicAuth}`,
      );
    }

    await git.clone(repositoryUrl, tmpDir, cloneOptions);

    // Setup git config for the cloned repo
    const localGit = simpleGit(tmpDir);
    await localGit.addConfig('user.name', 'Coverage Improver AI');
    await localGit.addConfig('user.email', 'ai-coverage@kraken.invalid');

    return tmpDir;
  }

  async getDefaultBranch(localPath: string): Promise<string> {
    const git = simpleGit(localPath);
    const branch = await git.branchLocal();
    return branch.current || 'main';
  }

  async commitAndPushChanges(
    localPath: string,
    branchName: string,
    fileMap: Record<string, string>,
    commitMessage: string,
    /** Explicit file paths (relative to localPath) to stage. If provided, only
     *  these files are added — prevents coverage reports, temp configs, etc.
     *  from sneaking into the commit. Defaults to all fileMap keys. */
    pathsToAdd?: string[],
  ): Promise<void> {
    const git = simpleGit(localPath);

    this.logger.log(`Checking out new branch ${branchName}...`);
    await git.checkoutLocalBranch(branchName);

    // Apply file changes from fileMap
    for (const [filePath, content] of Object.entries(fileMap)) {
      const fullPath = path.join(localPath, filePath);
      const dir = path.dirname(fullPath);
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(fullPath, content, 'utf8');
      this.logger.log(`Written changed file ${filePath}`);
    }

    this.logger.log('Adding and committing changes...');
    // Stage only the specified files (or fileMap keys) — never git add all.
    const filesToStage = pathsToAdd ?? Object.keys(fileMap);
    for (const f of filesToStage) {
      await git.add(f);
    }
    await git.commit(commitMessage);

    this.logger.log(`Pushing to ${branchName}...`);
    await git.push(['-u', 'origin', branchName]);
  }

  async createPullRequest(
    repositoryUrl: string,
    branchName: string,
    title: string,
    body: string,
    baseBranch: string = 'main',
  ): Promise<string> {
    // repositoryUrl example: https://github.com/torvalds/linux
    const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
    }
    const [, owner, repo] = match;

    this.logger.log(
      `Creating PR for ${owner}/${repo} from ${branchName} to ${baseBranch}`,
    );

    if (!this.configService.get<string>('GITHUB_TOKEN')) {
      this.logger.warn('No GITHUB_TOKEN set, mocking PR creation.');
      return `${repositoryUrl}/pull/mock-123`;
    }

    const { data } = await this.octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branchName,
      base: baseBranch,
    });

    return data.html_url;
  }

  async cleanupLocalRepository(localPath: string): Promise<void> {
    this.logger.log(`Cleaning up ${localPath}`);
    try {
      await fs.access(localPath);
      await fs.rm(localPath, { recursive: true, force: true });
    } catch {
      // Ignored if it doesn't exist
    }
  }
}
