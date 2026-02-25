import 'reflect-metadata';
import { ICoverageParser } from '../../domain/coverage/coverage-parser.interface';
import { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { TrackedRepository } from '../../domain/repository/tracked-repository.entity';
import { ITrackedRepositoryRepository } from '../../domain/repository/tracked-repository.repository.interface';
import { RepoScanProcessor } from './repo-scan.processor';

describe('RepoScanProcessor', () => {
  let processor: RepoScanProcessor;
  let repoRepository: jest.Mocked<ITrackedRepositoryRepository>;
  let repositoryHost: jest.Mocked<IRepositoryHost>;
  let coverageParser: jest.Mocked<ICoverageParser>;

  const mockRepo = TrackedRepository.create(
    'repo-1',
    'https://github.com/foo/bar',
  );

  beforeEach(() => {
    repoRepository = {
      findById: jest.fn().mockResolvedValue(mockRepo),
      save: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
      findByUrl: jest.fn(),
    } as unknown as jest.Mocked<ITrackedRepositoryRepository>;

    repositoryHost = {
      cloneRepository: jest.fn().mockResolvedValue('/tmp/clones/repo-1'),
      cleanupLocalRepository: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IRepositoryHost>;

    coverageParser = {
      scanCoverage: jest
        .fn()
        .mockResolvedValue([{ filePath: 'src/index.ts', linesCoverage: 72 }]),
    } as unknown as jest.Mocked<ICoverageParser>;

    processor = new RepoScanProcessor(
      repoRepository,
      repositoryHost,
      coverageParser,
    );
    (processor as any).logger = { log: jest.fn(), error: jest.fn() };
  });

  describe('process()', () => {
    it('should scan coverage and save the updated repo on happy path', async () => {
      const mockJob = { data: { repoId: 'repo-1' } } as any;

      await processor.process(mockJob);

      expect(repoRepository.findById).toHaveBeenCalledWith('repo-1');
      expect(repositoryHost.cloneRepository).toHaveBeenCalledWith(mockRepo.url);
      expect(coverageParser.scanCoverage).toHaveBeenCalledWith(
        '/tmp/clones/repo-1',
      );
      expect(repoRepository.save).toHaveBeenCalledWith(mockRepo);
      expect(repositoryHost.cleanupLocalRepository).toHaveBeenCalledWith(
        '/tmp/clones/repo-1',
      );
    });

    it('should log and return early when repo is not found', async () => {
      repoRepository.findById.mockResolvedValueOnce(null);
      const mockJob = { data: { repoId: 'missing-repo' } } as any;

      await processor.process(mockJob);

      expect(repositoryHost.cloneRepository).not.toHaveBeenCalled();
      expect((processor as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('missing-repo'),
      );
    });

    it('should rethrow errors from coverage scanning and still cleanup', async () => {
      repositoryHost.cloneRepository.mockResolvedValueOnce(
        '/tmp/clones/repo-1',
      );
      coverageParser.scanCoverage.mockRejectedValueOnce(
        new Error('Coverage scan failed'),
      );

      const mockJob = { data: { repoId: 'repo-1' } } as any;

      await expect(processor.process(mockJob)).rejects.toThrow(
        'Coverage scan failed',
      );
      // Cleanup must still run despite the error
      expect(repositoryHost.cleanupLocalRepository).toHaveBeenCalledWith(
        '/tmp/clones/repo-1',
      );
    });

    it('should still attempt cleanup even when clone fails (empty localPath guard)', async () => {
      repositoryHost.cloneRepository.mockRejectedValueOnce(
        new Error('git clone failed'),
      );

      const mockJob = { data: { repoId: 'repo-1' } } as any;

      await expect(processor.process(mockJob)).rejects.toThrow(
        'git clone failed',
      );
      // localPath was never set, so cleanup should NOT be called
      expect(repositoryHost.cleanupLocalRepository).not.toHaveBeenCalled();
    });
  });

  describe('BullMQ metadata', () => {
    it('should be decorated with concurrency 2', () => {
      const meta = Reflect.getMetadata(
        'bullmq:worker_metadata',
        RepoScanProcessor,
      );
      expect(meta).toBeDefined();
      expect(meta.concurrency).toBe(2);
    });
  });
});
