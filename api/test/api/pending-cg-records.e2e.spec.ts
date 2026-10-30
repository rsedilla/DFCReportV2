import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  addCellMember,
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

interface Row {
  cell: {
    id: string;
    cell_code: string;
    category: string | null;
    day_of_week: number | null;
    closed_on: string | null;
  };
  leader: { person_id: string; first_name: string; is_actor: boolean };
  meetings: {
    scheduled_date: string;
    reporting_month: string;
    due_at: string | null;
    closes_at: string;
  }[];
  may_record: boolean;
}

/**
 * Record's *Pending CG Records* (SKILL.md section 19, decision 0368):
 * `GET /api/v1/cells/meetings/pending`, and *Late only* on `GET /api/v1/dcc/pending-leaders`.
 *
 * The Men's tree is `Raymond -> Manuel -> Mark`, with `Ben` beside Manuel under Raymond; the
 * Women's is `Grace -> Hanna`. `Oscar` holds an Admin account and no place in the tree. Every
 * Cell meets on yesterday's weekday, so it owes yesterday's meeting and the one a week before,
 * and every date comes from the database's day. The weekly rule is moved to January 2026, so
 * a week closes two Mondays after it is due (decisions 0335 and 0387). Fixture names are invented
 * (CLAUDE.md, Secrets).
 */
describe('Pending CG Records (decision 0368)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let ben: TestPerson;
  let grace: TestPerson;
  let hanna: TestPerson;
  let oscar: TestPerson;

  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await db.destroy();
    await app.close();
  });

  beforeEach(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    await truncateAll(db);
    resetRateLimits(app);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alcantara',
      network: 'MENS',
    });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    ben = await createPerson(db, { firstName: 'Ben', lastName: 'Dizon', network: 'MENS' });
    await assignTo(db, ben.id, raymond.id);

    grace = await createPerson(db, { firstName: 'Grace', lastName: 'Hizon', network: 'WOMENS' });
    await assignTo(db, grace.id, null);
    hanna = await createPerson(db, { firstName: 'Hanna', lastName: 'Ilagan', network: 'WOMENS' });
    await assignTo(db, hanna.id, grace.id);

    oscar = await createPerson(db, { firstName: 'Oscar', lastName: 'Fajardo', network: 'MENS' });
  });

  const today = async (): Promise<string> => {
    const result = await sql<{ today: string }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
    `.execute(db);

    return result.rows[0].today;
  };

  const databaseNow = async (): Promise<number> => {
    const result = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);

    return new Date(result.rows[0].now).getTime();
  };

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** ISO 8601 weekday, 1 Monday to 7 Sunday. */
  const isoWeekday = (day: string): number => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

    return weekday === 0 ? 7 : weekday;
  };

  /**
   * A Cell meeting on yesterday's weekday, running for a year before today, with a member
   * beneath nobody from its first day so its meetings are owed (decision 0409). `withMember`
   * false leaves it empty, for a case that enrols and records its own member.
   */
  const cellFor = async (leader: TestPerson, withMember = true): Promise<TestCell> => {
    const yesterday = shift(await today(), -1);

    const cell = await createCell(db, {
      leader,
      dayOfWeek: isoWeekday(yesterday),
      createdAt: new Date(`${shift(yesterday, -365)}T02:00:00Z`),
    });
    if (withMember) {
      await addCellMember(db, cell);
    }

    return cell;
  };

  const leaderAccount = (person: TestPerson): Promise<TestAccount> =>
    createAccount(app, db, { person, roles: ['LEADER'], fullView: true });

  const admin = (): Promise<TestAccount> =>
    createAccount(app, db, { person: oscar, roles: ['ADMIN'] });

  async function list(
    reader: TestAccount,
    query: Record<string, string | number> = {},
    status = 200,
  ): Promise<{ data: Row[]; next_cursor: string | null } & Record<string, unknown>> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/cells/meetings/pending')
      .query(query)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .expect(status);

    return response.body as { data: Row[]; next_cursor: string | null };
  }

  const leaders = (rows: Row[]): string[] => rows.map((row) => row.leader.person_id);
  const rowOf = (rows: Row[], cell: TestCell): Row | undefined =>
    rows.find((row) => row.cell.id === cell.id);

  it('lists a Primary’s whole branch, one row per Cell, by first name, each open meeting oldest first', async () => {
    const yesterday = shift(await today(), -1);
    const raymondCell = await cellFor(raymond);
    await cellFor(manuel);
    await cellFor(mark);
    await cellFor(ben);
    await cellFor(hanna);
    const reader = await leaderAccount(raymond);

    const body = await list(reader);
    // Mark is two levels down and still listed: the scope is the grant's (decision 0336),
    // never Leaders Under Me's depth. Hanna, in the other Network, is not.
    expect(leaders(body.data)).toEqual([ben.id, manuel.id, mark.id, raymond.id]);
    expect(body).not.toHaveProperty('total');
    expect(body.next_cursor).toBeNull();

    const own = rowOf(body.data, raymondCell);
    const now = await databaseNow();
    expect(own?.leader.is_actor).toBe(true);
    expect(own?.cell).toMatchObject({ cell_code: raymondCell.cellId, closed_on: null });
    const dates = (own?.meetings ?? []).map((meeting) => meeting.scheduled_date);
    expect(dates).toContain(yesterday);
    expect(dates).toContain(shift(yesterday, -7));
    expect([...dates].sort()).toEqual(dates);
    // Only meetings whose week is still open (decision 0335).
    for (const meeting of own?.meetings ?? []) {
      expect(new Date(meeting.closes_at).getTime()).toBeGreaterThan(now);
    }
  });

  // Decision 0370: opened from a Recording Progress row, the list narrows to one leader's
  // branch now, within the reader's scope.
  it('narrows to one leader and everyone beneath them under leader_id', async () => {
    await cellFor(raymond);
    await cellFor(manuel);
    await cellFor(mark);
    await cellFor(ben);
    const reader = await leaderAccount(raymond);

    expect(leaders((await list(reader, { leader_id: manuel.id })).data)).toEqual([
      manuel.id,
      mark.id,
    ]);
    // The search still applies within it.
    expect(leaders((await list(reader, { leader_id: manuel.id, q: 'Mark' })).data)).toEqual([
      mark.id,
    ]);
  });

  it('refuses a leader outside the reader’s scope, whether or not they exist', async () => {
    await cellFor(ben);
    const reader = await leaderAccount(manuel);

    for (const leaderId of [ben.id, raymond.id, randomUUID()]) {
      const body = await list(reader, { leader_id: leaderId }, 403);
      expect(body).toMatchObject({
        error: { code: 'SCOPE_DENIED', details: { field: 'leader_id' } },
      });
    }
  });

  it('answers a Whole Church reader naming nobody NOT_FOUND, and lists any branch for them', async () => {
    await cellFor(hanna);
    await cellFor(ben);
    const reader = await admin();

    const missing = await list(reader, { leader_id: randomUUID() }, 404);
    expect(missing).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(leaders((await list(reader, { leader_id: grace.id })).data)).toEqual([hanna.id]);
  });

  it('answers a leader absorbed by a merge NOT_FOUND, as the report routes do', async () => {
    await cellFor(ben);
    const reader = await admin();
    await db
      .updateTable('persons')
      .set({ merged_into_id: manuel.id, merged_at: new Date(), merge_reason: 'Recorded twice' })
      .where('id', '=', ben.id)
      .execute();

    const body = await list(reader, { leader_id: ben.id }, 404);
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('refuses a leader_id that is not an identifier', async () => {
    const reader = await leaderAccount(raymond);
    const body = await list(reader, { leader_id: 'not-a-person' }, 422);
    expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('drops a meeting once it is recorded, and the Cell once none is left', async () => {
    const yesterday = shift(await today(), -1);
    const cell = await cellFor(manuel, false);
    await db
      .insertInto('cell_memberships')
      .values({
        person_id: mark.id,
        cell_id: cell.id,
        started_at: new Date(`${shift(yesterday, -300)}T02:00:00Z`),
      })
      .execute();
    const reader = await leaderAccount(manuel);

    const before = rowOf((await list(reader)).data, cell);
    expect(before?.meetings.map((meeting) => meeting.scheduled_date)).toContain(yesterday);

    for (const meeting of before?.meetings ?? []) {
      await request(app.getHttpServer())
        .post(`/api/v1/cells/${cell.id}/meetings/${meeting.scheduled_date}/submit`)
        .set('Authorization', `Bearer ${reader.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ status: 'HELD', attendance: [{ person_id: mark.id, present: true }] })
        .expect(201);
    }

    expect(rowOf((await list(reader)).data, cell)).toBeUndefined();
  });

  it('offers Record on the reader’s own Cell, and on another leader’s only to a reader who may record for them', async () => {
    const raymondCell = await cellFor(raymond);
    const markCell = await cellFor(mark);
    const reader = await leaderAccount(raymond);

    const rows = (await list(reader)).data;
    expect(rowOf(rows, raymondCell)?.may_record).toBe(true);
    // A Leader holds no cell.submit_on_behalf (decision 0322): Mark records his own.
    expect(rowOf(rows, markCell)?.may_record).toBe(false);

    const adminRows = (await list(await admin())).data;
    expect(rowOf(adminRows, markCell)?.may_record).toBe(true);
  });

  it('gives the Admin both Networks, and the Network filter narrows them', async () => {
    const raymondCell = await cellFor(raymond);
    const hannaCell = await cellFor(hanna);
    const reader = await admin();

    const all = (await list(reader)).data;
    expect(rowOf(all, raymondCell)).toBeDefined();
    expect(rowOf(all, hannaCell)).toBeDefined();

    const womens = (await list(reader, { network: 'WOMENS' })).data;
    expect(rowOf(womens, hannaCell)).toBeDefined();
    expect(rowOf(womens, raymondCell)).toBeUndefined();
  });

  it('searches by Cell ID or leader, and refuses a term too short', async () => {
    const manuelCell = await cellFor(manuel);
    const benCell = await cellFor(ben);
    const reader = await admin();

    expect(leaders((await list(reader, { q: 'manu' })).data)).toEqual([manuel.id]);
    const byCode = (await list(reader, { q: benCell.cellId.toLowerCase() })).data;
    expect(byCode.map((row) => row.cell.id)).toEqual([benCell.id]);
    expect(rowOf((await list(reader, { q: 'zzz' })).data, manuelCell)).toBeUndefined();

    await list(reader, { q: 'a ' }, 422);
  });

  it('keeps a closed Cell listed while its weeks are open', async () => {
    const yesterday = shift(await today(), -1);
    const cell = await cellFor(ben);
    await closeCellDirectly(db, cell.id, {
      reason: 'LEADER_MOVED_AWAY',
      note: 'Moved for work.',
      at: new Date(`${yesterday}T10:00:00Z`),
    });
    const reader = await leaderAccount(raymond);

    const row = rowOf((await list(reader)).data, cell);
    expect(row?.cell.closed_on).toBe(yesterday);
    expect(row?.leader.person_id).toBe(ben.id);
  });

  it('keeps only the meetings past their deadline under late=true, and refuses another value', async () => {
    const cell = await cellFor(manuel);
    const reader = await leaderAccount(manuel);
    const now = await databaseNow();

    const all = rowOf((await list(reader)).data, cell);
    const pastDue = (all?.meetings ?? []).filter(
      (meeting) => meeting.due_at !== null && new Date(meeting.due_at).getTime() < now,
    );
    // The meeting two weeks before yesterday is past its deadline and its week still open.
    expect(pastDue.length).toBeGreaterThan(0);

    const late = rowOf((await list(reader, { late: 'true' })).data, cell);
    expect(late?.meetings.map((meeting) => meeting.scheduled_date)).toEqual(
      pastDue.map((meeting) => meeting.scheduled_date),
    );

    await list(reader, { late: 'yes' }, 422);
  });

  it('reaches a Primary’s whole branch, past the two levels Leaders Under Me stops at', async () => {
    // Juan is three levels below Raymond (Raymond -> Manuel -> Mark -> Juan); decision 0324
    // stops Leaders Under Me at two, and this list takes the grant's scope (decision 0336).
    const juan = await createPerson(db, {
      firstName: 'Juan',
      lastName: 'Estrada',
      network: 'MENS',
    });
    await assignTo(db, juan.id, mark.id);
    const juanCell = await cellFor(juan);
    const reader = await leaderAccount(raymond);

    expect(rowOf((await list(reader)).data, juanCell)?.leader.person_id).toBe(juan.id);
  });

  it('shows a leader nothing above or beside them', async () => {
    const raymondCell = await cellFor(raymond);
    const manuelCell = await cellFor(manuel);
    const benCell = await cellFor(ben);
    const markCell = await cellFor(mark);
    const reader = await leaderAccount(mark);

    const rows = (await list(reader)).data;
    expect(rowOf(rows, markCell)).toBeDefined();
    for (const cell of [raymondCell, manuelCell, benCell]) {
      expect(rowOf(rows, cell)).toBeUndefined();
    }
  });

  it('finds a leader by Member ID', async () => {
    const manuelCell = await cellFor(manuel);
    await cellFor(ben);
    const reader = await admin();
    const { member_id: memberId } = await db
      .selectFrom('persons')
      .select('member_id')
      .where('id', '=', manuel.id)
      .executeTakeFirstOrThrow();

    const rows = (await list(reader, { q: memberId.toLowerCase() })).data;
    expect(rows.map((row) => row.cell.id)).toEqual([manuelCell.id]);
  });

  it('gives a Cell handed over and then closed a row for each leader, each naming their own meeting', async () => {
    const yesterday = shift(await today(), -1);
    const weekBefore = shift(yesterday, -7);
    const cell = await cellFor(manuel);
    // Manuel hands the Cell to Ben the day after the earlier meeting, and it closes after
    // the later one, so each meeting is filed by the leader of its own date (section 7).
    const handover = new Date(`${shift(weekBefore, 1)}T02:00:00Z`);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: handover })
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('cell_leaderships')
        .values({ cell_id: cell.id, person_id: ben.id, started_at: handover })
        .execute();
    });
    await closeCellDirectly(db, cell.id, {
      reason: 'LEADER_MOVED_AWAY',
      note: 'Moved for work.',
      at: new Date(`${yesterday}T10:00:00Z`),
    });
    const reader = await admin();

    const rows = (await list(reader)).data.filter((row) => row.cell.id === cell.id);
    expect(rows.map((row) => row.leader.person_id)).toEqual([ben.id, manuel.id]);
    const dates = (person: TestPerson) =>
      rows
        .find((row) => row.leader.person_id === person.id)
        ?.meetings.map((meeting) => meeting.scheduled_date) ?? [];
    expect(dates(manuel)).toContain(weekBefore);
    expect(dates(manuel)).not.toContain(yesterday);
    expect(dates(ben)).toEqual([yesterday]);

    // Each row follows its own leader through the search.
    const byBen = (await list(reader, { q: 'dizon' })).data.filter(
      (row) => row.cell.id === cell.id,
    );
    expect(byBen.map((row) => row.leader.person_id)).toEqual([ben.id]);
  });

  it('pages by the leader’s name, a leader of two Cells keeping both', async () => {
    const first = await cellFor(manuel);
    const second = await cellFor(manuel);
    await cellFor(ben);
    const reader = await leaderAccount(raymond);

    const pageOne = await list(reader, { limit: 2 });
    expect(pageOne.data).toHaveLength(2);
    expect(pageOne.next_cursor).not.toBeNull();
    const pageTwo = await list(reader, { limit: 2, cursor: pageOne.next_cursor as string });

    const seen = [...pageOne.data, ...pageTwo.data].map((row) => row.cell.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(leaders([...pageOne.data, ...pageTwo.data])).toEqual([ben.id, manuel.id, manuel.id]);
  });
});

/**
 * *Late only* on Pending DCC Records (decision 0368): the Sundays past their deadline whose
 * week is still open, and the leaders who owe one.
 */
describe('Pending DCC Records, late only (decision 0368)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await db.destroy();
    await app.close();
  });

  it('keeps only Sundays past their deadline, and refuses another value', async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    await truncateAll(db);
    resetRateLimits(app);

    const root = await createPerson(db, {
      firstName: 'Ramon',
      lastName: 'Aquino',
      network: 'MENS',
    });
    await assignTo(db, root.id, null);
    const lead = await createPerson(db, { firstName: 'Lito', lastName: 'Bacani', network: 'MENS' });
    await assignTo(db, lead.id, root.id);
    const disciple = await createPerson(db, {
      firstName: 'Dino',
      lastName: 'Cabrera',
      network: 'MENS',
    });
    await assignTo(db, disciple.id, lead.id);
    const reader = await createAccount(app, db, {
      person: lead,
      roles: ['LEADER'],
      fullView: true,
    });

    const todayResult = await sql<{ today: string; now: Date }>`
      SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today, now() AS now
    `.execute(db);
    const day = todayResult.rows[0].today;
    const now = new Date(todayResult.rows[0].now).getTime();
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const [y, m, d] = day.split('-').map(Number);
    const sunday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 7 : weekday)))
      .toISOString()
      .slice(0, 10);
    const weekBefore = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 21 : weekday + 14)))
      .toISOString()
      .slice(0, 10);
    for (const eventDate of [weekBefore, sunday]) {
      await db.insertInto('dcc_events').values({ event_date: eventDate }).execute();
    }

    const ask = (query: Record<string, string>, status = 200) =>
      request(app.getHttpServer())
        .get('/api/v1/dcc/pending-leaders')
        .query(query)
        .set('Authorization', `Bearer ${reader.accessToken}`)
        .expect(status);

    const all = (await ask({})).body.data as {
      leader: { person_id: string };
      sundays: { event_date: string; due_at: string | null }[];
    }[];
    const own = all.find((row) => row.leader.person_id === lead.id);
    const pastDue = (own?.sundays ?? []).filter(
      (sunday) => sunday.due_at !== null && new Date(sunday.due_at).getTime() < now,
    );
    expect(pastDue.map((s) => s.event_date)).toContain(weekBefore);

    const late = (await ask({ late: 'true' })).body.data as typeof all;
    expect(
      late.find((row) => row.leader.person_id === lead.id)?.sundays.map((s) => s.event_date),
    ).toEqual(pastDue.map((s) => s.event_date));

    await ask({ late: 'yes' }, 422);
  });
});
