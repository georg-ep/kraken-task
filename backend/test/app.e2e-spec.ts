import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { COVERAGE_IMPROVEMENT_QUEUE, REPO_SCAN_QUEUE } from '../src/infrastructure/jobs/bull-mq.module';

describe('ApiController (e2e)', () => {
  let app: INestApplication;

  // Mock BullMQ Queues to prevent Redis connection issues in testing
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken(COVERAGE_IMPROVEMENT_QUEUE))
      .useValue(mockQueue)
      .overrideProvider(getQueueToken(REPO_SCAN_QUEUE))
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/jobs (POST) - Happy Path', async () => {
    // 1. Send request
    const response = await request(app.getHttpServer())
      .post('/api/jobs')
      .send({
        repositoryUrl: 'https://github.com/test/repo',
        filePath: 'src/main.ts',
      })
      .expect(201); // NestJS POST default is 201 Created

    // 2. Validate response shape (the job entity)
    expect(response.body).toHaveProperty('id');
    expect(response.body.repositoryUrl).toBe('https://github.com/test/repo');
    expect(response.body.filePath).toBe('src/main.ts');
    expect(response.body.status).toBe('QUEUED');
    expect(response.body.targetCoverage).toBe(80); // Default

    // 3. Verify it was pushed to the BullMQ Queue
    expect(mockQueue.add).toHaveBeenCalledWith(
      'improve-coverage', 
      { jobId: response.body.id }, 
      { jobId: response.body.id }
    );
  });

  it('/api/jobs (POST) - Validation Failure', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/jobs')
      .send({
        repositoryUrl: 'https://github.com/test/repo',
        // Missing filePath
      })
      .expect(400); 

    expect(response.body.message).toContain('repositoryUrl and filePath are required');
  });
});
