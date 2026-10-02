import request from 'supertest';
import { Client } from 'pg';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a page of a report's coverage by leader costs (checklist row perf-filed-by-leader).
 *
 * Every page works out the whole month and checks every leader the reader may name, then
 * cuts the page from the result, so a page of 200 costs what a page of 10 does, and the
 * Filed reports screen reads 200 at once rather than doing it all again for each ten.
 *
 * Measured as rows fetched, summed over every query on `pg`'s `Client.prototype.query`.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a page of coverage by leader costs the same at 10 and at 200 (perf-filed-by-leader)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let period: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    // Twenty-five leaders under Raymond, each owing a record for one disciple.
    for (let i = 0; i < 25; i += 1) {
      const leader = await createPerson(db, { firstName: `Leader${i}`, network: 'MENS' });
      await assignTo(db, leader.id, raymond.id);
      const disciple = await createPerson(db, { firstName: `Disciple${i}`, network: 'MENS' });
      await assignTo(db, disciple.id, leader.id);
    }

    // The most recent Sunday before today, whose Manila day has begun.
    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const sunday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 7 : weekday)))
      .toISOString()
      .slice(0, 10);
    period = `${sunday.slice(0, 7)}-01`;
    await db.insertInto('dcc_events').values({ event_date: sunday }).execute();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function fetched(
    query: string,
  ): Promise<{ rows: number; body: { data: unknown[]; next_cursor: string | null } }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/reports/dcc/monthly/by-leader?period=${period}&scope=LEADER&leader_id=${raymond.id}${query}`,
      )
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    const results = await Promise.all(
      spy.mock.results.map((result) =>
        Promise.resolve(result.value as unknown).then(
          (value) => (value as { rows?: unknown[] } | undefined)?.rows?.length ?? 0,
          () => 0,
        ),
      ),
    );
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { rows: results.reduce((sum, rows) => sum + rows, 0), body: response.body };
  }

  it('reads as many rows for a page of 10 as for a page of 200', async () => {
    const ten = await fetched('&limit=10');
    const all = await fetched('&limit=200');

    expect(ten.body.data).toHaveLength(10);
    expect(all.body.data.length).toBeGreaterThanOrEqual(25);
    expect(all.body.next_cursor).toBeNull();
    expect(all.rows).toBeGreaterThan(0);
    expect(all.rows).toBe(ten.rows);
  });

  it('so reading every leader ten at a time costs a page of 200 once per page', async () => {
    const all = await fetched('&limit=200');

    let rows = 0;
    let pages = 0;
    let cursor: string | null = null;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page = await fetched(`&limit=10${suffix}`);
      rows += page.rows;
      pages += 1;
      cursor = page.body.next_cursor;
    } while (cursor !== null);

    expect(pages).toBe(Math.ceil(all.body.data.length / 10));
    expect(all.rows).toBeGreaterThan(0);
    expect(rows).toBe(pages * all.rows);
  });
});
