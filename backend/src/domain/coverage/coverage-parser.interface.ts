export const COVERAGE_PARSER_TOKEN = 'COVERAGE_PARSER_TOKEN';

export interface FileCoverage {
  filePath: string;
  linesCoverage: number;
}

export interface ICoverageParser {
  /**
   * Scans a local repository for its test coverage.
   * Runs tests if necessary, or reads existing coverage output.
   * Returns an array of file coverages.
   */
  scanCoverage(localPath: string): Promise<FileCoverage[]>;
}
