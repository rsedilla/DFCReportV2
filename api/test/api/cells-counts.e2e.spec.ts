import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/cells/counts` (decision 0309): the Cells page's two totals.
 *
 * **Each total is the number of rows `GET /api/v1/cells` lists**, unsearched, for the same
 * reader: the count is a second query stating the list's joins and filters again, so this
 * file compares the two rather than trusting that they agree. Authorization is tested here,
 * at the API, as the list's own guard (SKILL.md section 7). Fixture names are invented
 * (CLAUDE.md, Secrets).
 */
describe('GET /api/v1/cells/counts (decision 0309)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let rico: TestPerson;
  let raymondAccount: TestAccount;
  let manuelAccount: TestAccount;
  let adminAccount: TestAccount;
  let month: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    // Raymond leads two, his disciple Manuel three, and Rico, outside Raymond's branch, two.
    // One of Manuel's is closed and one of Rico's is closed, which no total counts.
    await createCell(db, { leader: raymond });
    await createCell(db, { leader: raymond });
    await createCell(db, { leader: manuel });
    await createCell(db, { leader: manuel });
    const closedOfManuel = await createCell(db, { leader: manuel });
    await createCell(db, { leader: rico });
    const closedOfRico = await createCell(db, { leader: rico });
    await closeCellDirectly(db, closedOfManuel.id, { reason: 'MEMBERS_DISPERSED' });
    await closeCellDirectly(db, closedOfRico.id, { reason: 'MEMBERS_DISPERSED' });

    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    month = `${today.slice(0, 7)}-01`;
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const counts = (account: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/cells/counts')
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** Every row the list returns for this reader, following the cursor. */
  async function listed(account: TestAccount, ledByMe: boolean): Promise<number> {
    let rows = 0;
    let cursor: string | null = null;

    do {
      const query = new URLSearchParams({ month, limit: '2' });
      if (ledByMe) query.set('led_by', 'me');
      if (cursor !== null) query.set('cursor', cursor);
      const response = await request(app.getHttpServer())
        .get(`/api/v1/cells?${query.toString()}`)
        .set('Authorization', `Bearer ${account.accessToken}`);
      expect(response.status).toBe(200);
      rows += (response.body as { data: unknown[] }).data.length;
      cursor = (response.body as { next_cursor: string | null }).next_cursor;
    } while (cursor !== null);

    return rows;
  }

  it('counts a leader’s running Cells in scope and their own, never a closed one', async () => {
    const response = await counts(raymondAccount);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ in_scope: 4, led_by_me: 2 });
  });

  it('counts the whole church for a Whole Church reader, who leads none', async () => {
    const response = await counts(adminAccount);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ in_scope: 5, led_by_me: 0 });
  });

  it.each([
    ['Raymond', () => raymondAccount],
    ['Manuel', () => manuelAccount],
    ['the administrator', () => adminAccount],
  ])('gives %s the number of rows the list gives them', async (_, account) => {
    const response = await counts(account());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      in_scope: await listed(account(), false),
      led_by_me: await listed(account(), true),
    });
  });

  it('counts a Cell whose schedule change is still pending, as the list does', async () => {
    // A schedule change opens its replacement with a future start, so the open row is the
    // pending one; both the list and the count join the row in force instead.
    const pending = await createCell(db, { leader: raymond });
    // In one transaction, as the schedule change makes it: the schema refuses a moment in
    // which an ACTIVE Cell has no open schedule.
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_schedules')
        .set({
          ended_at: sql`(date_trunc('month', now() AT TIME ZONE 'Asia/Manila') + interval '1 month') AT TIME ZONE 'Asia/Manila'`,
        })
        .where('cell_id', '=', pending.id)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('cell_schedules')
        .values({
          cell_id: pending.id,
          day_of_week: 3,
          time_of_day: '19:00',
          started_at: sql`(date_trunc('month', now() AT TIME ZONE 'Asia/Manila') + interval '1 month') AT TIME ZONE 'Asia/Manila'`,
        })
        .execute();
    });

    const response = await counts(raymondAccount);

    expect(response.body).toEqual({
      in_scope: await listed(raymondAccount, false),
      led_by_me: await listed(raymondAccount, true),
    });
    expect(response.body).toEqual({ in_scope: 5, led_by_me: 3 });
  });

  it('refuses a reader holding no cell.view_subtree, at the API', async () => {
    const stranger = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Perla', network: 'MENS' }),
      roles: [],
    });

    const response = await counts(stranger);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('refuses a request with no session', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/cells/counts');

    expect(response.status).toBe(401);
  });
});
