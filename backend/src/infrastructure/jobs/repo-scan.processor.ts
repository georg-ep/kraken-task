import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { ICoverageParser } from '../../domain/coverage/coverage-parser.interface';
import { COVERAGE_PARSER_TOKEN } from '../../domain/coverage/coverage-parser.interface';
import type { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { REPOSITORY_HOST_TOKEN } from '../../domain/repository/repository-host.interface';
import type { ITrackedRepositoryRepository } from '../../domain/repository/tracked-repository.repository.interface';
import { TRACKED_REPOSITORY_REPOSITORY_TOKEN } from '../../domain/repository/tracked-repository.repository.interface';
import { REPO_SCAN_QUEUE } from './bull-mq.module';

@Processor(REPO_SCAN_QUEUE, { concurrency: 2 })
export class RepoScanProcessor extends WorkerHost {
  private readonly logger = new Logger(RepoScanProcessor.name);

  constructor(
    @Inject(TRACKED_REPOSITORY_REPOSITORY_TOKEN)
    private readonly repoRepository: ITrackedRepositoryRepository,
    @Inject(REPOSITORY_HOST_TOKEN)
    private readonly repositoryHost: IRepositoryHost,
    @Inject(COVERAGE_PARSER_TOKEN)
    private readonly coverageParser: ICoverageParser,
  ) {
    super();
  }

  async process(job: Job<{ repoId: string }>): Promise<void> {
    const { repoId } = job.data;
    this.logger.log(`Starting coverage scan for repo ${repoId}`);

    const repo = await this.repoRepository.findById(repoId);
    if (!repo) {
      this.logger.error(`Repo ${repoId} not found — skipping scan`);
      return;
    }

    let localPath = '';
    try {
      localPath = await this.repositoryHost.cloneRepository(repo.url);
      const coverage = await this.coverageParser.scanCoverage(localPath);
      repo.updateCoverage(coverage);
      await this.repoRepository.save(repo);
      this.logger.log(
        `Scan complete for ${repo.url} — ${coverage.length} files`,
      );
    } catch (err) {
      this.logger.error(`Scan failed for repo ${repoId}`, err);
      throw err; // let BullMQ handle retries
    } finally {
      if (localPath) {
        await this.repositoryHost
          .cleanupLocalRepository(localPath)
          .catch((err) =>
            this.logger.error(`Cleanup failed for ${localPath}`, err),
          );
      }
    }
  }
}
