import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackedRepository } from '../../../domain/repository/tracked-repository.entity';
import { ITrackedRepositoryRepository } from '../../../domain/repository/tracked-repository.repository.interface';
import { TrackedRepositoryTypeormEntity } from '../entities/tracked-repository.typeorm-entity';

@Injectable()
export class TrackedRepositoryTypeormRepository implements ITrackedRepositoryRepository {
  constructor(
    @InjectRepository(TrackedRepositoryTypeormEntity)
    private readonly repository: Repository<TrackedRepositoryTypeormEntity>,
  ) {}

  async save(domainEntity: TrackedRepository): Promise<void> {
    const entity = TrackedRepositoryTypeormEntity.fromDomain(domainEntity);
    await this.repository.save(entity);
  }

  async findById(id: string): Promise<TrackedRepository | null> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return null;
    return entity.toDomain();
  }

  async findByUrl(url: string): Promise<TrackedRepository | null> {
    const entity = await this.repository.findOne({ where: { url } });
    if (!entity) return null;
    return entity.toDomain();
  }

  async findAll(): Promise<TrackedRepository[]> {
    const entities = await this.repository.find({
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => entity.toDomain());
  }
}
