import { randomBytes } from 'node:crypto';

import 'dotenv/config';

/**
 * Test environment.
 *
 * `DATABASE_URL` must point at a database these tests may truncate. They exercise
 * partial unique indexes, a deferrable constraint trigger and concurrent writes,
 * none of which can be checked against a mock: a sequential test passes against
 * application-layer checks alone and tells you nothing about whether the
 * constraint exists (docs/ROADMAP.md, Stage 2 risk).
 *
 * The signing secret is generated per run. A fixed one would be a credential in a
 * public repository, and nothing here needs a token to outlive the process.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= randomBytes(32).toString('hex');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Start the local database with `docker compose up -d`, ' +
      'apply migrations with `npm run migrate:up`, and set DATABASE_URL in api/.env.',
  );
}
