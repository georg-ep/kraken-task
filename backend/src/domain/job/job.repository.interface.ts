import { ImprovementJob } from './job.entity';

export const JOB_REPOSITORY_TOKEN = 'JOB_REPOSITORY_TOKEN';

/** The set of statuses that mean a job is actively using the repository on disk. */
export const ACTIVE_JOB_STATUSES = [
  'CLONING',
  'ANALYZING',
  'GENERATING',
  'PUSHING',
] as const;

export interface IJobRepository {
  save(job: ImprovementJob): Promise<ImprovementJob>;
  findById(id: string): Promise<ImprovementJob | null>;
  findByRepository(repositoryUrl: string): Promise<ImprovementJob[]>;
  findAll(): Promise<ImprovementJob[]>;
  /** Returns the first job for the given repo that is actively in-flight, excluding the given job id. */
  findActiveByRepository(
    repositoryUrl: string,
    excludeJobId: string,
  ): Promise<ImprovementJob | null>;
}
