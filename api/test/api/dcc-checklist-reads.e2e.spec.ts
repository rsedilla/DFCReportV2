import request from 'supertest';
import { Client } from 'pg';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * What a page of a DCC checklist costs (checklist row perf-dcc-checklist).
 *
 * Every page builds the whole checklist and then cuts the page from it, so a page of 200
 * costs what a page of 50 does, and the screens that read a whole checklist ask for 200 at
 * once rather than building it again for each fifty.
 *
 * Measured as rows fetched, summed over every query on `pg`'s `Client.prototype.query`.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a page of a DCC checklist costs the same at 50 and at 200 (perf-dcc-checklist)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymondAccount: TestAccount;
  let eventId: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    for (let i = 0; i < 120; i += 1) {
      const disciple = await createPerson(db, { firstName: `Disciple${i}`, network: 'MENS' });
      await assignTo(db, disciple.id, raymond.id);
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
    eventId = (
      await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
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
      .get(`/api/v1/dcc/events/${eventId}/roster${query}`)
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

  it('reads as many rows for a page of 50 as for a page of 200', async () => {
    const fifty = await fetched('?limit=50');
    const all = await fetched('?limit=200');

    expect(fifty.body.data).toHaveLength(50);
    expect(all.body.data).toHaveLength(120);
    expect(all.body.next_cursor).toBeNull();
    expect(all.rows).toBeGreaterThan(0);
    expect(all.rows).toBe(fifty.rows);
  });

  it('so reading 120 fifty at a time costs three times what one page of 200 does', async () => {
    const all = await fetched('?limit=200');

    let rows = 0;
    let pages = 0;
    let cursor: string | null = null;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page = await fetched(`?limit=50${suffix}`);
      rows += page.rows;
      pages += 1;
      cursor = page.body.next_cursor;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(all.rows).toBeGreaterThan(0);
    expect(rows).toBe(3 * all.rows);
  });
});
