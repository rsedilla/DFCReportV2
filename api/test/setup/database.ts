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
 * Every table holding test data, in one statement, plus the reset of the one
 * table that holds seeded data instead.
 *
 * `settings` is deliberately not truncated. Its two rows are seeded by migration
 * 0002 with the defaults SKILL.md names -- three months for the attention
 * threshold (section 15), and the initial-encoding phase open (section 2) -- so
 * truncating it would leave every later test running against a table the
 * application expects to be populated. It is restored to those defaults instead,
 * which also undoes a test that changed one.
 */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      idempotency_keys,
      audit_log,
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
    UPDATE settings
       SET value = defaults.value,
           updated_by = NULL,
           updated_at = now()
      FROM (VALUES
             ('cell_attention_months', '3'::jsonb),
             ('initial_encoding_open', 'true'::jsonb)
           ) AS defaults (key, value)
     WHERE settings.key = defaults.key
       AND (settings.value <> defaults.value OR settings.updated_by IS NOT NULL)
  `.execute(db);
}
