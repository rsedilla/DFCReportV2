import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * *# of People* for one leader's branch at the API (SKILL.md section 19; decision 0364).
 *
 *   Oriel (Men's root)
 *     -> Ana Zamora (Full view)
 *          -> Dan Esguerra -> Eva Gatchalian
 *          -> Fe Ocampo
 *     -> Ben Dizon
 *
 * What is pinned: a Full view leader reads their own branch and a leader beneath them, rows in
 * first-name order adding up to the box with their own row; the figure agrees with the Senior
 * Pastors' row for the same leader; a leader above or beside is refused, as is a Leader without
 * Full view; the Admin reads any branch; and the selector takes `LEADER` alone. Fixture names
 * are invented (CLAUDE.md, Secrets).
 */
describe('GET /reports/people/branch (decision 0364)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let ana: TestPerson;
  let ben: TestPerson;
  let dan: TestPerson;
  let eva: TestPerson;
  let fe: TestPerson;
  let anaAccount: TestAccount;
  let pastor: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Villanueva', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    const gemma = await createPerson(db, {
      firstName: 'Gemma',
      lastName: 'Bautista',
      network: 'WOMENS',
    });
    await assignTo(db, gemma.id, null);
    nameSeniorPastors(app, [oriel.id, gemma.id]);
    pastor = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });

    ana = await under('Ana', 'Zamora', oriel);
    ben = await under('Ben', 'Dizon', oriel);
    // Fe before Dan, so the rows' first-name order is tested rather than creation order.
    fe = await under('Fe', 'Ocampo', ana);
    dan = await under('Dan', 'Esguerra', ana);
    eva = await under('Eva', 'Gatchalian', dan);
    anaAccount = await createAccount(app, db, { person: ana, roles: ['LEADER'], fullView: true });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function under(
    firstName: string,
    lastName: string,
    leader: TestPerson,
  ): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, lastName, network: leader.network });
    await assignTo(db, person.id, leader.id);
    return person;
  }

  /** Last month, Manila, read from the database's clock as the API reads it. */
  async function lastMonth(): Promise<string> {
    const result = await sql<{ month: string }>`
      SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Manila') - interval '1 month', 'YYYY-MM-DD') AS month
    `.execute(db);
    return result.rows[0].month;
  }

  function branch(
    as: TestAccount,
    leaderId: string,
    period: string,
    scope = 'LEADER',
  ): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/reports/people/branch')
      .query({ period, scope, leader_id: leaderId })
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  interface Branch {
    current: boolean;
    total: number;
    own: number;
    rows: { leader: { id: string } | null; people: number }[];
  }

  it('reads the leader’s own branch: rows by first name, their own row, adding up to the box', async () => {
    const period = await lastMonth();
    const body = (await branch(anaAccount, ana.id, period).expect(200)).body as Branch;

    expect(body.current).toBe(false);
    expect(body.rows.map((row) => row.leader?.id)).toEqual([dan.id, fe.id]);
    expect(body.rows.map((row) => row.people)).toEqual([2, 1]);
    expect(body.own).toBe(1);
    expect(body.total).toBe(4);
    // The reconciliation section 20 asks of a drill-down: rows and the own row make the box.
    expect(body.rows.reduce((sum, row) => sum + row.people, 0) + body.own).toBe(body.total);
  });

  it('agrees with the Senior Pastors’ row for the same leader', async () => {
    const period = await lastMonth();
    const mine = (await branch(anaAccount, ana.id, period).expect(200)).body as Branch;
    const church = (
      await request(app.getHttpServer())
        .get('/api/v1/reports/church-counts')
        .query({ period })
        .set('Authorization', `Bearer ${pastor.accessToken}`)
        .expect(200)
    ).body as { tables: { rows: { leader: { id: string }; people: number }[] }[] };

    const row = church.tables
      .flatMap((table) => table.rows)
      .find((each) => each.leader.id === ana.id);
    expect(row?.people).toBe(mine.total);
  });

  it('opens a leader beneath the reader', async () => {
    const body = (await branch(anaAccount, dan.id, await lastMonth()).expect(200)).body as Branch;

    expect(body.rows.map((row) => row.leader?.id)).toEqual([eva.id]);
    expect(body.own).toBe(1);
    expect(body.total).toBe(2);
  });

  it('refuses a leader above or beside the reader', async () => {
    const period = await lastMonth();
    for (const leader of [oriel, ben]) {
      const response = await branch(anaAccount, leader.id, period);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    }
  });

  it('refuses a Leader without Full view (decision 0323)', async () => {
    const without = await createAccount(app, db, {
      person: ben,
      roles: ['LEADER'],
      fullView: false,
    });
    const response = await branch(without, ben.id, await lastMonth());

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('CAPABILITY_DENIED');
  });

  it('lets the Admin read any leader’s branch', async () => {
    const admin = await createPerson(db, { firstName: 'Ada', lastName: 'Lim', network: 'WOMENS' });
    const account = await createAccount(app, db, { person: admin, roles: ['ADMIN'] });

    const body = (await branch(account, ana.id, await lastMonth()).expect(200)).body as Branch;
    expect(body.total).toBe(4);
  });

  // As the Admin, who holds the whole church, so the guard admits the selector and the refusal
  // is the DTO's: a leader is refused a scope they do not hold first (section 7).
  it('takes the LEADER selector alone', async () => {
    const admin = await createPerson(db, { firstName: 'Ada', lastName: 'Lim', network: 'WOMENS' });
    const account = await createAccount(app, db, { person: admin, roles: ['ADMIN'] });
    const response = await branch(account, ana.id, await lastMonth(), 'WHOLE_CHURCH');

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('VALIDATION_FAILED');
  });

  /** An instant in a month, Manila noon on the given day. */
  const dayOf = (month: string, day: string): Date =>
    new Date(`${month.slice(0, 7)}-${day}T12:00:00+08:00`);

  /** Closes a person's open assignment at an instant, as a reassignment or departure does. */
  async function endAssignment(person: TestPerson, at: Date): Promise<void> {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: at })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();
  }

  it('reads a past month as it stood then, after a disciple has moved (decisions 0207 and 0214)', async () => {
    const before = await lastMonth();
    const thisMonth = new Date(Date.UTC(Number(before.slice(0, 4)), Number(before.slice(5, 7)), 1))
      .toISOString()
      .slice(0, 10);
    // Dan, and Eva beneath him, move to Ben at the start of this month.
    await endAssignment(dan, dayOf(thisMonth, '01'));
    await assignTo(db, dan.id, ben.id, dayOf(thisMonth, '01'));

    const then = (await branch(anaAccount, ana.id, before).expect(200)).body as Branch;
    expect(then.rows.map((row) => row.leader?.id)).toEqual([dan.id, fe.id]);
    expect(then.total).toBe(4);

    const now = (await branch(anaAccount, ana.id, thisMonth).expect(200)).body as Branch;
    expect(now.rows.map((row) => row.leader?.id)).toEqual([fe.id]);
    expect(now.total).toBe(2);
    // And Dan is no longer the reader's to open this month.
    const response = await branch(anaAccount, dan.id, thisMonth);
    expect({ status: response.status, code: response.body.error?.code }).toEqual({
      status: 403,
      code: 'SCOPE_DENIED',
    });
  });

  it('counts a disciple the reader may not open as a row naming nobody, still adding up (decision 0254)', async () => {
    const period = await lastMonth();
    // Fe left Ana mid-month and holds no assignment since: section 20's placement graph keeps
    // her under Ana for the month, while the tree at its end, which authorizes, does not.
    await endAssignment(fe, dayOf(period, '10'));

    const body = (await branch(anaAccount, ana.id, period).expect(200)).body as Branch;
    expect(body.rows.map((row) => row.leader?.id ?? null)).toEqual([dan.id, null]);
    expect(body.rows.reduce((sum, row) => sum + row.people, 0) + body.own).toBe(body.total);
  });

  it('answers no figures where section 20 refuses the month’s graph', async () => {
    const period = await lastMonth();
    // Two writes legal when made that leave a cycle on the month's placement graph, as
    // `reporting-subtree.spec.ts` builds one: Pia under Quin to the 10th, Quin under Pia from
    // the 12th to the 20th.
    const pia = await createPerson(db, { firstName: 'Pia', lastName: 'Ramos', network: 'MENS' });
    const quin = await createPerson(db, { firstName: 'Quin', lastName: 'Santos', network: 'MENS' });
    await assignTo(db, pia.id, quin.id, dayOf(period, '01'));
    await endAssignment(pia, dayOf(period, '10'));
    await assignTo(db, quin.id, pia.id, dayOf(period, '12'));
    await endAssignment(quin, dayOf(period, '20'));

    const body = (await branch(anaAccount, ana.id, period).expect(200)).body as {
      total: number | null;
      own: number | null;
      rows: unknown[] | null;
    };
    expect(body).toMatchObject({ total: null, own: null, rows: null });
  });
});
