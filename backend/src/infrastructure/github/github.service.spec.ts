import { ConfigService } from '@nestjs/config';
import { promises as fsp } from 'fs';
import { GitHubService } from './github.service';

// Mock simple-git — must use factory function to avoid hoisting issues
let mockGitInstance: any;
jest.mock('simple-git', () => {
  return jest.fn().mockImplementation(() => mockGitInstance);
});

// Mock fs
jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
    mkdtemp: jest
      .fn()
      .mockResolvedValue('/app/clones/coverage-improver-abc123'),
    writeFile: jest.fn().mockResolvedValue(undefined),
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock Octokit
const mockOctokit = {
  rest: {
    repos: {
      get: jest.fn(),
      getContent: jest.fn(),
    },
    pulls: {
      create: jest.fn(),
    },
  },
};
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => mockOctokit),
}));

describe('GitHubService', () => {
  let service: GitHubService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGitInstance = {
      clone: jest.fn().mockResolvedValue(undefined),
      branchLocal: jest.fn().mockResolvedValue({ current: 'main' }),
      addConfig: jest.fn().mockResolvedValue(undefined),
      checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn().mockReturnValue('fake-github-token'),
    } as unknown as jest.Mocked<ConfigService>;

    service = new GitHubService(configService);
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('checkPermissions()', () => {
    it('should return true when token has push access', async () => {
      mockOctokit.rest.repos.get.mockResolvedValueOnce({
        data: { permissions: { push: true, admin: false } },
      });

      const result = await service.checkPermissions(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(true);
      expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({
        owner: 'foo',
        repo: 'bar',
      });
    });

    it('should return true when token has admin access', async () => {
      mockOctokit.rest.repos.get.mockResolvedValueOnce({
        data: { permissions: { push: false, admin: true } },
      });
      const result = await service.checkPermissions(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(true);
    });

    it('should return false when token has no push or admin access', async () => {
      mockOctokit.rest.repos.get.mockResolvedValueOnce({
        data: { permissions: { push: false, admin: false } },
      });
      const result = await service.checkPermissions(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(false);
    });

    it('should return false when octokit throws (e.g. 403)', async () => {
      mockOctokit.rest.repos.get.mockRejectedValueOnce(
        new Error('403 Forbidden'),
      );
      const result = await service.checkPermissions(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(false);
    });

    it('should return true and log a warning when no GITHUB_TOKEN is set', async () => {
      configService.get.mockReturnValue(undefined);
      const result = await service.checkPermissions(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(true);
      expect((service as any).logger.warn).toHaveBeenCalled();
    });

    it('should throw for an invalid URL', async () => {
      await expect(service.checkPermissions('not-a-valid-url')).rejects.toThrow(
        'Invalid GitHub repository URL',
      );
    });
  });

  describe('hasRequiredDependencies()', () => {
    it('should return true when all required packages exist in package.json', async () => {
      const pkgContent = JSON.stringify({
        devDependencies: { jest: '^29.0.0', 'ts-jest': '^29.0.0' },
      });
      mockOctokit.rest.repos.getContent.mockResolvedValueOnce({
        data: {
          type: 'file',
          content: Buffer.from(pkgContent).toString('base64'),
        },
      });

      const result = await service.hasRequiredDependencies(
        'https://github.com/foo/bar',
        ['jest', 'ts-jest'],
      );
      expect(result).toBe(true);
    });

    it('should return false when a required package is missing', async () => {
      const pkgContent = JSON.stringify({
        devDependencies: { jest: '^29.0.0' },
      });
      mockOctokit.rest.repos.getContent.mockResolvedValueOnce({
        data: {
          type: 'file',
          content: Buffer.from(pkgContent).toString('base64'),
        },
      });

      const result = await service.hasRequiredDependencies(
        'https://github.com/foo/bar',
        ['jest', 'ts-jest'],
      );
      expect(result).toBe(false);
    });

    it('should return false when octokit throws', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValueOnce(
        new Error('Not found'),
      );
      const result = await service.hasRequiredDependencies(
        'https://github.com/foo/bar',
        ['jest'],
      );
      expect(result).toBe(false);
    });
  });

  describe('getDefaultBranch()', () => {
    it('should return the current branch from simple-git', async () => {
      const result = await service.getDefaultBranch('/tmp/repo');
      expect(result).toBe('main');
    });

    it('should fall back to "main" when branchLocal returns no current branch', async () => {
      mockGitInstance.branchLocal.mockResolvedValueOnce({ current: '' });
      const result = await service.getDefaultBranch('/tmp/repo');
      expect(result).toBe('main');
    });
  });

  describe('createPullRequest()', () => {
    it('should call octokit to create a PR and return the URL', async () => {
      mockOctokit.rest.pulls.create.mockResolvedValueOnce({
        data: { html_url: 'https://github.com/foo/bar/pull/42' },
      });

      const url = await service.createPullRequest(
        'https://github.com/foo/bar',
        'improve-coverage-123',
        'Improve coverage',
        'Auto-generated PR',
        'main',
      );

      expect(url).toBe('https://github.com/foo/bar/pull/42');
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'foo',
          repo: 'bar',
          head: 'improve-coverage-123',
          base: 'main',
        }),
      );
    });

    it('should throw for an invalid URL', async () => {
      await expect(
        service.createPullRequest('bad-url', 'branch', 'title', 'body', 'main'),
      ).rejects.toThrow('Invalid GitHub repository URL');
    });

    it('should return a mock PR URL when no GITHUB_TOKEN is set', async () => {
      configService.get.mockReturnValue(undefined);
      const url = await service.createPullRequest(
        'https://github.com/foo/bar',
        'branch',
        'title',
        'body',
        'main',
      );
      expect(url).toContain('mock');
    });
  });

  describe('cleanupLocalRepository()', () => {
    it('should call fs.rm on the given path', async () => {
      await service.cleanupLocalRepository('/app/clones/some-repo');
      expect(fsp.rm).toHaveBeenCalledWith('/app/clones/some-repo', {
        recursive: true,
        force: true,
      });
    });

    it('should not throw if the path does not exist', async () => {
      (fsp.access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
      await expect(
        service.cleanupLocalRepository('/non-existent'),
      ).resolves.not.toThrow();
    });
  });

  describe('commitAndPushChanges()', () => {
    it('should checkout a new branch, stage specified files, commit and push', async () => {
      await service.commitAndPushChanges(
        '/tmp/repo',
        'new-feature-branch',
        {},
        'test: add coverage',
        ['src/foo.test.ts'],
      );

      expect(mockGitInstance.checkoutLocalBranch).toHaveBeenCalledWith(
        'new-feature-branch',
      );
      expect(mockGitInstance.add).toHaveBeenCalledWith('src/foo.test.ts');
      expect(mockGitInstance.commit).toHaveBeenCalledWith('test: add coverage');
      expect(mockGitInstance.push).toHaveBeenCalledWith([
        '-u',
        'origin',
        'new-feature-branch',
      ]);
    });

    it('should stage fileMap keys when no explicit pathsToAdd is provided', async () => {
      await service.commitAndPushChanges(
        '/tmp/repo',
        'branch',
        { 'src/my-file.ts': 'const x = 1;' },
        'chore: update',
      );
      expect(mockGitInstance.add).toHaveBeenCalledWith('src/my-file.ts');
    });
  });

  describe('cloneRepository()', () => {
    it('should create /app/clones dir if missing, clone repo, and return tmpDir', async () => {
      (fsp.access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT')); // clones dir missing

      const result = await service.cloneRepository(
        'https://github.com/foo/bar',
      );

      expect(fsp.mkdir).toHaveBeenCalledWith('/app/clones', {
        recursive: true,
      });
      expect(fsp.mkdtemp).toHaveBeenCalled();
      expect(mockGitInstance.clone).toHaveBeenCalledWith(
        'https://github.com/foo/bar',
        '/app/clones/coverage-improver-abc123',
        expect.arrayContaining(['-c']),
      );
      expect(result).toBe('/app/clones/coverage-improver-abc123');
    });

    it('should skip mkdir when /app/clones already exists', async () => {
      // fsp.access resolves (exists), so no mkdir call
      const result = await service.cloneRepository(
        'https://github.com/foo/bar',
      );
      expect(fsp.mkdir).not.toHaveBeenCalled();
      expect(result).toBe('/app/clones/coverage-improver-abc123');
    });

    it('should pass --branch flags when branch is specified', async () => {
      await service.cloneRepository('https://github.com/foo/bar', 'develop');
      expect(mockGitInstance.clone).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.arrayContaining(['--branch', 'develop', '--single-branch']),
      );
    });

    it('should not include auth header when no GITHUB_TOKEN is configured', async () => {
      configService.get.mockReturnValue(undefined);
      await service.cloneRepository('https://github.com/foo/bar');
      const cloneArgs: string[] = mockGitInstance.clone.mock
        .calls[0][2] as string[];
      expect(cloneArgs).not.toContain('-c');
    });
  });
});
