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
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A Full view leader's *# of Cell Groups*, *# of Cell Leaders* and *Last 12 months* at the API
 * (SKILL.md section 19; decision 0380).
 *
 *   Oriel (Men's root)
 *     -> Ana Zamora (Full view, one Youth Cell)
 *          -> Dan Esguerra (a Youth and a Couple Cell) -> Eva Gatchalian (a Young Pro Cell)
 *          -> Fe Ocampo (no Cell)
 *     -> Ben Dizon (Full view)
 *
 * What is pinned: the branch counts add up, rows and own row to the box, and agree with the
 * Senior Pastors' row for the same leader; a leader above or beside is refused, as is a Leader
 * without Full view, and the selector takes `LEADER` alone; the twelve months are one line, the
 * branch's own, and a month the reader could not have read is a gap. Fixture names are invented
 * (CLAUDE.md, Secrets).
 */
describe('GET /reports/counts/branch and /reports/trends/branch (decision 0380)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let ana: TestPerson;
  let ben: TestPerson;
  let dan: TestPerson;
  let eva: TestPerson;
  let fe: TestPerson;
  let anaAccount: TestAccount;
  let benAccount: TestAccount;
  let pastor: TestAccount;

  const LONG_AGO = new Date('2020-01-06T12:00:00+08:00');

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

    await createCell(db, { leader: ana, category: 'YOUTH', createdAt: LONG_AGO });
    await createCell(db, { leader: dan, category: 'YOUTH', createdAt: LONG_AGO });
    await createCell(db, { leader: dan, category: 'COUPLE', createdAt: LONG_AGO });
    await createCell(db, { leader: eva, category: 'YOUNG_PRO', createdAt: LONG_AGO });

    anaAccount = await createAccount(app, db, { person: ana, roles: ['LEADER'], fullView: true });
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'], fullView: true });
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

  /** A month in Manila, read from the database's clock as the API reads it. */
  async function monthOffset(offset: number): Promise<string> {
    const result = await sql<{ month: string }>`
      SELECT to_char(
        date_trunc('month', now() AT TIME ZONE 'Asia/Manila') + make_interval(months => ${offset}::int),
        'YYYY-MM-DD'
      ) AS month
    `.execute(db);
    return result.rows[0].month;
  }

  function counts(
    as: TestAccount,
    leaderId: string,
    period: string,
    scope = 'LEADER',
  ): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/reports/counts/branch')
      .query({ period, scope, leader_id: leaderId })
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  function trends(
    as: TestAccount,
    figure: string,
    leaderId: string,
    period: string,
    scope = 'LEADER',
  ): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/reports/trends/branch')
      .query({ figure, period, scope, leader_id: leaderId })
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  const FIELDS = ['cell_groups', 'youth', 'young_pro', 'couple', 'cell_leaders', 'people'] as const;
  type Figures = Record<(typeof FIELDS)[number], number>;
  interface Counts {
    current: boolean;
    total: Figures;
    own: Figures;
    rows: (Figures & { leader: { id: string } | null })[];
  }
  interface Line {
    months: string[];
    open: boolean[];
    lines: { leader: { id: string } | null; network: string | null; values: (number | null)[] }[];
  }

  it('counts the leader’s branch: rows by first name, their own row, adding up to the box', async () => {
    const body = (await counts(anaAccount, ana.id, await monthOffset(-1)).expect(200))
      .body as Counts;

    expect(body.current).toBe(false);
    expect(body.rows.map((row) => row.leader?.id)).toEqual([dan.id, fe.id]);
    expect(body.rows[0]).toMatchObject({
      cell_groups: 3,
      youth: 1,
      young_pro: 1,
      couple: 1,
      cell_leaders: 2,
    });
    expect(body.rows[1]).toMatchObject({ cell_groups: 0, cell_leaders: 0, people: 1 });
    expect(body.own).toMatchObject({ cell_groups: 1, youth: 1, cell_leaders: 1, people: 1 });
    expect(body.total).toMatchObject({ cell_groups: 4, cell_leaders: 3, people: 4 });
    // The reconciliation section 20 asks of a drill-down, field by field.
    for (const field of FIELDS) {
      expect(body.rows.reduce((sum, row) => sum + row[field], 0) + body.own[field]).toBe(
        body.total[field],
      );
    }
  });

  it('agrees with the Senior Pastors’ row for the same leader', async () => {
    const period = await monthOffset(-1);
    const mine = (await counts(anaAccount, ana.id, period).expect(200)).body as Counts;
    const church = (
      await request(app.getHttpServer())
        .get('/api/v1/reports/church-counts')
        .query({ period })
        .set('Authorization', `Bearer ${pastor.accessToken}`)
        .expect(200)
    ).body as { tables: { rows: (Figures & { leader: { id: string } })[] }[] };

    const row = church.tables
      .flatMap((table) => table.rows)
      .find((each) => each.leader.id === ana.id);
    for (const field of FIELDS) {
      expect(row?.[field]).toBe(mine.total[field]);
    }
  });

  it('counts no Cell closed CREATED_IN_ERROR, in any month (decision 0330)', async () => {
    const mistaken = await createCell(db, { leader: fe, category: 'COUPLE', createdAt: LONG_AGO });
    await closeCellDirectly(db, mistaken.id, { reason: 'CREATED_IN_ERROR' });

    const body = (await counts(anaAccount, ana.id, await monthOffset(-1)).expect(200))
      .body as Counts;
    expect(body.rows[1]).toMatchObject({ cell_groups: 0, couple: 0, cell_leaders: 0 });
    expect(body.total).toMatchObject({ cell_groups: 4, couple: 1, cell_leaders: 3 });
  });

  it('counts a disciple the reader may not read as a row naming nobody, still adding up (decision 0254)', async () => {
    const period = await monthOffset(-1);
    // Fe left Ana mid-month and holds no assignment since: the placement graph keeps her under
    // Ana for the month, while the tree at its end, which authorizes, does not.
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date(`${period.slice(0, 7)}-10T12:00:00+08:00`) })
      .where('person_id', '=', fe.id)
      .where('ended_at', 'is', null)
      .execute();

    const body = (await counts(anaAccount, ana.id, period).expect(200)).body as Counts;
    expect(body.rows.map((row) => row.leader?.id ?? null)).toEqual([dan.id, null]);
    for (const field of FIELDS) {
      expect(body.rows.reduce((sum, row) => sum + row[field], 0) + body.own[field]).toBe(
        body.total[field],
      );
    }
  });

  it('refuses a leader above or beside the reader', async () => {
    const period = await monthOffset(-1);
    for (const leader of [oriel, ben]) {
      const response = await counts(anaAccount, leader.id, period);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    }
  });

  it('refuses a Leader without Full view, on both routes (decision 0323)', async () => {
    const without = await createAccount(app, db, {
      person: fe,
      roles: ['LEADER'],
      fullView: false,
    });
    const period = await monthOffset(0);

    for (const response of [
      await counts(without, fe.id, period),
      await trends(without, 'CELLS', fe.id, period),
    ]) {
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'CAPABILITY_DENIED',
      });
    }
  });

  // As the Admin, who holds the whole church, so the guard admits the selector and the refusal
  // is the route's: a leader is refused a scope they do not hold first (section 7).
  it('takes the LEADER selector alone, on both routes', async () => {
    const admin = await createPerson(db, { firstName: 'Ada', lastName: 'Lim', network: 'WOMENS' });
    const account = await createAccount(app, db, { person: admin, roles: ['ADMIN'] });
    const period = await monthOffset(0);

    for (const response of [
      await counts(account, ana.id, period, 'WHOLE_CHURCH'),
      await trends(account, 'CELLS', ana.id, period, 'WHOLE_CHURCH'),
    ]) {
      expect(response.status).toBe(422);
      expect(response.body.error?.code).toBe('VALIDATION_FAILED');
    }
  });

  it('draws one line, the branch’s own, over the twelve months ending at the period', async () => {
    const period = await monthOffset(0);
    const body = (await trends(anaAccount, 'CELLS', ana.id, period).expect(200)).body as Line;

    expect(body.months).toHaveLength(12);
    expect(body.months[11]).toBe(period);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].leader?.id).toBe(ana.id);
    expect(body.lines[0].network).toBeNull();
    expect(body.lines[0].values).toEqual(Array(12).fill(4));
    expect(body.open[11]).toBe(true);
    expect(body.open[10]).toBe(false);

    const leaders = (await trends(anaAccount, 'CELL_LEADERS', ana.id, period).expect(200))
      .body as Line;
    expect(leaders.lines[0].values[11]).toBe(3);
    const people = (await trends(anaAccount, 'PEOPLE', ana.id, period).expect(200)).body as Line;
    expect(people.lines[0].values[11]).toBe(4);
    const cg = (await trends(anaAccount, 'CG', ana.id, period).expect(200)).body as Line;
    expect(cg.lines[0].values[11]).toBe(0);
  });

  it('refuses a leader above or beside the reader', async () => {
    const period = await monthOffset(0);
    for (const leader of [oriel, ben]) {
      const response = await trends(anaAccount, 'CELLS', leader.id, period);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    }
  });

  it('leaves a gap for each month the reader could not have read (decisions 0207 and 0214)', async () => {
    const thisMonth = await monthOffset(0);
    // Dan, and Eva beneath him, move from Ana to Ben at the first instant of this month, so the
    // move has happened whatever day or hour the suite runs.
    const moved = new Date(`${thisMonth}T00:00:00+08:00`);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: moved })
      .where('person_id', '=', dan.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, dan.id, ben.id, moved);

    const body = (await trends(benAccount, 'CELLS', dan.id, thisMonth).expect(200)).body as Line;
    // Ben reads Dan's branch for this month only; the eleven before it were Ana's to read.
    expect(body.lines[0].values[11]).toBe(3);
    expect(body.lines[0].values.slice(0, 11)).toEqual(Array(11).fill(null));

    // And Ana may not draw Dan's line for this month, which the guard refuses outright.
    const response = await trends(anaAccount, 'CELLS', dan.id, thisMonth);
    expect({ status: response.status, code: response.body.error?.code }).toEqual({
      status: 403,
      code: 'SCOPE_DENIED',
    });
  });

  it('answers no counts, and a gap in the line, where section 20 refuses the month’s graph', async () => {
    const period = await monthOffset(-1);
    const dayOf = (day: string) => new Date(`${period.slice(0, 7)}-${day}T12:00:00+08:00`);
    // Two writes legal when made that leave a cycle on the month's placement graph, as
    // `branch-people.e2e.spec.ts` builds one.
    const pia = await createPerson(db, { firstName: 'Pia', lastName: 'Ramos', network: 'MENS' });
    const quin = await createPerson(db, { firstName: 'Quin', lastName: 'Santos', network: 'MENS' });
    await assignTo(db, pia.id, quin.id, dayOf('01'));
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: dayOf('10') })
      .where('person_id', '=', pia.id)
      .execute();
    await assignTo(db, quin.id, pia.id, dayOf('12'));
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: dayOf('20') })
      .where('person_id', '=', quin.id)
      .execute();

    const body = (await counts(anaAccount, ana.id, period).expect(200)).body as {
      total: unknown;
      own: unknown;
      rows: unknown;
    };
    expect(body).toMatchObject({ total: null, own: null, rows: null });

    // The month asked for is the refused one, so the asked month itself must be a gap rather
    // than a refusal of the whole line; the month before it reads.
    for (const figure of ['CELLS', 'CG', 'DCC']) {
      const line = (await trends(anaAccount, figure, ana.id, period).expect(200)).body as Line;
      expect(line.months[11]).toBe(period);
      expect(line.lines[0].values[11]).toBeNull();
      expect(line.lines[0].values[10]).not.toBeNull();
    }
  });

  it('refuses a period that has not begun (decision 0216)', async () => {
    for (const figure of ['CELLS', 'CG', 'DCC']) {
      const response = await trends(anaAccount, figure, ana.id, await monthOffset(1));
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 422,
        code: 'VALIDATION_FAILED',
      });
    }
  });
});
