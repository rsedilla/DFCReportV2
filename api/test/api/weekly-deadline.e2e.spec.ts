import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { reportRangeGuardMonth } from '../../src/common/time/report-range';
import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow, recordDueAt } from '../../src/common/time/submission-window';
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
 * The weekly deadline (SKILL.md section 13, decisions 0335 and 0387): a week is due at 12 noon
 * the second Monday after it, a record first made after that is Late, and the week closes two
 * Mondays later.
 *
 * **The rule starts on 26 October 2026, and no real clock reaches a closed week of it before
 * 23 November**, so this file moves the start to a Monday ten weeks before the database's own
 * week through `WEEKLY_DEADLINE_FROM`, which only a test process reads. Every date is computed
 * from the database's day, as the other attendance suites do. Fixture names are invented.
 */
describe('The weekly deadline (decision 0335)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let gemma: TestPerson;
  let pastor: TestAccount;

  const LONG_AGO = new Date('2024-01-03T12:00:00+08:00');
  const previous = process.env.WEEKLY_DEADLINE_FROM;
  let thisMonday: string;
  let from: string;

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  const isoDay = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return weekday === 0 ? 7 : weekday;
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    const today = manilaDayOf(await databaseNow(db));
    thisMonday = shift(today, 1 - isoDay(today));
    from = shift(thisMonday, -70);
    process.env.WEEKLY_DEADLINE_FROM = from;
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', lastName: 'Villanueva', network: 'MENS' });
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

  /** A week's Monday by how many weeks before this one, and a day of it by ISO weekday. */
  const week = (back: number) => {
    const monday = shift(thisMonday, -7 * back);

    return { monday, day: (iso: number) => shift(monday, iso - 1) };
  };

  async function leader(firstName: string, under: TestPerson): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: under.network });
    await assignTo(db, person.id, under.id);

    return person;
  }

  async function cellOf(person: TestPerson, dayOfWeek: number): Promise<TestCell> {
    return createCell(db, { leader: person, dayOfWeek, createdAt: LONG_AGO });
  }

  /** A record for one meeting, first made at `at`. */
  async function recordMeeting(cell: TestCell, date: string, leaderId: string, at: Date) {
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
        submitted_at: at,
        created_at: at,
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

  function status(kind: 'WEEK' | 'MONTH', start: string): request.Test {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    return request(app.getHttpServer())
      .get('/api/v1/reports/recording-status')
      .query({ kind, start, period: reportRangeGuardMonth(kind, start, today) })
      .set('Authorization', `Bearer ${pastor.accessToken}`);
  }

  const hours = (at: Date, by: number) => new Date(at.getTime() + by * 60 * 60 * 1000);

  it('counts a meeting first reported after its week’s deadline as late, and on time before it', async () => {
    const last = week(2);
    const due = recordDueAt(last.day(3)) as Date;
    const ana = await leader('Ana', oriel);
    const ben = await leader('Ben', oriel);
    await recordMeeting(await cellOf(ana, 3), last.day(3), ana.id, hours(due, 1));
    await recordMeeting(await cellOf(ben, 3), last.day(3), ben.id, hours(due, -1));

    const response = await status('WEEK', last.monday).expect(200);

    expect(response.body.deadline).toBe(true);
    expect(response.body.whole_church.cell).toEqual({
      recorded: 2,
      owed: 2,
      late: 1,
      on_time: 1,
      percent: 50,
    });
  });

  it('counts a DCC Sunday late when the first record that counts it came after the deadline', async () => {
    const last = week(2);
    const sunday = last.day(7);
    const due = recordDueAt(sunday) as Date;
    const ana = await leader('Ana', oriel);
    const bob = await leader('Bob', ana);
    await createAccount(app, db, { person: ana, roles: ['LEADER'] });
    await db.updateTable('accounts').set({ created_at: LONG_AGO }).execute();
    const eventId = await createEvent(sunday);

    // Ana's line for Bob, first made an hour after the deadline.
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: bob.id,
        present: true,
        responsible_leader_id: ana.id,
        recorded_by: pastor.id,
        recorded_at: hours(due, 1),
      })
      .execute();

    const response = await status('WEEK', last.monday).expect(200);

    // Oriel owes Ana's line and has none; Ana owes Bob's and made it late.
    expect(response.body.whole_church.dcc).toMatchObject({
      recorded: 1,
      owed: 2,
      late: 1,
      on_time: 0,
      percent: 0,
    });
  });

  it('has no deadline for a week before the weekly rule, so nothing in it is late', async () => {
    const before = week(11);
    expect(before.monday < from).toBe(true);
    const ana = await leader('Ana', oriel);
    await recordMeeting(await cellOf(ana, 3), before.day(3), ana.id, new Date());

    const response = await status('WEEK', before.monday).expect(200);

    expect(response.body.deadline).toBe(false);
    expect(response.body.whole_church.cell).toMatchObject({
      recorded: 1,
      owed: 1,
      late: 0,
      percent: 100,
    });
  });

  it('refuses a DCC record once its week has closed, and takes one while it is open', async () => {
    const ana = await leader('Ana', oriel);
    const bob = await leader('Bob', ana);
    const account = await createAccount(app, db, { person: ana, roles: ['LEADER'] });
    const submit = (eventId: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${eventId}/submit`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ records: [{ person_id: bob.id, present: true, version: null }] });

    // Five weeks back closed at noon on last Monday; last week closes in three weeks.
    const closed = await submit(await createEvent(week(5).day(7))).expect(409);
    expect(closed.body.error.code).toBe('PERIOD_CLOSED');

    await submit(await createEvent(week(1).day(7))).expect(201);
  });

  it('says on each awaiting meeting when it is due and when it closes, and drops a closed week', async () => {
    const ana = await leader('Ana', oriel);
    const account = await createAccount(app, db, { person: ana, roles: ['LEADER'] });
    await cellOf(ana, 3);
    const awaiting = (month: string) =>
      request(app.getHttpServer())
        .get('/api/v1/cells/meetings/awaiting')
        .query({ month })
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

    const open = week(1).day(3);
    const shut = week(5).day(3);
    const months = [...new Set([open, shut].map((day) => `${day.slice(0, 7)}-01`))];
    const meetings = (await Promise.all(months.map(awaiting))).flatMap(
      (response) =>
        response.body.meetings as { scheduled_date: string; due_at: string; closes_at: string }[],
    );

    const row = meetings.find((meeting) => meeting.scheduled_date === open);
    expect(row?.due_at).toBe((recordDueAt(open) as Date).toISOString());
    expect(new Date(row?.closes_at ?? 0).getTime() - new Date(row?.due_at ?? 0).getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
    expect(meetings.some((meeting) => meeting.scheduled_date === shut)).toBe(false);
  });
});
