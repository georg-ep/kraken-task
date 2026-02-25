import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { TrackedRepository } from '../../domain/repository/tracked-repository.entity';
import { ITrackedRepositoryRepository } from '../../domain/repository/tracked-repository.repository.interface';
import { TrackedRepositoryService } from './tracked-repository.service';

describe('TrackedRepositoryService', () => {
  let service: TrackedRepositoryService;
  let repository: jest.Mocked<ITrackedRepositoryRepository>;
  let repositoryHost: jest.Mocked<IRepositoryHost>;
  let scanQueue: jest.Mocked<Queue>;

  const mockRepoUrl = 'https://github.com/foo/bar';

  beforeEach(() => {
    repository = {
      findAll: jest.fn().mockResolvedValue([]),
      findByUrl: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ITrackedRepositoryRepository>;

    repositoryHost = {
      hasRequiredDependencies: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IRepositoryHost>;

    scanQueue = {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<Queue>;

    service = new TrackedRepositoryService(
      repository,
      repositoryHost,
      scanQueue,
    );
    (service as any).logger = { log: jest.fn(), error: jest.fn() };
  });

  describe('listRepositories()', () => {
    it('should return all repositories from the store', async () => {
      const result = await service.listRepositories();
      expect(repository.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('addRepository()', () => {
    it('should return an existing repository if already tracked without re-adding', async () => {
      const existingRepo = TrackedRepository.create('existing-id', mockRepoUrl);
      repository.findByUrl.mockResolvedValueOnce(existingRepo);

      const result = await service.addRepository(mockRepoUrl);

      expect(result).toBe(existingRepo);
      expect(repository.save).not.toHaveBeenCalled();
      expect(repositoryHost.hasRequiredDependencies).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when jest/ts-jest are missing from the repo', async () => {
      repositoryHost.hasRequiredDependencies.mockResolvedValueOnce(false);

      await expect(service.addRepository(mockRepoUrl)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should create, save, and enqueue a scan for a new valid repository', async () => {
      // addRepository() calls enqueueScan() after saving, which calls findById()
      // So we need findById to return the repo that was just saved
      repository.findById.mockImplementation(async (id: string) => {
        return (repository.save as jest.Mock).mock.calls.length > 0
          ? TrackedRepository.create(id, mockRepoUrl)
          : null;
      });

      const result = await service.addRepository(mockRepoUrl);

      expect(repositoryHost.hasRequiredDependencies).toHaveBeenCalledWith(
        mockRepoUrl,
        ['jest', 'ts-jest'],
      );
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(scanQueue.add).toHaveBeenCalledWith(
        'scan-repo',
        { repoId: result.id },
        expect.objectContaining({ jobId: expect.stringContaining(result.id) }),
      );
      expect(result.url).toBe(mockRepoUrl);
    });
  });

  describe('enqueueScan()', () => {
    it('should throw NotFoundException when repo does not exist', async () => {
      repository.findById.mockResolvedValueOnce(null);
      await expect(service.enqueueScan('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should enqueue a scan job and return a success object', async () => {
      const mockRepo = TrackedRepository.create('repo-id-1', mockRepoUrl);
      repository.findById.mockResolvedValueOnce(mockRepo);

      const result = await service.enqueueScan('repo-id-1');

      expect(scanQueue.add).toHaveBeenCalledWith(
        'scan-repo',
        { repoId: 'repo-id-1' },
        expect.objectContaining({
          jobId: expect.stringContaining('repo-id-1'),
        }),
      );
      expect(result).toEqual({ queued: true, repoId: 'repo-id-1' });
    });
  });
});
