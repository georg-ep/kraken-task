import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JOB_REPOSITORY_TOKEN } from '../../domain/job/job.repository.interface';
import { TRACKED_REPOSITORY_REPOSITORY_TOKEN } from '../../domain/repository/tracked-repository.repository.interface';
import { JobTypeormEntity } from './entities/job.typeorm-entity';
import { TrackedRepositoryTypeormEntity } from './entities/tracked-repository.typeorm-entity';
import { JobTypeormRepository } from './repositories/job.typeorm-repository';
import { TrackedRepositoryTypeormRepository } from './repositories/tracked-repository.typeorm-repository';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get<string>('DB_PATH', 'database.sqlite'),
        entities: [JobTypeormEntity, TrackedRepositoryTypeormEntity],
        // TRADE-OFF: synchronize: true is great for rapid prototyping as it auto-creates tables,
        // but it is UNSAFE for production. A real production app would use migration scripts.
        synchronize: config.get('NODE_ENV') !== 'production',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([JobTypeormEntity, TrackedRepositoryTypeormEntity]),
  ],
  providers: [
    {
      provide: JOB_REPOSITORY_TOKEN,
      useClass: JobTypeormRepository,
    },
    {
      provide: TRACKED_REPOSITORY_REPOSITORY_TOKEN,
      useClass: TrackedRepositoryTypeormRepository,
    },
  ],
  exports: [JOB_REPOSITORY_TOKEN, TRACKED_REPOSITORY_REPOSITORY_TOKEN],
})
export class DatabaseModule {}
