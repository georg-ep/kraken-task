import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TrackedRepository } from '../../../domain/repository/tracked-repository.entity';

@Entity('tracked_repositories')
export class TrackedRepositoryTypeormEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ unique: true })
  url: string;

  @Column({ type: 'json', nullable: true })
  lastCoverageReport: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  static fromDomain(domainEntity: TrackedRepository): TrackedRepositoryTypeormEntity {
    const entity = new TrackedRepositoryTypeormEntity();
    entity.id = domainEntity.id;
    entity.url = domainEntity.url;
    entity.lastCoverageReport = domainEntity.lastCoverageReport;
    entity.createdAt = domainEntity.createdAt || new Date();
    entity.updatedAt = domainEntity.updatedAt || new Date();
    return entity;
  }

  toDomain(): TrackedRepository {
    return new TrackedRepository(
      this.id,
      this.url,
      this.lastCoverageReport,
      this.createdAt,
      this.updatedAt,
    );
  }
}
