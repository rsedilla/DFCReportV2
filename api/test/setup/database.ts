import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import type { Database } from '../../src/database/schema';

/**
 * A connection of the tests' own, separate from the application's.
 *
 * Fixtures are written through it directly. That is deliberate here and nowhere
 * else: an import or a feature writes through the domain services, because a
 * script written straight against the database bypasses every service-layer check
 * (SKILL.md section 2, Initial data load). A test that is checking whether the
 * database itself rejects something has to be able to try.
 */
export function createTestDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL, max: 4 }),
    }),
  });
}

/** Every table this stage created, in one statement. */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      refresh_tokens,
      account_tokens,
      capability_grants,
      account_roles,
      accounts,
      pastoral_assignments,
      network_assignments,
      person_lifecycle,
      persons
    RESTART IDENTITY CASCADE
  `.execute(db);
}
