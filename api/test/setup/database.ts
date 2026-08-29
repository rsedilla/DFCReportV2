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

/**
 * Every table holding test data, in one statement, plus the re-seed of the one
 * table that holds seeded data instead.
 *
 * **`settings` is truncated here whether or not it is named, and that is why it
 * is re-seeded rather than repaired.** `settings.updated_by` references
 * `accounts`, and `TRUNCATE ... CASCADE` extends to every table holding a foreign
 * key into one it names -- so truncating `accounts` empties `settings` silently,
 * and no trigger fires to say so, because TRUNCATE fires no row triggers
 * (SKILL.md section 5). An UPDATE that puts the values back matches nothing once
 * the rows are gone, and leaves every later test running against a table the
 * application expects to be populated.
 *
 * The upsert restores the rows whether they were wiped by the cascade or merely
 * changed by a test, which also makes this correct if a later migration adds
 * another reference into the truncated set.
 *
 * The defaults are the ones SKILL.md names -- three months for the attention
 * threshold (section 15), and the initial-encoding phase open (section 2) -- and
 * they are the same values migration 0002 seeds.
 */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      idempotency_keys,
      audit_log,
      cell_leadership_requests,
      cell_memberships,
      cell_leaderships,
      cell_schedules,
      cell_categories,
      cells,
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

  // `updated_by` goes back to null, which is what the seed means: nobody has
  // changed this yet (SKILL.md section 7).
  await sql`
    INSERT INTO settings (key, value, updated_by) VALUES
      ('cell_attention_months', '3'::jsonb, NULL),
      ('initial_encoding_open', 'true'::jsonb, NULL)
    ON CONFLICT (key) DO UPDATE
       SET value = excluded.value,
           updated_by = NULL,
           updated_at = now()
  `.execute(db);
}
