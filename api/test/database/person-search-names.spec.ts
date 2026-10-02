import { sql } from 'kysely';

import { ACCENTED, UNACCENTED } from '../../src/people/people.shared';
import { createTestDb, truncateAll } from '../setup/database';
import { createPerson } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * The folded names the people search reads (migration 0021, checklist row perf-indexes).
 *
 * The database writes them with the accent table spelled out in the migration; the
 * duplicate check and the Cell pickers still fold names per row with the one in
 * `people.shared.ts`. If the two part, the people search and those disagree about a name.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the folded names the people search reads (migration 0021)', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('are generated with exactly the accent table the search folds a term with', async () => {
    const expressions = await sql<{ column: string; expression: string }>`
      SELECT a.attname AS column, pg_get_expr(d.adbin, d.adrelid) AS expression
        FROM pg_attribute a
        JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'persons'::regclass
         AND a.attname IN ('search_first_name', 'search_last_name', 'search_full_name')
       ORDER BY a.attname
    `.execute(db);

    expect(expressions.rows.map((row) => row.column)).toEqual([
      'search_first_name',
      'search_full_name',
      'search_last_name',
    ]);
    for (const row of expressions.rows) {
      expect(row.expression).toContain(`'${ACCENTED}'`);
      expect(row.expression).toContain(`'${UNACCENTED}'`);
    }
  });

  it('fold case and accents and follow an edit to the name', async () => {
    const person = await createPerson(db, {
      firstName: 'José',
      lastName: 'Ñuñez',
      network: 'MENS',
    });

    const read = () =>
      db
        .selectFrom('persons')
        .select(['search_first_name', 'search_last_name', 'search_full_name'])
        .where('id', '=', person.id)
        .executeTakeFirstOrThrow();

    expect(await read()).toEqual({
      search_first_name: 'jose',
      search_last_name: 'nunez',
      search_full_name: 'jose nunez',
    });

    await db
      .updateTable('persons')
      .set({ last_name: 'Peñaflor' })
      .where('id', '=', person.id)
      .execute();

    expect((await read()).search_last_name).toBe('penaflor');
  });
});
