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
 * `GET /api/v1/reports/recording-status` — the Senior Pastors' *Recording status* (SKILL.md
 * sections 19 and 20, decision 0325), pinned at the API as point 8 asks.
 *
 * Most cases read **last week**, which has wholly begun whatever day the suite runs on. The
 * two Network roots are `Oriel` (Men's) and `Gemma` (Women's), each holding a Senior Pastor
 * account. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Recording status (decision 0325)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let gemma: TestPerson;
  let pastor: TestAccount;

  /** An instant long before any week read here, for Cells that have always existed. */
  const LONG_AGO = new Date('2024-01-03T12:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Arcega', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    gemma = await createPerson(db, { firstName: 'Gemma', lastName: 'Bautista', network: 'WOMENS' });
    await assignTo(db, gemma.id, null);
    nameSeniorPastors(app, [oriel.id, gemma.id]);
    pastor = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    await createAccount(app, db, { person: gemma, roles: ['SENIOR_PASTOR'], seniorPastorSlot: 2 });
  });

  afterAll(async () => {
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

  const thisMonday = async (): Promise<string> => {
    const now = await today();

    return shift(now, 1 - isoDay(now));
  };

  /** Last week's Monday, and its day of the given ISO weekday. */
  const lastWeek = async (): Promise<{ monday: string; day: (iso: number) => string }> => {
    const monday = shift(await thisMonday(), -7);

    return { monday, day: (iso) => shift(monday, iso - 1) };
  };

  async function leader(
    firstName: string,
    lastName: string,
    under: TestPerson,
  ): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, lastName, network: under.network });
    await assignTo(db, person.id, under.id);

    return person;
  }

  async function cellOf(person: TestPerson, dayOfWeek: number): Promise<TestCell> {
    return createCell(db, { leader: person, dayOfWeek, createdAt: LONG_AGO });
  }

  /** A record for one meeting, whatever its status: here, not held. */
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

  async function createEvent(eventDate: string): Promise<string> {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: eventDate })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  }

  async function recordLine(eventId: string, person: TestPerson, leaderId: string): Promise<void> {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: person.id,
        present: true,
        responsible_leader_id: leaderId,
        recorded_by: pastor.id,
      })
      .execute();
  }

  /** The month the range resolves at, which the client names as the My 12 tables do. */
  function status(as: TestAccount, kind: 'WEEK' | 'MONTH', start: string): request.Test {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    return request(app.getHttpServer())
      .get('/api/v1/reports/recording-status')
      .query({ kind, start, period: reportRangeGuardMonth(kind, start, today) })
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

  const rowOf = (body: { tables: { rows: Row[] }[] }, person: TestPerson): Row | undefined =>
    body.tables.flatMap((table) => table.rows).find((row) => row.leader.id === person.id);

  // -------------------------------------------------------------------------
  // Point 2's definitions
  // -------------------------------------------------------------------------

  it('counts a leader with two Cells as recorded only when every meeting they owe has a record', async () => {
    const { monday, day } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    const first = await cellOf(ana, 2);
    const second = await cellOf(ana, 3);

    await recordMeeting(first, day(2), ana.id);
    const partly = await status(pastor, 'WEEK', monday).expect(200);
    expect(partly.body.whole_church.cell).toEqual({ recorded: 0, owed: 1, percent: 0 });

    await recordMeeting(second, day(3), ana.id);
    const wholly = await status(pastor, 'WEEK', monday).expect(200);
    expect(wholly.body.whole_church.cell).toEqual({ recorded: 1, owed: 1, percent: 100 });
  });

  it('does not count a meeting whose day has not begun', async () => {
    const monday = await thisMonday();
    const tomorrow = shift(await today(), 1);
    const ana = await leader('Ana', 'Cruz', oriel);
    await cellOf(ana, isoDay(tomorrow));

    const response = await status(pastor, 'WEEK', monday).expect(200);

    expect(response.body.whole_church.cell).toEqual({ recorded: 0, owed: 0, percent: null });
  });

  it('counts a leader with no account, and one whose account is not active', async () => {
    const { monday } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    const ben = await leader('Ben', 'Dizon', oriel);
    await cellOf(ana, 2);
    await cellOf(ben, 2);
    const benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });
    await db
      .updateTable('accounts')
      .set({ status: 'DISABLED' })
      .where('id', '=', benAccount.id)
      .execute();

    const response = await status(pastor, 'WEEK', monday).expect(200);

    expect(response.body.whole_church.cell).toEqual({ recorded: 0, owed: 2, percent: 0 });
  });

  it('gives a meeting to the leader on its day, after a handover and on the handover’s day', async () => {
    const { monday, day } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    const ben = await leader('Ben', 'Dizon', oriel);
    const tuesday = await cellOf(ana, 2);
    const wednesday = await cellOf(ana, 3);

    // Tuesday's Cell passes to Ben on Thursday, after its meeting; Wednesday's on Wednesday,
    // the meeting's own day, which leaves it with Ana (decision 0187).
    const handOver = async (cell: TestCell, at: Date) => {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ cell_id: cell.id, person_id: ben.id, started_at: at })
          .execute();
      });
    };
    await handOver(tuesday, new Date(`${day(4)}T09:00:00+08:00`));
    await handOver(wednesday, new Date(`${day(3)}T09:00:00+08:00`));

    const response = await status(pastor, 'WEEK', monday).expect(200);

    expect(rowOf(response.body, ana)?.cell).toEqual({ recorded: 0, owed: 1 });
    expect(rowOf(response.body, ben)?.status).toEqual({ kind: 'NOTHING_OWED' });
  });

  it('counts a meeting rescheduled across the week’s edge in the week it was scheduled', async () => {
    const { monday, day } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    const sundayCell = await cellOf(ana, 7);
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: sundayCell.id,
        scheduled_date: day(7),
        scheduled_time: '19:00',
        week_starting: monday,
        reporting_month: `${day(7).slice(0, 7)}-01`,
        status: 'RESCHEDULED',
        actual_date: shift(day(7), 1),
        actual_time: '19:00',
        responsible_leader_id: ana.id,
        submitted_by: pastor.id,
        submitted_at: new Date(),
      })
      .execute();

    const response = await status(pastor, 'WEEK', monday).expect(200);

    expect(response.body.whole_church.cell).toEqual({ recorded: 1, owed: 1, percent: 100 });
  });

  it('counts a DCC submitter whose account is awaiting activation', async () => {
    const { monday, day } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    await leader('Dan', 'Esguerra', ana);
    const anaAccount = await createAccount(app, db, { person: ana, roles: ['LEADER'] });
    await db
      .updateTable('accounts')
      .set({ status: 'PENDING_ACTIVATION' })
      .where('id', '=', anaAccount.id)
      .execute();
    await createEvent(day(7));

    const response = await status(pastor, 'WEEK', monday).expect(200);

    // Oriel owes Ana's line, and Ana owes Dan's.
    expect(response.body.whole_church.dcc).toEqual({ recorded: 0, owed: 2, percent: 0 });
    expect(rowOf(response.body, ana)?.dcc).toEqual({ recorded: 0, owed: 1 });
  });

  // -------------------------------------------------------------------------
  // The tables, Others, and the identity
  // -------------------------------------------------------------------------

  it('adds the tables and Others up to the whole church, with each row’s status', async () => {
    const { monday, day } = await lastWeek();
    // Oriel -> Ana -> Dan, Oriel -> Ben; Gemma -> Cara; Xavier holds no assignment.
    const ana = await leader('Ana', 'Cruz', oriel);
    const ben = await leader('Ben', 'Dizon', oriel);
    const dan = await leader('Dan', 'Esguerra', ana);
    const cara = await leader('Cara', 'Flores', gemma);
    const xavier = await createPerson(db, {
      firstName: 'Xavier',
      lastName: 'Gatchalian',
      network: 'MENS',
    });
    await createAccount(app, db, { person: ana, roles: ['LEADER'] });
    await createAccount(app, db, { person: cara, roles: ['LEADER'] });

    await cellOf(ana, 2);
    const danCell = await cellOf(dan, 2);
    const caraCell = await cellOf(cara, 2);
    await cellOf(xavier, 2);
    await recordMeeting(danCell, day(2), dan.id);
    await recordMeeting(caraCell, day(2), cara.id);

    // DCC: Oriel records Ana's and Ben's lines, Ana records Dan's, Gemma records Cara's.
    const eventId = await createEvent(day(7));
    await recordLine(eventId, ana, oriel.id);

    const response = await status(pastor, 'WEEK', monday).expect(200);
    const body = response.body;

    expect(body.whole_church.cell).toEqual({ recorded: 2, owed: 4, percent: 50 });
    expect(body.whole_church.dcc).toEqual({ recorded: 1, owed: 3, percent: 33 });

    // One table per root, in surname order, rows in surname order.
    expect(body.tables.map((table: { root: { id: string } }) => table.root.id)).toEqual([
      oriel.id,
      gemma.id,
    ]);
    expect(body.tables[0].rows.map((row: Row) => row.leader.id)).toEqual([ana.id, ben.id]);
    expect(body.tables[1].rows.map((row: Row) => row.leader.id)).toEqual([cara.id]);

    // Ana's row counts Ana and Dan. Ana is missing both columns and is counted once.
    expect(rowOf(body, ana)).toMatchObject({
      cell: { recorded: 1, owed: 2 },
      dcc: { recorded: 0, owed: 1 },
      status: { kind: 'STILL_TO_RECORD', leaders: 1 },
    });
    expect(rowOf(body, ben)?.status).toEqual({ kind: 'NOTHING_OWED' });
    expect(rowOf(body, cara)).toMatchObject({
      cell: { recorded: 1, owed: 1 },
      dcc: { recorded: 0, owed: 0 },
      status: { kind: 'COMPLETED' },
    });

    // Others: the two roots and Xavier, who is in no table.
    expect(body.others).toEqual({
      cell: { recorded: 0, owed: 1 },
      dcc: { recorded: 1, owed: 2 },
      status: { kind: 'STILL_TO_RECORD', leaders: 2 },
    });

    // Rows and Others add up to the boxes, for X and Y of both columns.
    for (const column of ['cell', 'dcc'] as const) {
      for (const figure of ['recorded', 'owed'] as const) {
        const rows = body.tables
          .flatMap((table: { rows: Row[] }) => table.rows)
          .reduce((sum: number, row: Row) => sum + row[column][figure], 0);
        expect(rows + body.others[column][figure]).toBe(body.whole_church[column][figure]);
      }
    }
  });

  it('refuses the tables and Others where the placement graph holds a cycle, and keeps the boxes', async () => {
    const { monday, day } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    await cellOf(ana, 2);

    // Ana and Ben each sit under the other within the week, from two writes legal when made.
    const ben = await createPerson(db, { firstName: 'Ben', lastName: 'Dizon', network: 'MENS' });
    const closeAt = async (id: string, at: Date) =>
      db.updateTable('pastoral_assignments').set({ ended_at: at }).where('id', '=', id).execute();
    const anaRow = await db
      .selectFrom('pastoral_assignments')
      .select('id')
      .where('person_id', '=', ana.id)
      .executeTakeFirstOrThrow();
    await closeAt(anaRow.id, new Date(`${day(1)}T08:00:00+08:00`));
    const anaUnderBen = await assignTo(db, ana.id, ben.id, new Date(`${day(1)}T08:00:00+08:00`));
    await closeAt(anaUnderBen, new Date(`${day(2)}T08:00:00+08:00`));
    const benUnderAna = await assignTo(db, ben.id, ana.id, new Date(`${day(3)}T08:00:00+08:00`));
    await closeAt(benUnderAna, new Date(`${day(4)}T08:00:00+08:00`));

    const response = await status(pastor, 'WEEK', monday).expect(200);

    expect(response.body.tables).toBeNull();
    expect(response.body.others).toBeNull();
    expect(response.body.whole_church.cell).toEqual({ recorded: 0, owed: 1, percent: 0 });
  });

  // -------------------------------------------------------------------------
  // The period, and who may read it
  // -------------------------------------------------------------------------

  it('names the period before it, and whether the period is still open', async () => {
    const { monday } = await lastWeek();

    const week = await status(pastor, 'WEEK', monday).expect(200);
    expect(week.body).toMatchObject({
      kind: 'WEEK',
      start: monday,
      end: shift(monday, 6),
      previous: { start: shift(monday, -7), end: shift(monday, -1) },
    });
    expect(typeof week.body.open).toBe('boolean');

    const month = `${monday.slice(0, 7)}-01`;
    const byMonth = await status(pastor, 'MONTH', month).expect(200);
    expect(byMonth.body.previous.start).toBe(`${shift(month, -1).slice(0, 7)}-01`);
  });

  it('refuses a period that has not begun, and a start that is not one', async () => {
    const next = shift(await thisMonday(), 7);

    const future = await status(pastor, 'WEEK', next).expect(422);
    expect(future.body.error.code).toBe('VALIDATION_FAILED');

    const midweek = await status(pastor, 'WEEK', shift(next, -5)).expect(422);
    expect(midweek.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a reader without reports.view_subtree at Whole Church', async () => {
    const { monday } = await lastWeek();
    const ana = await leader('Ana', 'Cruz', oriel);
    const ben = await leader('Ben', 'Dizon', oriel);
    const withFullView = await createAccount(app, db, {
      person: ana,
      roles: ['LEADER'],
      fullView: true,
    });
    const without = await createAccount(app, db, {
      person: ben,
      roles: ['LEADER'],
      fullView: false,
    });
    const admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    const subtree = await status(withFullView, 'WEEK', monday).expect(403);
    expect(subtree.body.error.code).toBe('SCOPE_DENIED');
    const none = await status(without, 'WEEK', monday).expect(403);
    expect(none.body.error.code).toBe('CAPABILITY_DENIED');

    await status(admin, 'WEEK', monday).expect(200);
    await status(pastor, 'WEEK', monday).expect(200);
  });
});
