import { Kysely, PostgresDialect, type CompiledQuery } from 'kysely';
import { Pool } from 'pg';

import { PeopleDuplicatesService } from '../../src/people/people.duplicates.service';
import { normalizeMobile } from '../../src/people/people.shared';

import type { Database } from '../../src/database/schema';

/**
 * The duplicate check's query uses the indexes of migration 0043 (SKILL.md section 3, decision
 * 0449).
 *
 * The three name indexes are built on the query's own expressions, and an expression index is
 * used only for the expression it was built on, so changing the query or the migration alone
 * would quietly return the check to reading the whole table, with every answer still right.
 * This runs the service's real query, captures it, and asks the planner, with sequential scans
 * switched off, how it would read `persons`: every one of the five branches must reach its
 * index, since an OR with one unindexed branch reads the whole table.
 */
describe('the duplicate check uses its indexes (decision 0449)', () => {
  let pool: Pool;
  let db: Kysely<Database>;
  const captured: CompiledQuery[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
      log: (event) => {
        if (event.level === 'query') captured.push(event.query);
      },
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('reads persons through the five indexes and never scans the table', async () => {
    await new PeopleDuplicatesService(db).findDuplicates({
      firstName: 'Marilou',
      lastName: 'Santos',
      birthDate: '1990-05-01',
      sex: 'FEMALE',
      mobileNumberNormalized: normalizeMobile('09171234567'),
    });
    const query = captured.find((entry) => /from "persons"/.test(entry.sql));
    expect(query).toBeDefined();

    const client = await pool.connect();
    let plan: unknown;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explained = await client.query(`EXPLAIN (FORMAT JSON) ${query!.sql}`, [
        ...query!.parameters,
      ]);
      plan = explained.rows[0]['QUERY PLAN'];
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    // Every node of the plan, so a scan of persons anywhere in it is found.
    const nodes: Record<string, unknown>[] = [];
    const walk = (node: Record<string, unknown>) => {
      nodes.push(node);
      for (const child of (node['Plans'] as Record<string, unknown>[] | undefined) ?? [])
        walk(child);
    };
    walk((plan as { Plan: Record<string, unknown> }[])[0].Plan);
    const indexes = nodes.map((node) => node['Index Name']).filter(Boolean);

    for (const index of [
      'persons_duplicate_last_name_idx',
      'persons_duplicate_first_name_idx',
      'persons_duplicate_compact_last_name_idx',
      'persons_birth_date_idx',
      'persons_mobile_number_normalized_idx',
    ]) {
      expect(indexes).toContain(index);
    }
    expect(
      nodes.filter(
        (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'persons',
      ),
    ).toEqual([]);
  });
});
