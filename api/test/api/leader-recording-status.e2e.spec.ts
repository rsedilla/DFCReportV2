import request from 'supertest';
import { sql } from 'kysely';

import { reportRangeGuardMonth } from '../../src/common/time/report-range';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/reports/recording-status/leader` -- a Full view leader's *Recording Status*
 * (SKILL.md sections 19 and 20, decision 0334), pinned at the API because the API is the sole
 * authority for authorization (section 7).
 *
 * The tree is `Oriel` (Men's root) -> `Primo` (a Primary with Full view) -> `Ana` and `Ben`,
 * and `Ana` -> `Carl`. Cases read **last week**, which has wholly begun whatever day the suite
 * runs on. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('A leader’s Recording Status (decision 0334)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let primo: TestPerson;
  let ana: TestPerson;
  let ben: TestPerson;
  let carl: TestPerson;
  let pastor: TestAccount;
  let reader: TestAccount;

  const LONG_AGO = new Date('2024-01-03T12:00:00+08:00');

  // **These cases count who recorded, not when**, and their fixtures write records now: a
  // weekly deadline in force would make the count depend on the day the suite runs. The
  // deadline has its own suite, `weekly-deadline.e2e.spec.ts` (decision 0335).
  const deadlineFrom = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2100-01-04';
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    if (deadlineFrom === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = deadlineFrom;
    }
    await app.close();
    await db.destroy();
  });

  const today = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** ISO weekday, 1 Monday to 7 Sunday. */
  const isoDay = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return weekday === 0 ? 7 : weekday;
  };

  const lastMonday = async (): Promise<string> => {
    const now = await today();

    return shift(shift(now, 1 - isoDay(now)), -7);
  };

  async function leader(firstName: string, under: TestPerson): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, lastName: 'Reyes', network: 'MENS' });
    await assignTo(db, person.id, under.id);

    return person;
  }

  async function cellOf(person: TestPerson, dayOfWeek: number): Promise<TestCell> {
    return createCell(db, { leader: person, dayOfWeek, createdAt: LONG_AGO });
  }

  async function recordMeeting(cell: TestCell, date: string, leaderId: string): Promise<void> {
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: cell.id,
        scheduled_date: date,
        scheduled_time: '19:00',
        week_starting: shift(date, 1 - isoDay(date)),
        reporting_month: `${date.slice(0, 7)}-01`,
        status: 'NOT_HELD',
        not_held_reason: 'LEADER_UNAVAILABLE',
        responsible_leader_id: leaderId,
        submitted_by: pastor.id,
        submitted_at: new Date(),
      })
      .execute();
  }

  function status(
    as: TestAccount,
    leaderId: string,
    start: string,
    kind: 'WEEK' | 'MONTH' = 'WEEK',
  ): request.Test {
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    return request(app.getHttpServer())
      .get('/api/v1/reports/recording-status/leader')
      .query({
        scope: 'LEADER',
        leader_id: leaderId,
        kind,
        start,
        period: reportRangeGuardMonth(kind, start, now),
      })
      .set('Authorization', `Bearer ${as.accessToken}`);
  }

  interface Column {
    recorded: number;
    owed: number;
  }
  interface Row {
    leader: { id: string };
    cell: Column;
    dcc: Column;
    status: { kind: string; leaders?: number };
  }

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

    primo = await leader('Primo', oriel);
    ana = await leader('Ana', primo);
    ben = await leader('Ben', primo);
    carl = await leader('Carl', ana);
    reader = await createAccount(app, db, { person: primo, roles: ['LEADER'], fullView: true });
    await db.updateTable('accounts').set({ created_at: LONG_AGO }).execute();
  });

  // Decision 0370: a row says whether its leader is under the reader now, so its figures may
  // link to the Pending lists. It reads a month that has ended, so the row is named at that
  // month's end whatever day the suite runs on, and the move below comes after it.
  it('says per row whether its leader is still under the reader for the Pending lists', async () => {
    const now = await today();
    const start = `${shift(`${now.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    await cellOf(ana, 2);
    await cellOf(ben, 3);

    // Ana moves to the root now, after the month read: named for it, outside the branch now.
    await db.transaction().execute(async (trx) => {
      const at = new Date();
      await trx
        .updateTable('pastoral_assignments')
        .set({ ended_at: at })
        .where('person_id', '=', ana.id)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('pastoral_assignments')
        .values({ person_id: ana.id, leader_id: oriel.id, started_at: at })
        .execute();
    });

    const response = await status(reader, primo.id, start, 'MONTH').expect(200);
    const rows = (response.body as { rows: (Row & { opens_pending: unknown })[] }).rows;
    const byId = new Map(rows.map((row) => [row.leader.id, row.opens_pending]));

    expect(byId.get(ana.id)).toEqual({ cell: false, dcc: false });
    expect(byId.get(ben.id)).toEqual({ cell: true, dcc: true });
  });

  it('counts everyone beneath the reader, one row per leader of their 12, and the rows add up to the boxes', async () => {
    const monday = await lastMonday();
    // Ana and Ben recorded; Carl did not; the reader's own Cell is not in their boxes.
    const anaCell = await cellOf(ana, 2);
    const benCell = await cellOf(ben, 3);
    await cellOf(carl, 4);
    await cellOf(primo, 5);
    await recordMeeting(anaCell, shift(monday, 1), ana.id);
    await recordMeeting(benCell, shift(monday, 2), ben.id);

    const response = await status(reader, primo.id, monday).expect(200);
    const body = response.body as {
      branch: { cell: Column & { percent: number | null } };
      rows: Row[];
      others: unknown;
    };

    expect(body.branch.cell).toEqual({ recorded: 2, owed: 3, late: 0, on_time: 2, percent: 66 });
    expect(body.rows.map((row) => row.leader.id)).toEqual([ana.id, ben.id]);
    const [anaRow, benRow] = body.rows;
    expect(anaRow.cell).toEqual({ recorded: 1, owed: 2, late: 0 });
    expect(anaRow.status).toEqual({ kind: 'STILL_TO_RECORD', leaders: 1 });
    expect(benRow.cell).toEqual({ recorded: 1, owed: 1, late: 0 });
    expect(benRow.status).toEqual({ kind: 'COMPLETED' });
    expect(body.others).toBeNull();
    // The reader oversaw this branch the week before as well, so its figure is shown.
    expect((response.body as { previous: { cell: unknown } }).previous.cell).not.toBeNull();

    // Section 20: the rows reconcile to the boxes, column by column.
    const sum = (key: 'cell' | 'dcc', field: keyof Column) =>
      body.rows.reduce((total, row) => total + row[key][field], 0);
    expect({ recorded: sum('cell', 'recorded'), owed: sum('cell', 'owed') }).toEqual({
      recorded: body.branch.cell.recorded,
      owed: body.branch.cell.owed,
    });
  });

  /** Midnight, Manila, at the start of a day: the instant an assignment opens or closes. */
  const startOf = (day: string): Date => new Date(`${day}T00:00:00+08:00`);

  async function closeAssignment(person: TestPerson, at: Date): Promise<void> {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: at })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();
  }

  it('refuses last month’s line for a leader who joined this month, as last month itself is refused', async () => {
    const thisMonth = `${(await today()).slice(0, 7)}-01`;
    const [year, month] = thisMonth.split('-').map(Number);
    const lastMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
    // Dina led under Sixto, a sibling of the reader’s, until this month, and under Primo since.
    const sixto = await leader('Sixto', oriel);
    const dina = await createPerson(db, { firstName: 'Dina', lastName: 'Reyes', network: 'MENS' });
    await assignTo(db, dina.id, sixto.id, LONG_AGO);
    await closeAssignment(dina, startOf(thisMonth));
    await assignTo(db, dina.id, primo.id, startOf(thisMonth));
    await cellOf(dina, 2);

    // Shown itself, last month is refused: the reader did not oversee Dina then.
    await status(reader, dina.id, lastMonth, 'MONTH').expect(403);

    // So the period-before line of this month says nothing about it either.
    const response = await status(reader, dina.id, thisMonth, 'MONTH').expect(200);
    expect(response.body.branch).not.toBeNull();
    expect(response.body.previous).toEqual(expect.objectContaining({ cell: null, dcc: null }));
  });

  it('counts a leader the tree no longer places under the reader in Others, and the lines still add up', async () => {
    const monday = await lastMonday();
    // Dan led under Primo and left on Thursday with no assignment since: the placement graph
    // keeps him in the week, and the tree at the week’s end does not.
    const dan = await leader('Dan', primo);
    await cellOf(dan, 2);
    await closeAssignment(dan, startOf(shift(monday, 3)));

    const response = await status(reader, primo.id, monday).expect(200);
    const body = response.body as {
      branch: { cell: Column };
      rows: Row[];
      others: { cell: Column } | null;
    };

    expect(body.rows.map((row) => row.leader.id)).not.toContain(dan.id);
    expect(body.others?.cell).toEqual({ recorded: 0, owed: 1, late: 0 });
    const named = body.rows.reduce((total, row) => total + row.cell.owed, 0);
    expect(named + (body.others?.cell.owed ?? 0)).toBe(body.branch.cell.owed);
  });

  it('refuses a leader without Full view, who holds no reporting capability', async () => {
    const monday = await lastMonday();
    const recording = await createAccount(app, db, {
      person: ana,
      roles: ['LEADER'],
      fullView: false,
    });

    const response = await status(recording, ana.id, monday).expect(403);
    expect(response.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('refuses a branch outside the reader’s own', async () => {
    const monday = await lastMonday();
    const sibling = await leader('Sixto', oriel);

    const response = await status(reader, sibling.id, monday).expect(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
  });

  it('leaves the Senior Pastors’ whole-church route refused to the same reader', async () => {
    const monday = await lastMonday();
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    const response = await request(app.getHttpServer())
      .get('/api/v1/reports/recording-status')
      .query({ kind: 'WEEK', start: monday, period: reportRangeGuardMonth('WEEK', monday, now) })
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');
  });
});
