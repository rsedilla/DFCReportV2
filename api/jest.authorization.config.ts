import type { Config } from 'jest';

/**
 * The eleven authorization cases of CLAUDE.md, Authorization test suite.
 *
 * They are written before the endpoint they exercise, and they fail. That is the
 * point: they are derived entirely from the specification and need no
 * implementation to exist, so writing them now makes guard behaviour the thing the
 * API is built toward rather than something verified afterwards, when it is
 * expensive to change (docs/ROADMAP.md, Stage 1).
 *
 * They run as their own job in CI, reported and not required. Stage 2 is done when
 * they are green, at which point this configuration folds into the main suite.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/authorization'],
  testMatch: ['<rootDir>/test/authorization/**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  maxWorkers: 1,
  testTimeout: 30_000,
  clearMocks: true,
};

export default config;
