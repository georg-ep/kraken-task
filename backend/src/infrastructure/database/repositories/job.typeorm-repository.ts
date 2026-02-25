import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ImprovementJob } from '../../../domain/job/job.entity';
import {
  ACTIVE_JOB_STATUSES,
  IJobRepository,
} from '../../../domain/job/job.repository.interface';
import { JobTypeormEntity } from '../entities/job.typeorm-entity';

@Injectable()
export class JobTypeormRepository implements IJobRepository {
  constructor(
    @InjectRepository(JobTypeormEntity)
    private readonly repository: Repository<JobTypeormEntity>,
  ) {}

  async save(job: ImprovementJob): Promise<ImprovementJob> {
    const entity = JobTypeormEntity.fromDomain(job);
    const savedEntity = await this.repository.save(entity);
    return savedEntity.toDomain();
  }

  async findById(id: string): Promise<ImprovementJob | null> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return null;
    return entity.toDomain();
  }

  async findByRepository(repositoryUrl: string): Promise<ImprovementJob[]> {
    const entities = await this.repository.find({
      where: { repositoryUrl },
      order: { createdAt: 'DESC' },
    });
    return entities.map((e) => e.toDomain());
  }

  async findAll(): Promise<ImprovementJob[]> {
    const entities = await this.repository.find({
      order: { createdAt: 'DESC' },
    });
    return entities.map((e) => e.toDomain());
  }

  /**
   * Returns the first in-flight job for the given repository URL, excluding
   * the caller's own jobId. Used by the processor to enforce per-repo
   * serialization: if this returns a job, the caller must wait.
   */
  async findActiveByRepository(
    repositoryUrl: string,
    excludeJobId: string,
  ): Promise<ImprovementJob | null> {
    const entity = await this.repository.findOne({
      where: {
        repositoryUrl,
        id: Not(excludeJobId),
        status: In([...ACTIVE_JOB_STATUSES]),
      },
      order: { createdAt: 'ASC' },
    });
    return entity ? entity.toDomain() : null;
  }
}
