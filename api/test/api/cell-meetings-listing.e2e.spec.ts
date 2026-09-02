import request from 'supertest';

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
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/cells/{id}/meetings` (SKILL.md sections 12, 13 and 22).
 *
 * **The scheduled meetings are derived and the recorded ones are stored**, and what
 * is checked here is the join of the two. Section 13: a meeting "has no row until it
 * is reported", so a month's listing cannot be a table scan — the scheduled set comes
 * from `cell_schedules` run against the calendar, and a `null` meeting is the
 * "awaiting a record" of sections 13 and 19 rather than a fourth status.
 *
 * The derivation is where the defects live, so most of these cases are arithmetic
 * against a real calendar rather than against a fixture's idea of one. September 2026
 * begins on a Tuesday and holds **four** Saturdays (5, 12, 19, 26); August 2026 holds
 * **five** (1, 8, 15, 22, 29). Both are used, because a rule that counts a month's
 * meetings is one an off-by-one survives in a four-Saturday month.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('a Cell meetings listing (sections 12 and 13)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let stranger: TestAccount;

  /** A Saturday schedule, and a Cell that has been running since 2026. */
  const CREATED = new Date('2026-01-03T10:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    const other = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, other.id, root.id);
    stranger = await createAccount(app, db, { person: other, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  const list = (cellId: string, month: string, as: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/${cellId}/meetings`)
      .query({ month })
      .set('Authorization', `Bearer ${as.accessToken}`);

  it('derives every scheduled date in the month, and none is recorded yet', async () => {
    // Four Saturdays in September 2026, and every one awaiting a record. The `null`
    // is section 13's "outstanding task, shown to the responsible leader as a meeting
    // awaiting a record" — an absence of data, never a status.
    const response = await list(markCell.id, '2026-09-01', markAccount);

    expect(response.status).toBe(200);
    expect(response.body.scheduled_count).toBe(4);
    expect(response.body.recorded_count).toBe(0);
    expect(response.body.meetings.map((m: { scheduled_date: string }) => m.scheduled_date)).toEqual(
      ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'],
    );
    expect(response.body.meetings.every((m: { meeting: unknown }) => m.meeting === null)).toBe(
      true,
    );
  });

  it('counts five where the month holds five', async () => {
    // August 2026 has five Saturdays. A separate case rather than a parameter, because
    // section 12 states 4 **or** 5 and an off-by-one that always drops the last one
    // survives every four-Saturday month.
    const response = await list(markCell.id, '2026-08-31', markAccount);

    expect(response.status).toBe(200);
    expect(response.body.reporting_month).toBe('2026-08-01');
    expect(response.body.scheduled_count).toBe(5);
    expect(response.body.meetings.map((m: { scheduled_date: string }) => m.scheduled_date)).toEqual(
      ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29'],
    );
  });

  it('takes any day of the month and answers about the month', async () => {
    // Section 22: a date-only field is a Manila date. The service normalises it, so a
    // client holding a date rather than a month does not have to truncate — which is
    // where a month silently shifts if a client does it in local time.
    const first = await list(markCell.id, '2026-09-01', markAccount);
    const middle = await list(markCell.id, '2026-09-17', markAccount);

    expect(middle.status).toBe(200);
    expect(middle.body).toEqual(first.body);
  });

  it('starts each week on the Monday', async () => {
    // Section 20 begins a calendar week on Monday, and `week_starting` is the Monday
    // of the week the meeting belongs to (section 13). Saturday 5 September 2026 sits
    // in the week beginning Monday 31 August — which is in the *previous* month, and
    // is the case a Sunday-based week or a naive truncation gets wrong.
    const response = await list(markCell.id, '2026-09-01', markAccount);

    expect(
      response.body.meetings.map((m: { scheduled_date: string; week_starting: string }) => [
        m.scheduled_date,
        m.week_starting,
      ]),
    ).toEqual([
      ['2026-09-05', '2026-08-31'],
      ['2026-09-12', '2026-09-07'],
      ['2026-09-19', '2026-09-14'],
      ['2026-09-26', '2026-09-21'],
    ]);
  });

  it('joins a recorded meeting onto its scheduled date', async () => {
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: '2026-09-12',
        scheduled_time: '19:00',
        week_starting: '2026-09-07',
        reporting_month: '2026-09-01',
        status: 'HELD',
        responsible_leader_id: mark.id,
      } as never)
      .execute();

    const response = await list(markCell.id, '2026-09-01', markAccount);

    expect(response.body.scheduled_count).toBe(4);
    expect(response.body.recorded_count).toBe(1);

    const recorded = response.body.meetings.find(
      (m: { scheduled_date: string }) => m.scheduled_date === '2026-09-12',
    );
    expect(recorded.meeting.status).toBe('HELD');
    expect(recorded.meeting.responsible_leader_id).toBe(mark.id);
    expect(recorded.meeting.version).toBe(1);
  });

  it('keeps a rescheduled meeting in the month it reports in', async () => {
    // Section 13: a `RESCHEDULED` meeting "remains part of January's Cell meeting
    // report and does not create an additional February meeting". The row is selected
    // by `reporting_month` and keyed by `scheduled_date`, so a meeting moved into the
    // next month stays on the scheduled date it belongs to and appears once.
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: markCell.id,
        scheduled_date: '2026-09-26',
        scheduled_time: '19:00',
        week_starting: '2026-09-21',
        reporting_month: '2026-09-01',
        status: 'RESCHEDULED',
        actual_date: '2026-10-03',
        actual_time: '19:00',
        responsible_leader_id: mark.id,
      } as never)
      .execute();

    const september = await list(markCell.id, '2026-09-01', markAccount);
    const october = await list(markCell.id, '2026-10-01', markAccount);

    const moved = september.body.meetings.find(
      (m: { scheduled_date: string }) => m.scheduled_date === '2026-09-26',
    );
    expect(moved.meeting.status).toBe('RESCHEDULED');
    expect(moved.meeting.actual_date).toBe('2026-10-03');
    expect(september.body.recorded_count).toBe(1);

    // And it is not in October, where its actual date falls.
    expect(october.body.recorded_count).toBe(0);
  });

  it('has fewer scheduled meetings in the month a Cell was created', async () => {
    // Section 12: "A Cell created or closed part-way through a month has fewer, and
    // that is not an anomaly." The schedule row opens at `created_at`, so the
    // Saturdays before it are not the Cell's.
    const late = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
    await assignTo(db, late.id, root.id);
    const lateCell = await createCell(db, {
      leader: late,
      dayOfWeek: 6,
      // After the first two Saturdays of August 2026 (1 and 8).
      createdAt: new Date('2026-08-12T10:00:00+08:00'),
    });
    const lateAccount = await createAccount(app, db, { person: late, roles: ['LEADER'] });

    const response = await list(lateCell.id, '2026-08-01', lateAccount);

    expect(response.body.scheduled_count).toBe(3);
    expect(response.body.meetings.map((m: { scheduled_date: string }) => m.scheduled_date)).toEqual(
      ['2026-08-15', '2026-08-22', '2026-08-29'],
    );
  });

  it('keeps a meeting on the day the Cell was created', async () => {
    // **The opening edge, and the case that was missing.** The month-of-creation case
    // above creates the Cell on a Wednesday, so no scheduled Saturday falls on the
    // creation date and the bound's day-granularity goes unexercised — a mutation
    // narrowing `<= day` to `< day` passed every case until this one existed.
    //
    // Section 10 opens the schedule row at `created_at` and says nothing about a
    // meeting that same day. This pins the reading the code takes: the day counts. It
    // is the direction section 13 takes at the closing edge, where a meeting on the
    // closure date "reads the Cell as it stood that day", and the opposite reading
    // would refuse a record for a meeting the leader believes they held. Recorded in
    // `CLAUDE.md` as a question rather than settled here — what this case does is make
    // the answer visible if somebody changes it.
    const sameDay = await createPerson(db, { firstName: 'Elias', network: 'MENS' });
    await assignTo(db, sameDay.id, root.id);
    const sameDayCell = await createCell(db, {
      leader: sameDay,
      dayOfWeek: 6,
      // Saturday 8 August 2026, in the morning; the Cell meets at 19:00 that evening.
      createdAt: new Date('2026-08-08T09:00:00+08:00'),
    });
    const sameDayAccount = await createAccount(app, db, { person: sameDay, roles: ['LEADER'] });

    const response = await list(sameDayCell.id, '2026-08-01', sameDayAccount);

    expect(response.body.meetings.map((m: { scheduled_date: string }) => m.scheduled_date)).toEqual(
      ['2026-08-08', '2026-08-15', '2026-08-22', '2026-08-29'],
    );
  });

  it('keeps the meeting on the day the Cell closed, and drops the ones after', async () => {
    // **Section 13's closure boundary, and it is the subtle one.** A closure ends the
    // schedule row *on* the closure date, so an instant comparison would drop a meeting
    // held that very day — and section 13 says the opposite: "A meeting dated the day
    // the Cell closed reads the Cell as it stood that day", because the leader and the
    // roster are read at one instant and the Cell did meet.
    //
    // Closed on Saturday 15 August 2026, which is itself a scheduled date. The 15th
    // survives; the 22nd and 29th do not, because "a meeting dated after the closure is
    // refused: the Cell did not exist to meet".
    const leaving = await createPerson(db, { firstName: 'Rafael', network: 'MENS' });
    await assignTo(db, leaving.id, root.id);
    const closingCell = await createCell(db, {
      leader: leaving,
      dayOfWeek: 6,
      createdAt: CREATED,
    });
    const leavingAccount = await createAccount(app, db, { person: leaving, roles: ['LEADER'] });

    await closeCellDirectly(db, closingCell.id, {
      reason: 'MEMBERS_DISPERSED',
      at: new Date('2026-08-15T21:00:00+08:00'),
    });

    const response = await list(closingCell.id, '2026-08-01', leavingAccount);

    expect(response.body.meetings.map((m: { scheduled_date: string }) => m.scheduled_date)).toEqual(
      ['2026-08-01', '2026-08-08', '2026-08-15'],
    );
  });

  it('refuses a caller who cannot reach the Cell', async () => {
    // `cell.take_attendance` resolved against the Cell (section 7). A leader of a
    // different branch is out of scope, and the refusal is the guard's rather than
    // anything this route decides.
    const response = await list(markCell.id, '2026-09-01', stranger);

    expect(response.status).toBe(403);
  });

  it.each(['-02-30', '-13-05', '-09-31'])(
    'refuses a %s month that has the shape of a date and is not one',
    async (suffix) => {
      // **This route carries no `{meeting_id}`, so the guard's calendar check never
      // runs for it** — and its DTO validated only the shape. `reportingMonthOf` was
      // then changed to refuse an impossible date, which turned `2026-02-30` from a
      // 200 answering February's listing into a 500: the refusal was a plain `Error`,
      // which the exception filter renders as `INTERNAL_ERROR`.
      //
      // That was introduced by the commit that fixed the identical defect on the two
      // routes which *do* name a meeting. The same defect, one route sideways, shipped
      // inside its own fix — and the case that should have caught it passed
      // `'September'`, which the shape check already refused.
      const response = await list(markCell.id, `2026${suffix}`, markAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');

      // **Which layer answered, asserted rather than assumed.** There are two: the
      // DTO refuses at the edge and names the field `month`, and `reportingMonthOf`
      // is a backstop that names `date`. Either alone answers 422, so a case checking
      // only the status is pinned by the conjunction and no single mutation reddens
      // it — weakening the DTO to `strict: false` lets `2026-02-30` through and the
      // backstop still answers 422. Naming the field pins the edge specifically.
      expect(response.body.error.details?.field ?? 'month').toBe('month');
    },
  );

  it('refuses a month that is not a date', async () => {
    const response = await list(markCell.id, 'September', markAccount);

    expect(response.status).toBe(422);
  });

  it('answers 404 for a Cell that does not exist', async () => {
    // An Admin, so the refusal is about the Cell rather than about scope.
    const adminPerson = await createPerson(db, { firstName: 'Admin', network: 'MENS' });
    await assignTo(db, adminPerson.id, root.id);
    const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    const response = await list('00000000-0000-4000-8000-000000000000', '2026-09-01', admin);

    expect(response.status).toBe(404);
  });
});
