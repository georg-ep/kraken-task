import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ApiModule } from './infrastructure/api/api.module';
import { validateEnv } from './infrastructure/config/env.validation';
import { DatabaseModule } from './infrastructure/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../.env'] }),

    DatabaseModule,
    ApiModule,
  ],
})
export class AppModule {}
