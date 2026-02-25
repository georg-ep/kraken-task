import 'reflect-metadata';
import { ImproveCoverageUseCase } from '../../application/use-cases/improve-coverage.use-case';
import { CoverageImprovementProcessor } from './coverage-improvement.processor';

describe('CoverageImprovementProcessor', () => {
  let processor: CoverageImprovementProcessor;
  let improveCoverageUseCase: jest.Mocked<ImproveCoverageUseCase>;

  beforeEach(() => {
    improveCoverageUseCase = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ImproveCoverageUseCase>;

    processor = new CoverageImprovementProcessor(improveCoverageUseCase);
    (processor as any).logger = { log: jest.fn(), error: jest.fn() };
  });

  describe('process()', () => {
    it('should call improveCoverageUseCase.execute with the jobId from job data', async () => {
      const mockJob = { data: { jobId: 'job-abc-123' } } as any;

      await processor.process(mockJob);

      expect(improveCoverageUseCase.execute).toHaveBeenCalledWith(
        'job-abc-123',
      );
      expect(improveCoverageUseCase.execute).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors thrown by the use case', async () => {
      const mockJob = { data: { jobId: 'job-fail' } } as any;
      improveCoverageUseCase.execute.mockRejectedValueOnce(
        new Error('Use case exploded'),
      );

      await expect(processor.process(mockJob)).rejects.toThrow(
        'Use case exploded',
      );
    });

    it('should be configured with concurrency 1 for strict job serialisation', () => {
      const workerMetadata = Reflect.getMetadata(
        'bullmq:worker_metadata',
        CoverageImprovementProcessor,
      );
      expect(workerMetadata).toBeDefined();
      expect(workerMetadata).toHaveProperty('concurrency');
      expect(workerMetadata.concurrency).toBe(1);
    });
  });
});
