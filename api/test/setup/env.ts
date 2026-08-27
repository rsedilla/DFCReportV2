import { randomBytes } from 'node:crypto';

import 'dotenv/config';

/**
 * Test environment.
 *
 * These tests need a real database and they **truncate it before every case**.
 * They exercise partial unique indexes, a deferrable constraint trigger and
 * concurrent writes, none of which can be checked against a mock: a sequential
 * test passes against application-layer checks alone and tells you nothing about
 * whether the constraint exists (docs/ROADMAP.md, Stage 2 risk).
 *
 * **`TEST_DATABASE_URL` exists so that the database they truncate need not be the
 * one the application uses.** Set it, and it replaces `DATABASE_URL` for the whole
 * run — which is why the substitution happens here rather than in `database.ts`:
 * a dozen cases open a raw `pg.Client` on `process.env.DATABASE_URL` to hold a
 * lock or race a write, and `createTestApp` builds the real Nest application,
 * which reads it through `AppConfig`. Replacing the variable catches all of them;
 * replacing the pool in `createTestDb` would catch one.
 *
 * Unset, it falls back to `DATABASE_URL` and nothing changes — which is what CI
 * does, where the database is created for the run and thrown away after it.
 *
 * **This was written after the suite destroyed a loaded leadership-tree spine.**
 * One `DATABASE_URL` served the application, the import and the tests, so
 * `npm test` truncated thirty Persons, both Network roots and the only Admin
 * account, and restarted the Member ID sequence. The header above already said
 * this file's database "must point at a database these tests may truncate"; a
 * documented contract that nothing enforces is the failure this repository keeps
 * recording, and one variable makes it structural instead.
 *
 * The signing secret is generated per run. A fixed one would be a credential in a
 * public repository, and nothing here needs a token to outlive the process.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= randomBytes(32).toString('hex');

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Neither TEST_DATABASE_URL nor DATABASE_URL is set. These tests truncate every table ' +
      'before each case, so point TEST_DATABASE_URL at a scratch database — never at one ' +
      'holding data you want to keep. Apply migrations to it with ' +
      '`DATABASE_URL=<that url> npm run migrate:up`.',
  );
}
