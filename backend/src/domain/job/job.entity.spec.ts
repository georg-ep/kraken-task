import { ImprovementJob } from './job.entity';
import { JobStatus } from './job.value-objects';

describe('ImprovementJob', () => {
  describe('create()', () => {
    it('should create a new job with default values', () => {
      const jobId = 'test-id';
      const repoUrl = 'https://github.com/foo/bar';
      const filePath = 'src/app.ts';

      const job = ImprovementJob.create(jobId, repoUrl, filePath);

      expect(job.id).toBe(jobId);
      expect(job.repositoryUrl).toBe(repoUrl);
      expect(job.filePath).toBe(filePath);
      expect(job.targetCoverage).toBe(80);
      expect(job.status).toBe(JobStatus.QUEUED);
      expect(job.errorMessage).toBeUndefined();
      expect(job.prLink).toBeUndefined();
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a new job with a custom target coverage', () => {
      const job = ImprovementJob.create('id', 'url', 'path', 95);
      expect(job.targetCoverage).toBe(95);
    });
  });

  describe('updateStatus()', () => {
    it('should update the status and updatedAt properties', () => {
      const job = ImprovementJob.create('1', 'url', 'path');
      const initialDate = job.updatedAt!;

      // Simulate time passing
      jest.useFakeTimers();
      jest.advanceTimersByTime(100);

      job.updateStatus(JobStatus.CLONING);

      expect(job.status).toBe(JobStatus.CLONING);
      expect(job.updatedAt!.getTime()).toBeGreaterThan(initialDate.getTime());

      jest.useRealTimers();
    });

    it('should update errorMessage when provided', () => {
      const job = ImprovementJob.create('1', 'url', 'path');
      job.updateStatus(JobStatus.FAILED, 'Something went wrong');

      expect(job.status).toBe(JobStatus.FAILED);
      expect(job.errorMessage).toBe('Something went wrong');
      expect(job.prLink).toBeUndefined();
    });

    it('should update prLink when provided', () => {
      const job = ImprovementJob.create('1', 'url', 'path');
      job.updateStatus(
        JobStatus.PR_CREATED,
        undefined,
        'https://github.com/pr/1',
      );

      expect(job.status).toBe(JobStatus.PR_CREATED);
      expect(job.prLink).toBe('https://github.com/pr/1');
      expect(job.errorMessage).toBeUndefined();
    });
  });
});
