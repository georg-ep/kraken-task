import 'reflect-metadata';
import { ICoverageParser } from '../../domain/coverage/coverage-parser.interface';
import { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { ITrackedRepositoryRepository } from '../../domain/repository/tracked-repository.repository.interface';
import { RepoScanProcessor } from './repo-scan.processor';

describe('RepoScanProcessor', () => {
  let processor: RepoScanProcessor;
  
  beforeEach(() => {
    processor = new RepoScanProcessor(
      {} as ITrackedRepositoryRepository,
      {} as IRepositoryHost,
      {} as ICoverageParser
    );
  });

  describe('The "Concurrency / Serialization" Test (Scalability)', () => {
    it('should be configured with concurrency limits to ensure worker stability', () => {
      // NestJS BullMQ @Processor decorators attach metadata to the class.
      // We can use reflection to assert that the concurrency was set safely.
      const workerMetadata = Reflect.getMetadata('bullmq:worker_metadata', RepoScanProcessor);
      
      expect(workerMetadata).toBeDefined();
      
      // Specifically testing for concurrency rules
      expect(workerMetadata).toHaveProperty('concurrency');
      expect(workerMetadata.concurrency).toBe(2);
    });
  });
});
