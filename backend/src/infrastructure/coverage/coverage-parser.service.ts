import { Injectable, Logger } from '@nestjs/common';
import { Dirent } from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {
  FileCoverage,
  ICoverageParser,
} from '../../domain/coverage/coverage-parser.interface';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';

// ─── constants ───────────────────────────────────────────────────────────────

/** Max time to allow npm install to run before killing the process. */
const INSTALL_TIMEOUT_MS = 120_000; // 2 min

/** Max time to allow jest to run before killing the process. */
const JEST_TIMEOUT_MS = 90_000; // 90 s

/**
 * Cap stdout/stderr buffers. Production repos can emit megabytes of test
 * output; without a cap workers OOM when output is captured.
 */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Directories that never contain testable source code.
 * Skipping them speeds up the fallback file-walk significantly.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'interfaces',
  'interface',
  'types',
  'type',
  'enums',
  'enum',
  'constants',
  'typings',
]);

/**
 * File suffix patterns that indicate a file contains no executable logic.
 * These are the single source of truth used by BOTH:
 *   1. walkTs — the fallback file-walker that produces 0% results
 *   2. buildMinimalJestConfig — the collectCoverageFrom exclusion list
 *
 * Keeping them in one place prevents the two code-paths drifting apart,
 * which would otherwise cause walkTs to include files that Jest was told
 * to ignore, falsely reporting them at 0%.
 */
const SKIP_SUFFIXES = [
  '*.d.ts',
  '*.interface.ts',
  '*.interfaces.ts',
  '*.types.ts',
  '*.type.ts',
  '*.enum.ts',
  '*.enums.ts',
  '*.constants.ts',
  '*.constant.ts',
  '*.spec.ts',
  '*.test.ts',
  '*.spec.tsx',
  '*.test.tsx',
  '*app.ts',
  '*main.ts',
  '*index.ts',
  '*.module.ts',
  '*.entity.ts',
] as const;

// Compiled regexes for fast matching in the file-walker.
const SKIP_FILE_REGEXES = SKIP_SUFFIXES.map(
  (s) => new RegExp(s.replace('*', '.*').replace('.', '\\.') + '$'),
);

/**
 * A minimal jest config injected ONLY when the scanned repo has no jest config
 * of its own and jest is not listed in its package.json.
 *
 * - Named with a unique prefix to avoid colliding with the repo's own files.
 * - Uses CommonJS (.cjs) so it loads correctly even in ESM repos
 *   (`"type": "module"` in package.json).
 * - Cleaned up in `finally` regardless of success or failure.
 */
const TEMP_JEST_CONFIG_NAME = 'jest.config.ci-scan.cjs';

/** Build collectCoverageFrom exclusions from SKIP_SUFFIXES so they never drift. */
function buildCollectCoverageFrom(): string[] {
  const excludes = SKIP_SUFFIXES.map((s) => `!**/${s}`);
  const dirExcludes = Array.from(SKIP_DIRS).map((d) => `!**/${d}/**`);
  return ['**/*.{ts,tsx}', ...excludes, ...dirExcludes];
}

function buildMinimalJestConfig(localPath: string): string {
  const collectCoverageFrom = buildCollectCoverageFrom()
    .map((p) => `    '${p}'`)
    .join(',\n');

  return `// Temporary jest config injected by CI scan. Deleted automatically after scan.
          module.exports = {
            preset: 'ts-jest',
            testEnvironment: 'node',
            rootDir: ${JSON.stringify(localPath)},
            testMatch: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx'],
            collectCoverageFrom: [
          ${collectCoverageFrom},
            ],
            transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false, tsconfig: { isolatedModules: true } }] },
          };`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Recursively collect testable TypeScript source files. */
async function walkTs(
  dir: string,
  root: string,
  out: string[] = [],
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable directory — skip silently
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name))
          await walkTs(path.join(dir, entry.name), root, out);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        if (!SKIP_FILE_REGEXES.some((r) => r.test(entry.name))) {
          out.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    }),
  );

  return out;
}

/** Detect whether a file or directory exists without throwing. */
async function exists(p: string): Promise<boolean> {
  return fsp
    .access(p)
    .then(() => true)
    .catch(() => false);
}

// ─── service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CoverageParserService implements ICoverageParser {
  private readonly logger = new Logger(CoverageParserService.name);

  constructor(private readonly sandboxExecutor: SandboxExecutorService) {}

  async scanCoverage(localPath: string): Promise<FileCoverage[]> {
    this.logger.log(`Scanning coverage in ${localPath}`);

    const tmpJestConfigPath = path.join(localPath, TEMP_JEST_CONFIG_NAME);
    let wroteConfig = false;

    try {
      // ── 1. Install dependencies ───────────────────────────────────────────
      // Freshly cloned repos never have node_modules. The exists() check
      // prevents expensive re-installs if this is ever called on a warm dir.
      if (!(await exists(path.join(localPath, 'node_modules')))) {
        const installCmd =
          await this.sandboxExecutor.resolveInstallCmd(localPath);
        this.logger.log(`Installing dependencies (${installCmd})...`);
        await this.sandboxExecutor.executeCommand(installCmd, {
          cwd: localPath,
          timeout: INSTALL_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
        });
      }

      // ── 2. Determine which jest binary to use ────────────────────────────
      // Prefer the repo's own jest binary — it was installed against the
      // repo's own dependencies and transform config. Fall back to the global
      // jest pre-installed in the Docker image (see Dockerfile).
      const localJestBin = path.join(localPath, 'node_modules', '.bin', 'jest');
      const jestBin = (await exists(localJestBin))
        ? localJestBin
        : '/jest-toolchain/node_modules/.bin/jest';

      // ── 3. Determine jest config ─────────────────────────────────────────
      // If the repo ships its own jest config we honour it completely.
      // Only if it has nothing do we inject our minimal config.
      const hasJestInPkg = await (async () => {
        try {
          const pkg = JSON.parse(
            await fsp.readFile(path.join(localPath, 'package.json'), 'utf8'),
          );
          return !!(
            pkg.jest ||
            pkg.dependencies?.jest ||
            pkg.devDependencies?.jest
          );
        } catch {
          return false;
        }
      })();

      const knownConfigFiles = [
        'jest.config.js',
        'jest.config.ts',
        'jest.config.cjs',
        'jest.config.mjs',
        'jest.config.json',
      ];
      const hasExistingConfig =
        hasJestInPkg ||
        (
          await Promise.all(
            knownConfigFiles.map((f) => exists(path.join(localPath, f))),
          )
        ).some(Boolean);

      let jestConfigFlag = '';
      if (!hasExistingConfig) {
        await fsp.writeFile(
          tmpJestConfigPath,
          buildMinimalJestConfig(localPath),
          'utf8',
        );
        wroteConfig = true;
        jestConfigFlag = `--config=${TEMP_JEST_CONFIG_NAME}`;
        this.logger.debug(
          'Injected temporary jest config (no existing config found)',
        );
      }

      // ── 4. Run jest with coverage ────────────────────────────────────────
      // --passWithNoTests : don't error when a repo has zero test files
      // --forceExit       : prevent jest hanging on open handles (DB connections, etc.)
      // --ci              : disables TTY optimisations; faster in Docker
      // --silent          : suppresses per-test console output (saves maxBuffer)
      // coverageReporters : json-summary only — we don't need HTML/lcov
      this.logger.log('Running tests with coverage...');
      const jestCmd = [
        jestBin,
        jestConfigFlag,
        '--coverage',
        '--coverageReporters=json-summary',
        '--passWithNoTests',
        '--forceExit',
        '--ci',
        '--silent',
      ]
        .filter(Boolean)
        .join(' ');

      await this.sandboxExecutor
        .executeCommand(jestCmd, {
          cwd: localPath,
          timeout: JEST_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          env: {
            ...process.env,
            NODE_PATH: '/jest-toolchain/node_modules',
            // Suppress deprecation warnings from older repo deps —
            // they clutter logs and consume maxBuffer needlessly.
            NODE_OPTIONS: '--no-deprecation',
          },
        })
        .catch((err) => {
          // Jest exits with code 1 when tests fail — that is acceptable, we
          // still receive a coverage-summary.json and can report percentages.
          // Only re-throw truly fatal errors (spawn failure, ETIMEDOUT, etc.).
          const isTestFailure = err?.code === 1 && err?.stderr !== undefined;
          if (!isTestFailure) throw err;
          this.logger.warn(
            `Some tests failed during coverage run (expected for uncovered repos): ${err.stderr?.slice(0, 300)}`,
          );
        });

      // ── 5. Parse coverage-summary.json ───────────────────────────────────
      const summaryPath = path.join(
        localPath,
        'coverage',
        'coverage-summary.json',
      );
      if (!(await exists(summaryPath))) {
        this.logger.warn(
          'No coverage-summary.json produced. Returning all source files at 0%.',
        );
        return (await walkTs(localPath, localPath)).map((filePath) => ({
          filePath,
          linesCoverage: 0,
        }));
      }

      const coverageData: Record<string, { lines: { pct: number } }> =
        JSON.parse(await fsp.readFile(summaryPath, 'utf8'));

      const realLocalPath = await fsp.realpath(localPath);
      const results: FileCoverage[] = [];

      for (const [absFilePath, data] of Object.entries(coverageData)) {
        if (absFilePath === 'total') continue;

        // Normalise absolute → relative. Coverage JSON may embed symlink paths;
        // we resolve both sides to get a canonical path before relativising.
        let real: string;
        try {
          real = await fsp.realpath(absFilePath);
        } catch {
          real = absFilePath;
        }

        let rel = path.relative(realLocalPath, real);

        // Guard: if the path escaped the repo root (symlinks pointing outside)
        // fall back to a heuristic src/-based extraction.
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          const m = absFilePath.match(/src\/(.*)/);
          if (m) rel = `src/${m[1]}`;
          else continue;
        }

        if (/\.tsx?$/.test(rel)) {
          // Filter by SKIP_DIRS (ignores 'src/interfaces/foo.ts' and 'types/bar.ts')
          const pathParts = rel.split(path.sep);
          if (pathParts.some((part) => SKIP_DIRS.has(part))) continue;

          // Filter by SKIP_FILE_REGEXES (ignores 'app.ts' and 'foo.d.ts')
          const filename = path.basename(rel);
          if (SKIP_FILE_REGEXES.some((r) => r.test(filename))) continue;

          results.push({ filePath: rel, linesCoverage: data.lines?.pct ?? 0 });
        }
      }

      if (results.length === 0) {
        this.logger.warn(
          'coverage-summary.json had no file entries. Falling back to source file walk at 0%.',
        );
        return (await walkTs(localPath, localPath)).map((filePath) => ({
          filePath,
          linesCoverage: 0,
        }));
      }

      this.logger.log(
        `Coverage scan complete: ${results.length} files analysed`,
      );
      return results;
    } catch (error: any) {
      const msg =
        error?.code === 'ETIMEDOUT'
          ? `Process timed out after ${error.killed ? 'being killed' : 'timeout'}`
          : (error?.message ?? String(error));
      this.logger.error(`Coverage scan failed: ${msg}`);
      throw new Error(`Coverage scanning failed: ${msg}`);
    } finally {
      // Always clean up the injected config file, even on error.
      if (wroteConfig) {
        await fsp.unlink(tmpJestConfigPath).catch(() => void 0);
      }
    }
  }
}
