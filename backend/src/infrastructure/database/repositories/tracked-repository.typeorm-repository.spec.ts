import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedRepository } from '../../../domain/repository/tracked-repository.entity';
import { TrackedRepositoryTypeormEntity } from '../entities/tracked-repository.typeorm-entity';
import { TrackedRepositoryTypeormRepository } from './tracked-repository.typeorm-repository';

describe('TrackedRepositoryTypeormRepository', () => {
  let repository: TrackedRepositoryTypeormRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [TrackedRepositoryTypeormEntity],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([TrackedRepositoryTypeormEntity]),
      ],
      providers: [TrackedRepositoryTypeormRepository],
    }).compile();

    repository = module.get<TrackedRepositoryTypeormRepository>(
      TrackedRepositoryTypeormRepository,
    );
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('save() and findById()', () => {
    it('should persist and retrieve a domain entity by ID', async () => {
      const repo = TrackedRepository.create(
        'repo-id-1',
        'https://github.com/foo/bar',
      );

      await repository.save(repo);
      const found = await repository.findById('repo-id-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('repo-id-1');
      expect(found!.url).toBe('https://github.com/foo/bar');
    });

    it('should return null when the ID does not exist', async () => {
      const found = await repository.findById('does-not-exist');
      expect(found).toBeNull();
    });
  });

  describe('findByUrl()', () => {
    it('should find a repository by its URL', async () => {
      const repo = TrackedRepository.create(
        'repo-id-2',
        'https://github.com/test/repo',
      );
      await repository.save(repo);

      const found = await repository.findByUrl('https://github.com/test/repo');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('repo-id-2');
    });

    it('should return null when URL does not exist', async () => {
      const found = await repository.findByUrl('https://github.com/not/here');
      expect(found).toBeNull();
    });
  });

  describe('findAll()', () => {
    it('should return all saved repositories', async () => {
      await repository.save(
        TrackedRepository.create('id-a', 'https://github.com/a/a'),
      );
      await repository.save(
        TrackedRepository.create('id-b', 'https://github.com/b/b'),
      );

      const all = await repository.findAll();

      expect(all.length).toBe(2);
      // Should be DESC by createdAt, both were created at nearly same time
      const ids = all.map((r) => r.id);
      expect(ids).toContain('id-a');
      expect(ids).toContain('id-b');
    });

    it('should return an empty array when no repositories are stored', async () => {
      const all = await repository.findAll();
      expect(all).toEqual([]);
    });
  });
});
