export const REPOSITORY_HOST_TOKEN = 'REPOSITORY_HOST_TOKEN';

export interface IRepositoryHost {
  /**
   * Checks if the repository contains specific dependencies in its package.json.
   * Useful to ensure the project has required tooling (e.g., jest) before cloning.
   */
  hasRequiredDependencies(repositoryUrl: string, dependencies: string[]): Promise<boolean>;

  /**
   * Checks if the current token has push permissions to the repository.
   */
  checkPermissions(repositoryUrl: string): Promise<boolean>;

  /**
   * Clones a repository to a local temporary path.
   * Returns the local path where it was cloned.
   */
  cloneRepository(repositoryUrl: string, branch?: string): Promise<string>;

  /**
   * Retrieves the current default branch of a cloned local repository.
   */
  getDefaultBranch(localPath: string): Promise<string>;

  /**
   * Creates a new branch, commits the given file changes, and pushes the branch.
   * fileChanges is a map of absoluteFilePath -> newContent
   * Returns the name of the new branch pushed.
   */
  commitAndPushChanges(
    localPath: string,
    branchName: string,
    fileMap: Record<string, string>,
    commitMessage: string,
    /** Only these paths (relative to localPath) will be staged. */
    pathsToAdd?: string[],
  ): Promise<void>;

  /**
   * Creates a Pull Request on GitHub.
   * Returns the URL of the created PR.
   */
  createPullRequest(
    repositoryUrl: string,
    branchName: string,
    title: string,
    body: string,
    baseBranch?: string
  ): Promise<string>;
  
  /**
   * Cleans up the cloned repository.
   */
  cleanupLocalRepository(localPath: string): Promise<void>;
}
