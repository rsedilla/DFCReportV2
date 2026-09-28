import type { Config } from 'jest';

/**
 * Probes: long-running checks that play an attacker against the application, kept out
 * of `npm test` because they wait out real rate-limit windows. They truncate the same
 * scratch database the suite uses, so never run the two at once.
 *
 * `npm run probe:scraping` runs the scraping probe (decision 0303).
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/probe'],
  testMatch: ['<rootDir>/test/probe/**/*.probe.ts'],
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  maxWorkers: 1,
  testTimeout: 300_000,
};

export default config;
