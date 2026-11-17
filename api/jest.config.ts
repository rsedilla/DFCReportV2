import type { Config } from 'jest';

/**
 * The suite that runs on every pull request and is expected to be green.
 *
 * The eleven authorization cases of CLAUDE.md are **here now**. They ran as their
 * own suite while they failed by design, so that a red build did not become
 * background noise nobody reads; the endpoint they are written against exists, so
 * they fold in and gate every change from here.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  // A regex rather than a glob: from Jest 30 a `**` glob skips a directory whose name starts
  // with a dot, so in a checkout under `.claude/worktrees` it matched nothing and the suite
  // "passed" by finding no tests. `roots` above keeps it to `test/`.
  testRegex: '\\.spec\\.ts$',
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  // One database, so one worker. The concurrency these tests care about is
  // concurrency inside PostgreSQL, which they create explicitly.
  maxWorkers: 1,
  testTimeout: 30_000,
  clearMocks: true,
};

export default config;
