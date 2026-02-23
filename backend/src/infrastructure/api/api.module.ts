import { Module } from '@nestjs/common';
import { JobOrchestrationService } from '../../application/services/job-orchestration.service';
import { TrackedRepositoryService } from '../../application/services/tracked-repository.service';
import { REPOSITORY_HOST_TOKEN } from '../../domain/repository/repository-host.interface';
import { DatabaseModule } from '../database/database.module';
import { GitHubService } from '../github/github.service';
import { BullMQModule } from '../jobs/bull-mq.module';
import { ApiController } from './api.controller';

/**
 * HTTP-only module. No processors, no heavy dependencies.
 * Enqueues jobs via BullMQ — actual work happens in the worker process.
 */
@Module({
  imports: [
    DatabaseModule,
    BullMQModule,
  ],
  controllers: [ApiController],
  providers: [
    JobOrchestrationService,
    TrackedRepositoryService,
    { provide: REPOSITORY_HOST_TOKEN, useClass: GitHubService },
  ],
  exports: [JobOrchestrationService, TrackedRepositoryService],
})
export class ApiModule {}
