import type { Config } from 'jest';

/**
 * The suite that runs on every pull request and is expected to be green.
 *
 * The eleven authorization cases of CLAUDE.md are deliberately not here. They
 * describe behaviour Stage 2 builds and they fail today, so they run as their own
 * suite (`jest.authorization.config.ts`) rather than turning a red build into
 * background noise nobody reads.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/test/authorization/'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  // One database, so one worker. The concurrency these tests care about is
  // concurrency inside PostgreSQL, which they create explicitly.
  maxWorkers: 1,
  testTimeout: 30_000,
  clearMocks: true,
};

export default config;
