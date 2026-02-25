import { JobStatus } from './job.value-objects';

export class ImprovementJob {
  constructor(
    public id: string,
    public repositoryUrl: string,
    public filePath: string,
    public targetCoverage: number,
    public status: JobStatus,
    public prLink?: string,
    public errorMessage?: string,
    public createdAt?: Date,
    public updatedAt?: Date,
  ) {}

  public static create(
    id: string,
    repositoryUrl: string,
    filePath: string,
    targetCoverage: number = 80,
  ): ImprovementJob {
    return new ImprovementJob(
      id,
      repositoryUrl,
      filePath,
      targetCoverage,
      JobStatus.QUEUED,
      undefined,
      undefined,
      new Date(),
      new Date(),
    );
  }

  public updateStatus(
    status: JobStatus,
    errorMessage?: string,
    prLink?: string,
  ): void {
    this.status = status;
    if (errorMessage) this.errorMessage = errorMessage;
    if (prLink) this.prLink = prLink;
    this.updatedAt = new Date();
  }
}
