import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ImproveCoverageUseCase } from './application/use-cases/improve-coverage.use-case';
import { COVERAGE_PARSER_TOKEN } from './domain/coverage/coverage-parser.interface';
import { AI_GENERATOR_TOKEN } from './domain/job/ai-generator.interface';
import { REPOSITORY_HOST_TOKEN } from './domain/repository/repository-host.interface';
import { GeminiGeneratorService } from './infrastructure/ai/gemini-generator.service';
import { TestPromptBuilder } from './infrastructure/ai/test-prompt.builder';
import { DependencyAnalyzerService } from './infrastructure/ast/dependency-analyzer.service';
import { validateEnv } from './infrastructure/config/env.validation';
import { CoverageParserService } from './infrastructure/coverage/coverage-parser.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { GitHubService } from './infrastructure/github/github.service';
import { BullMQModule } from './infrastructure/jobs/bull-mq.module';
import { CoverageImprovementProcessor } from './infrastructure/jobs/coverage-improvement.processor';
import { RepoScanProcessor } from './infrastructure/jobs/repo-scan.processor';
import { SandboxExecutorService } from './infrastructure/sandbox/sandbox-executor.service';
import { TestValidatorService } from './infrastructure/validation/test-validator.service';

/**
 * This module runs ONLY in the worker process — no HTTP server, no ApiModule.
 * It wires up BullMQ processors with everything they need to do their work.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../.env'] }),

    DatabaseModule,
    BullMQModule,
  ],
  providers: [
    { provide: REPOSITORY_HOST_TOKEN, useClass: GitHubService },
    { provide: AI_GENERATOR_TOKEN, useClass: GeminiGeneratorService },
    { provide: COVERAGE_PARSER_TOKEN, useClass: CoverageParserService },
    TestPromptBuilder,
    DependencyAnalyzerService,
    SandboxExecutorService,
    TestValidatorService,
    ImproveCoverageUseCase,
    CoverageImprovementProcessor,
    RepoScanProcessor,
  ],
})
export class WorkerModule {}
