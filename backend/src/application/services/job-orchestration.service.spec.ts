import { Queue } from 'bullmq';
import { ImprovementJob } from '../../domain/job/job.entity';
import { IJobRepository } from '../../domain/job/job.repository.interface';
import { JobOrchestrationService } from './job-orchestration.service';

describe('JobOrchestrationService', () => {
  let service: JobOrchestrationService;
  let jobRepository: jest.Mocked<IJobRepository>;
  let queue: jest.Mocked<Queue>;

  beforeEach(() => {
    jobRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<IJobRepository>;

    queue = {
      add: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<Queue>;

    service = new JobOrchestrationService(jobRepository, queue);
    (service as any).logger = { log: jest.fn(), error: jest.fn() };
  });

  describe('createJob()', () => {
    it('should create a job, save it to the repository, and enqueue it', async () => {
      const repoUrl = 'https://github.com/foo/bar';
      const filePath = 'src/index.ts';

      const job = await service.createJob(repoUrl, filePath);

      expect(job).toBeDefined();
      expect(job.repositoryUrl).toBe(repoUrl);
      expect(job.filePath).toBe(filePath);
      expect(job.id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4

      expect(jobRepository.save).toHaveBeenCalledWith(job);
      expect(queue.add).toHaveBeenCalledWith(
        'improve-coverage',
        { jobId: job.id },
        { jobId: job.id },
      );
    });

    it('should generate a unique ID for each created job', async () => {
      const job1 = await service.createJob(
        'https://github.com/a/b',
        'src/a.ts',
      );
      const job2 = await service.createJob(
        'https://github.com/a/b',
        'src/b.ts',
      );

      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe('listJobs()', () => {
    it('should return all jobs from the repository', async () => {
      const result = await service.listJobs();
      expect(jobRepository.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getJob()', () => {
    it('should return null when job is not found', async () => {
      const result = await service.getJob('non-existent-id');
      expect(jobRepository.findById).toHaveBeenCalledWith('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return the job when found', async () => {
      const mockJob = ImprovementJob.create(
        'test-id',
        'https://github.com/a/b',
        'src/a.ts',
      );
      jobRepository.findById.mockResolvedValueOnce(mockJob);

      const result = await service.getJob('test-id');
      expect(result).toBe(mockJob);
    });
  });
});
