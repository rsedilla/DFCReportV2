import { sql } from 'kysely';

import { DATABASE } from '../../src/database/database.module';
import { createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Db } from '../../src/database/database.module';

/**
 * A connection the database drops fails the request holding it and nothing else.
 *
 * Without a listener, `pg` ends the process on a dropped connection, which takes every
 * signed-in person's requests with it. Cut on the application's own pool, because the
 * listeners in `DatabaseModule` are what is under test.
 */
describe('the application survives a dropped database connection', () => {
  let app: INestApplication;
  let db: Db;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Db>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
  });

  const backendPid = async (executor: Db): Promise<number> =>
    (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(executor)).rows[0].pid;

  // `killer` must not be the connection being cut.
  const terminate = async (killer: Db, pid: number): Promise<void> => {
    await sql`SELECT pg_terminate_backend(${pid})`.execute(killer);
    // Wait until the server has ended it, then give the socket time to report it.
    for (let tries = 0; tries < 50; tries++) {
      const { rows } = await sql`SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}`.execute(killer);
      if (rows.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('fails the transaction whose connection is cut, and answers the next request', async () => {
    const cut = db.transaction().execute(async (trx) => {
      await terminate(db, await backendPid(trx));
      await sql`SELECT 1`.execute(trx);
    });

    await expect(cut).rejects.toThrow();

    const { rows } = await sql<{ one: number }>`SELECT 1 AS one`.execute(db);
    expect(rows[0].one).toBe(1);
  });

  it('drops an idle connection that is cut, and answers the next request', async () => {
    // Holding the killer's connection in a transaction keeps the pool from handing it
    // out, so the connection read and released inside is a different, now idle, one.
    await db.transaction().execute(async (trx) => {
      const idle = await db.connection().execute((conn) => backendPid(conn));
      await terminate(trx, idle);
    });

    const { rows } = await sql<{ one: number }>`SELECT 1 AS one`.execute(db);
    expect(rows[0].one).toBe(1);
  });
});
