import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { ImprovementJob } from '../../domain/job/job.entity';
import type { IJobRepository } from '../../domain/job/job.repository.interface';
import { JOB_REPOSITORY_TOKEN } from '../../domain/job/job.repository.interface';
import { COVERAGE_IMPROVEMENT_QUEUE } from '../../infrastructure/jobs/bull-mq.module';

@Injectable()
export class JobOrchestrationService {
  private readonly logger = new Logger(JobOrchestrationService.name);

  constructor(
    @Inject(JOB_REPOSITORY_TOKEN) private readonly jobRepository: IJobRepository,
    @InjectQueue(COVERAGE_IMPROVEMENT_QUEUE) private readonly queue: Queue,
  ) {}

  async createJob(repositoryUrl: string, filePath: string): Promise<ImprovementJob> {
    const job = ImprovementJob.create(uuidv4(), repositoryUrl, filePath);
    await this.jobRepository.save(job);
    await this.queue.add('improve-coverage', { jobId: job.id }, { jobId: job.id });
    this.logger.log(`Job ${job.id} queued for ${filePath} in ${repositoryUrl}`);
    return job;
  }

  async listJobs(): Promise<ImprovementJob[]> {
    return this.jobRepository.findAll();
  }

  async getJob(id: string): Promise<ImprovementJob | null> {
    return this.jobRepository.findById(id);
  }
}
