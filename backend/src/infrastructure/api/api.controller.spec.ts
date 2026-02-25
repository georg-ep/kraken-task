import { BadRequestException } from '@nestjs/common';
import { JobOrchestrationService } from '../../application/services/job-orchestration.service';
import { TrackedRepositoryService } from '../../application/services/tracked-repository.service';
import { ImprovementJob } from '../../domain/job/job.entity';
import { TrackedRepository } from '../../domain/repository/tracked-repository.entity';
import { ApiController } from './api.controller';

describe('ApiController', () => {
  let controller: ApiController;
  let jobService: jest.Mocked<JobOrchestrationService>;
  let trackedRepoService: jest.Mocked<TrackedRepositoryService>;

  const mockRepo = TrackedRepository.create(
    'repo-1',
    'https://github.com/foo/bar',
  );
  const mockJob = ImprovementJob.create(
    'job-1',
    'https://github.com/foo/bar',
    'src/index.ts',
  );

  beforeEach(() => {
    jobService = {
      createJob: jest.fn().mockResolvedValue(mockJob),
      listJobs: jest.fn().mockResolvedValue([mockJob]),
      getJob: jest.fn().mockResolvedValue(mockJob),
    } as unknown as jest.Mocked<JobOrchestrationService>;

    trackedRepoService = {
      listRepositories: jest.fn().mockResolvedValue([mockRepo]),
      addRepository: jest.fn().mockResolvedValue(mockRepo),
      enqueueScan: jest
        .fn()
        .mockResolvedValue({ queued: true, repoId: 'repo-1' }),
    } as unknown as jest.Mocked<TrackedRepositoryService>;

    controller = new ApiController(jobService, trackedRepoService);
  });

  describe('listRepos()', () => {
    it('should return all tracked repositories', async () => {
      const result = await controller.listRepos();
      expect(trackedRepoService.listRepositories).toHaveBeenCalled();
      expect(result).toEqual([mockRepo]);
    });
  });

  describe('addRepo()', () => {
    it('should add and return a repository', async () => {
      const result = await controller.addRepo('https://github.com/foo/bar');
      expect(trackedRepoService.addRepository).toHaveBeenCalledWith(
        'https://github.com/foo/bar',
      );
      expect(result).toBe(mockRepo);
    });

    it('should throw BadRequestException when repositoryUrl is missing', async () => {
      await expect(controller.addRepo('')).rejects.toThrow(BadRequestException);
      expect(trackedRepoService.addRepository).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when repositoryUrl is undefined', async () => {
      await expect(controller.addRepo(undefined as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('scanRepo()', () => {
    it('should enqueue a scan and return the result', async () => {
      const result = await controller.scanRepo('repo-1');
      expect(trackedRepoService.enqueueScan).toHaveBeenCalledWith('repo-1');
      expect(result).toEqual({ queued: true, repoId: 'repo-1' });
    });

    it('should wrap service errors in BadRequestException', async () => {
      trackedRepoService.enqueueScan.mockRejectedValueOnce(
        new Error('Not found'),
      );
      await expect(controller.scanRepo('bad-id')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createJob()', () => {
    it('should create and return a job', async () => {
      const result = await controller.createJob({
        repositoryUrl: 'https://github.com/foo/bar',
        filePath: 'src/index.ts',
      });
      expect(jobService.createJob).toHaveBeenCalledWith(
        'https://github.com/foo/bar',
        'src/index.ts',
      );
      expect(result).toBe(mockJob);
    });

    it('should throw BadRequestException when repositoryUrl is missing', async () => {
      await expect(
        controller.createJob({ repositoryUrl: '', filePath: 'src/index.ts' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when filePath is missing', async () => {
      await expect(
        controller.createJob({
          repositoryUrl: 'https://github.com/foo/bar',
          filePath: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listJobs()', () => {
    it('should return all jobs', async () => {
      const result = await controller.listJobs();
      expect(jobService.listJobs).toHaveBeenCalled();
      expect(result).toEqual([mockJob]);
    });
  });

  describe('getJob()', () => {
    it('should return the job when found', async () => {
      const result = await controller.getJob('job-1');
      expect(jobService.getJob).toHaveBeenCalledWith('job-1');
      expect(result).toBe(mockJob);
    });

    it('should throw BadRequestException when job is not found', async () => {
      jobService.getJob.mockResolvedValueOnce(null);
      await expect(controller.getJob('missing')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
