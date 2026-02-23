import { FileCoverage } from '../coverage/coverage-parser.interface';

export class TrackedRepository {
  constructor(
    public readonly id: string,
    public readonly url: string,
    public lastCoverageReport: FileCoverage[] | any, // Use FileCoverage[] or any fallback
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(id: string, url: string): TrackedRepository {
    const now = new Date();
    return new TrackedRepository(id, url, null, now, now);
  }

  updateCoverage(report: FileCoverage[] | any) {
    this.lastCoverageReport = report;
    this.updatedAt = new Date();
  }
}
