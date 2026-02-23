import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const COVERAGE_IMPROVEMENT_QUEUE = 'coverage-improvement';
export const REPO_SCAN_QUEUE = 'repo-scan';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: COVERAGE_IMPROVEMENT_QUEUE },
      { name: REPO_SCAN_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class BullMQModule {}
