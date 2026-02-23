import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { JobOrchestrationService } from '../../application/services/job-orchestration.service';
import { TrackedRepositoryService } from '../../application/services/tracked-repository.service';

export class CreateJobDto {
  repositoryUrl: string;
  filePath: string;
}

@Controller('api')
export class ApiController {
  constructor(
    private readonly jobService: JobOrchestrationService,
    private readonly trackedRepoService: TrackedRepositoryService,
  ) {}

  @Get('repos')
  async listRepos() {
    return this.trackedRepoService.listRepositories();
  }

  @Post('repos')
  async addRepo(@Body('repositoryUrl') repositoryUrl: string) {
    if (!repositoryUrl) {
      throw new BadRequestException('repositoryUrl is required');
    }
    return this.trackedRepoService.addRepository(repositoryUrl);
  }

  @Post('repos/:id/scan')
  async scanRepo(@Param('id') id: string) {
    try {
      return await this.trackedRepoService.enqueueScan(id);
    } catch (e: any) {
      throw new BadRequestException(`Failed to enqueue scan: ${e.message}`);
    }
  }

  @Post('jobs')
  async createJob(@Body() dto: CreateJobDto) {
    if (!dto.repositoryUrl || !dto.filePath) {
      throw new BadRequestException('repositoryUrl and filePath are required');
    }
    return this.jobService.createJob(dto.repositoryUrl, dto.filePath);
  }

  @Get('jobs')
  async listJobs() {
    return this.jobService.listJobs();
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.jobService.getJob(id);
    if (!job) {
      throw new BadRequestException('Job not found');
    }
    return job;
  }
}
