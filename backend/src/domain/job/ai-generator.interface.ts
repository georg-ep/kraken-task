export const AI_GENERATOR_TOKEN = 'AI_GENERATOR_TOKEN';

export interface IAIGenerator {
  /**
   * Generates or improves a test file using the Gemini CLI.
   * The CLI writes the file directly to disk.
   */
  generateTest(
    sourceFilePath: string,
    testFilePath: string,
    localRepoPath: string,
    targetCoverage?: number
  ): Promise<void>;
}
