import { TrackedRepository } from './tracked-repository.entity';

export const TRACKED_REPOSITORY_REPOSITORY_TOKEN =
  'TRACKED_REPOSITORY_REPOSITORY_TOKEN';

export interface ITrackedRepositoryRepository {
  save(repository: TrackedRepository): Promise<void>;
  findById(id: string): Promise<TrackedRepository | null>;
  findByUrl(url: string): Promise<TrackedRepository | null>;
  findAll(): Promise<TrackedRepository[]>;
}
