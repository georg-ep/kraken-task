import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { IAIGenerator } from '../../domain/job/ai-generator.interface';
import { ImprovementJob } from '../../domain/job/job.entity';
import { IJobRepository } from '../../domain/job/job.repository.interface';
import { JobStatus } from '../../domain/job/job.value-objects';
import { IRepositoryHost } from '../../domain/repository/repository-host.interface';
import { ImproveCoverageUseCase } from './improve-coverage.use-case';

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    rm: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('ImproveCoverageUseCase', () => {
  let useCase: ImproveCoverageUseCase;
  let jobRepository: jest.Mocked<IJobRepository>;
  let githubService: jest.Mocked<IRepositoryHost>;
  let aiGenerator: jest.Mocked<IAIGenerator>;
  
  const mockJobId = 'test-job-1';
  const mockRepoUrl = 'https://github.com/test/repo';
  const mockFilePath = 'src/test.file.ts';
  let mockJob: ImprovementJob;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    mockJob = ImprovementJob.create(mockJobId, mockRepoUrl, mockFilePath);

    jobRepository = {
      save: jest.fn(),
      findById: jest.fn().mockResolvedValue(mockJob),
      findAll: jest.fn(),
    } as unknown as jest.Mocked<IJobRepository>;

    githubService = {
      checkPermissions: jest.fn().mockResolvedValue(true),
      cloneRepository: jest.fn().mockResolvedValue('/tmp/clones/repo'),
      getDefaultBranch: jest.fn().mockResolvedValue('main'),
      commitAndPushChanges: jest.fn().mockResolvedValue(undefined),
      createPullRequest: jest.fn().mockResolvedValue('https://github.com/pr/1'),
      cleanupLocalRepository: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IRepositoryHost>;

    aiGenerator = {
      generateTest: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IAIGenerator>;

    useCase = new ImproveCoverageUseCase(jobRepository, githubService, aiGenerator);
    // Suppress logger output to keep test console clean
    (useCase as any).logger = { log: jest.fn(), error: jest.fn() } as unknown as Logger;
  });

  it('should abort if job is not found', async () => {
    jobRepository.findById.mockResolvedValueOnce(null);
    await useCase.execute('invalid-id');

    expect(githubService.checkPermissions).not.toHaveBeenCalled();
    expect((useCase as any).logger.error).toHaveBeenCalledWith('Job invalid-id not found');
  });

  it('should fail the job if github permissions and push access fail', async () => {
    githubService.checkPermissions.mockResolvedValueOnce(false);
    
    await useCase.execute(mockJobId);

    expect(mockJob.status).toBe(JobStatus.FAILED);
    expect(mockJob.errorMessage).toContain('Insufficient permissions');
    expect(jobRepository.save).toHaveBeenCalledWith(mockJob);
    expect(githubService.cloneRepository).not.toHaveBeenCalled();
  });

  it('should execute the happy path successfully', async () => {
    // Mock fs.access to resolve successfully (simulating file exists)
    (fs.access as jest.Mock).mockResolvedValue(undefined);

    await useCase.execute(mockJobId);

    // Verify updates flow
    expect(jobRepository.save).toHaveBeenCalledTimes(5); // CLONING, ANALYZING, GENERATING, PUSHING, PR_CREATED
    
    expect(githubService.cloneRepository).toHaveBeenCalledWith(mockRepoUrl);
    expect(githubService.getDefaultBranch).toHaveBeenCalledWith('/tmp/clones/repo');
    
    expect(aiGenerator.generateTest).toHaveBeenCalledWith(
      mockFilePath,
      'src/test.file.test.ts', // the .test.ts default fallback
      '/tmp/clones/repo',
      80
    );

    expect(githubService.commitAndPushChanges).toHaveBeenCalledWith(
      '/tmp/clones/repo',
      `improve-coverage-${mockJobId}`,
      {},
      `test: improve coverage for ${mockFilePath}`,
      ['src/test.file.test.ts'], // Only the generated spec file is staged
    );

    expect(githubService.createPullRequest).toHaveBeenCalledWith(
      mockRepoUrl,
      `improve-coverage-${mockJobId}`,
      `Improve test coverage for ${mockFilePath}`,
      expect.any(String),
      'main'
    );

    expect(mockJob.status).toBe(JobStatus.PR_CREATED);
    expect(mockJob.prLink).toBe('https://github.com/pr/1');

    // Ensure cleanup always happens
    expect(githubService.cleanupLocalRepository).toHaveBeenCalledWith('/tmp/clones/repo');
  });

  it('should fail nicely when the file to improve does not exist in the cloned repo', async () => {
    // Mock fs.access to REJECT (simulating file missing)
    (fs.access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));

    await useCase.execute(mockJobId);

    expect(mockJob.status).toBe(JobStatus.FAILED);
    expect(mockJob.errorMessage).toContain(`File ${mockFilePath} not found in repository`);
    
    // Cleanup should still run!
    expect(githubService.cleanupLocalRepository).toHaveBeenCalledWith('/tmp/clones/repo');
  });

  it('should transition to FAILED and still cleanup on arbitrary inner errors', async () => {
    // Mock clone to throw error
    githubService.cloneRepository.mockRejectedValueOnce(new Error('Git clone failed'));

    await useCase.execute(mockJobId);

    expect(mockJob.status).toBe(JobStatus.FAILED);
    expect(mockJob.errorMessage).toBe('Git clone failed');

    // It should not have been able to cleanup because localRepoPath is empty,
    // so cleanup shouldn't be called.
    expect(githubService.cleanupLocalRepository).not.toHaveBeenCalled();
  });
});
