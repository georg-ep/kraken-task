import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import type { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { REPOSITORY_HOST_TOKEN } from '../../domain/repository/repository-host.interface';
import { TrackedRepository } from '../../domain/repository/tracked-repository.entity';
import type { ITrackedRepositoryRepository } from '../../domain/repository/tracked-repository.repository.interface';
import { TRACKED_REPOSITORY_REPOSITORY_TOKEN } from '../../domain/repository/tracked-repository.repository.interface';
import { REPO_SCAN_QUEUE } from '../../infrastructure/jobs/bull-mq.module';

@Injectable()
export class TrackedRepositoryService {
  private readonly logger = new Logger(TrackedRepositoryService.name);

  constructor(
    @Inject(TRACKED_REPOSITORY_REPOSITORY_TOKEN) private readonly repository: ITrackedRepositoryRepository,
    @Inject(REPOSITORY_HOST_TOKEN) private readonly repositoryHost: IRepositoryHost,
    @InjectQueue(REPO_SCAN_QUEUE) private readonly scanQueue: Queue,
  ) {}

  async listRepositories(): Promise<TrackedRepository[]> {
    return this.repository.findAll();
  }

  async addRepository(url: string): Promise<TrackedRepository> {
    let repo = await this.repository.findByUrl(url);
    if (!repo) {
      // Pre-flight check: Ensure the repository has 'jest' installed in its package.json
      const hasJest = await this.repositoryHost.hasRequiredDependencies(url, ['jest', 'ts-jest']);
      if (!hasJest) {
        throw new BadRequestException('Repository must have Jest and ts-jest installed in package.json to be tracked');
      }

      repo = TrackedRepository.create(uuidv4(), url);
      await this.repository.save(repo);
      
      // Automatically trigger initial scan
      await this.enqueueScan(repo.id);
    }
    return repo;
  }

  /**
   * Enqueues a coverage scan for the given repo ID.
   * Returns immediately — the processor runs the scan off the main thread.
   */
  async enqueueScan(id: string): Promise<{ queued: true; repoId: string }> {
    const repo = await this.repository.findById(id);
    if (!repo) {
      throw new NotFoundException('Repository not found');
    }

    await this.scanQueue.add('scan-repo', { repoId: id }, { jobId: `scan-${id}-${Date.now()}` });
    this.logger.log(`Coverage scan enqueued for repo ${id} (${repo.url})`);
    return { queued: true, repoId: id };
  }
}
