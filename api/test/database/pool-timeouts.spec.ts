import { sql } from 'kysely';

import { DATABASE } from '../../src/database/database.module';
import { createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Db } from '../../src/database/database.module';

/**
 * A statement on the application's pool is bounded (SKILL.md section 24: "Any
 * unbounded wait inside a transaction is a liveness hazard", because each waiting
 * request holds a connection and ten of them hold the pool).
 *
 * **Read back from a connection of the application's own pool**, not from one this
 * file opens, because the thing that can be deleted unnoticed is the line in
 * `DatabaseModule` that sets it. A probe connection built here would pass with that
 * line gone.
 *
 * `connectionTimeoutMillis` is a client-side setting of `pg.Pool` and has no server
 * setting to read back, so it is not pinned here.
 */
describe('the application pool bounds a statement (SKILL.md section 24)', () => {
  let app: INestApplication;
  let db: Db;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Db>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails a statement that runs past 30 seconds rather than holding the connection', async () => {
    const { rows } = await sql<{ statement_timeout: string }>`SHOW statement_timeout`.execute(db);

    expect(rows[0].statement_timeout).toBe('30s');
  });

  it('carries the bound inside a transaction, where a wait holds a connection longest', async () => {
    const statement = await db
      .transaction()
      .execute(
        async (trx) =>
          (await sql<{ statement_timeout: string }>`SHOW statement_timeout`.execute(trx)).rows[0]
            .statement_timeout,
      );

    expect(statement).toBe('30s');
  });
});
