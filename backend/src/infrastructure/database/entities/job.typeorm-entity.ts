import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ImprovementJob } from '../../../domain/job/job.entity';
import { JobStatus } from '../../../domain/job/job.value-objects';

@Entity('jobs')
export class JobTypeormEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  repositoryUrl: string;

  @Column()
  filePath: string;

  @Column('int')
  targetCoverage: number;

  @Column({
    type: 'varchar',
    default: JobStatus.QUEUED,
  })
  status: JobStatus;

  @Column({ nullable: true })
  prLink?: string;

  @Column({ nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  static fromDomain(domainJob: ImprovementJob): JobTypeormEntity {
    const entity = new JobTypeormEntity();
    entity.id = domainJob.id;
    entity.repositoryUrl = domainJob.repositoryUrl;
    entity.filePath = domainJob.filePath;
    entity.targetCoverage = domainJob.targetCoverage;
    entity.status = domainJob.status;
    entity.prLink = domainJob.prLink;
    entity.errorMessage = domainJob.errorMessage;
    entity.createdAt = domainJob.createdAt || new Date();
    entity.updatedAt = domainJob.updatedAt || new Date();
    return entity;
  }

  toDomain(): ImprovementJob {
    return new ImprovementJob(
      this.id,
      this.repositoryUrl,
      this.filePath,
      this.targetCoverage,
      this.status,
      this.prLink,
      this.errorMessage,
      this.createdAt,
      this.updatedAt,
    );
  }
}
