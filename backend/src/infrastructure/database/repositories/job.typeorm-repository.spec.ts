import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImprovementJob } from '../../../domain/job/job.entity';
import { JobStatus } from '../../../domain/job/job.value-objects';
import { JobTypeormEntity } from '../entities/job.typeorm-entity';
import { JobTypeormRepository } from './job.typeorm-repository';

describe('JobTypeormRepository', () => {
  let repository: JobTypeormRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [JobTypeormEntity],
          synchronize: true, // creates the schema automatically for testing
        }),
        TypeOrmModule.forFeature([JobTypeormEntity]),
      ],
      providers: [JobTypeormRepository],
    }).compile();

    repository = module.get<JobTypeormRepository>(JobTypeormRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('save() and findById()', () => {
    it('should save a domain entity and retrieve it perfectly mapped', async () => {
      const job = ImprovementJob.create(
        '123e4567-e89b-12d3-a456-426614174000',
        'https://github.com/foo/bar',
        'src/index.ts',
        85
      );
      job.updateStatus(JobStatus.ANALYZING);

      const savedJob = await repository.save(job);
      expect(savedJob.id).toBe(job.id);
      expect(savedJob.status).toBe(JobStatus.ANALYZING);

      // Retrieve via findById to ensure DB persistence
      const retrievedJob = await repository.findById(job.id);
      
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob!.id).toBe(job.id);
      expect(retrievedJob!.repositoryUrl).toBe('https://github.com/foo/bar');
      expect(retrievedJob!.targetCoverage).toBe(85);
      expect(retrievedJob!.status).toBe(JobStatus.ANALYZING);
    });

    it('should return null if the job does not exist', async () => {
      const result = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('findByRepository()', () => {
    it('should return jobs associated with a repository ordered by creation date', async () => {
      const repoUrl = 'https://github.com/test/repo';
      
      const job1 = ImprovementJob.create('11111111-1111-1111-1111-111111111111', repoUrl, 'src/test1.ts');
      job1.createdAt = new Date('2026-01-01T00:00:00Z');
      await repository.save(job1);

      const job2 = ImprovementJob.create('22222222-2222-2222-2222-222222222222', repoUrl, 'src/test2.ts');
      job2.createdAt = new Date('2026-01-02T00:00:00Z');
      await repository.save(job2);

      const results = await repository.findByRepository(repoUrl);
      
      expect(results.length).toBe(2);
      expect(results[0].id).toBe(job2.id); // Assuming DESC order in implementation
      expect(results[1].id).toBe(job1.id);
    });
  });

});
