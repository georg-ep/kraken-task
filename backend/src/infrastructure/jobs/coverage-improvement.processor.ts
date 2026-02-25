import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImproveCoverageUseCase } from '../../application/use-cases/improve-coverage.use-case';
import { COVERAGE_IMPROVEMENT_QUEUE } from './bull-mq.module';

/**
 * Concurrency of 1 means BullMQ processes jobs one at a time, in the order
 * they were enqueued. This naturally serialises all jobs — including multiple
 * jobs queued for the same repository — without any polling or retry logic.
 * When a job completes, BullMQ immediately picks up the next one from the queue.
 */
@Processor(COVERAGE_IMPROVEMENT_QUEUE, { concurrency: 1 })
export class CoverageImprovementProcessor extends WorkerHost {
  private readonly logger = new Logger(CoverageImprovementProcessor.name);

  constructor(private readonly improveCoverageUseCase: ImproveCoverageUseCase) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;
    this.logger.log(`Processing improvement job ${jobId}`);
    await this.improveCoverageUseCase.execute(jobId);
  }
}
