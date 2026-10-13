import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { DccCalendarService } from '../../src/attendance/dcc-calendar.service';
import { manilaDayOf } from '../../src/common/time/manila';
import {
  databaseNow,
  monthClosesAt,
  recordClosesAt,
  reportingMonthOf,
} from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import {
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

/**
 * Recording against a closed week inside a month that is still open (SKILL.md sections 7,
 * 9 and 13, decision 0335): the case the weekly rule creates and the monthly one never had.
 *
 * The weekly rule is moved to start in January 2026 through `WEEKLY_DEADLINE_FROM`, which
 * only a test process reads, so every week read here is under it. **The week has to be
 * found rather than written down**: a closed week inside an open month exists on most days
 * but not every day (between a month's last week closing and the current month's first
 * week closing there is none), so each case asks for one and passes without asserting where
 * there is none. Every date comes from the database's day. Fixture names are invented.
 */
describe('a closed week inside an open month (decision 0335)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let admin: TestAccount;

  const CREATED = new Date('2026-01-03T10:00:00+08:00');
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
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    // Saturdays, so a meeting and the Sunday after it share a week.
    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });
  });

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  /** The most recent Saturday on or before the database's day: always in an open week. */
  async function openSaturday(): Promise<string> {
    const today = manilaDayOf(await databaseNow(db));
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

    return shift(today, -((weekday + 1) % 7));
  }

  /** The latest Saturday whose week has closed while its month is still open, or null. */
  async function closedSaturdayInOpenMonth(): Promise<string | null> {
    const now = (await databaseNow(db)).getTime();
    let day = await openSaturday();
    for (let back = 0; back < 10; back += 1, day = shift(day, -7)) {
      if (
        recordClosesAt(day).getTime() <= now &&
        monthClosesAt(reportingMonthOf(day)).getTime() > now
      ) {
        return day;
      }
    }

    return null;
  }

  async function member(firstName: string): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: 'MENS' });
    await assignTo(db, person.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: markCell.id, started_at: CREATED })
      .execute();

    return person;
  }

  const submitCell = (as: TestAccount, date: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${markCell.id}/meetings/${date}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const submitDcc = (as: TestAccount, eventId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  async function createEvent(eventDate: string): Promise<string> {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: eventDate })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  }

  const audited = async (action: 'cell_attendance.amended' | 'dcc_attendance.amended') =>
    (await db.selectFrom('audit_log').select('id').where('action', '=', action).execute()).length;

  it('refuses a leader a Cell meeting whose week has closed, and takes an Admin amendment, audited', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return; // No closed week in an open month today; see the file's docblock.
    }
    const one = await member('Aurelio');
    const body = { status: 'HELD', attendance: [{ person_id: one.id, present: true }] };

    const refused = await submitCell(markAccount, closed, body).expect(409);
    expect(refused.body.error.code).toBe('PERIOD_CLOSED');
    expect(refused.body.error.message).toMatch(/week is closed/);

    await submitCell(admin, closed, {
      ...body,
      amendment: { reason: 'Paper register found.' },
    }).expect(201);
    expect(await audited('cell_attendance.amended')).toBe(1);
  });

  it('refuses an amendment of a week that is still open', async () => {
    const one = await member('Aurelio');
    const response = await submitCell(admin, await openSaturday(), {
      status: 'HELD',
      attendance: [{ person_id: one.id, present: true }],
      amendment: { reason: 'Nothing to amend.' },
    }).expect(409);

    expect(response.body.error.message).toMatch(/week is still open/);
  });

  it('refuses a reschedule into a closed week, unless it is an amendment', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return;
    }
    const one = await member('Aurelio');
    const open = await openSaturday();
    await submitCell(markAccount, open, {
      status: 'HELD',
      attendance: [{ person_id: one.id, present: true }],
    }).expect(201);

    const moved = await submitCell(admin, open, {
      status: 'RESCHEDULED',
      version: 1,
      actual_date: closed,
      attendance: [{ person_id: one.id, present: true }],
    }).expect(409);

    expect(moved.body.error.code).toBe('PERIOD_CLOSED');
  });

  it('ends a closed Cell’s exception when the meeting’s week closes, not when its month does', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return;
    }
    const one = await member('Aurelio');
    await closeCellDirectly(db, markCell.id, { reason: 'LEADER_STEPPED_DOWN' });
    const body = { status: 'HELD', attendance: [{ person_id: one.id, present: true }] };

    // The Cell has no leader to resolve through once the week has closed (section 7).
    const late = await submitCell(markAccount, closed, body).expect(403);
    expect(late.body.error.code).toBe('SCOPE_DENIED');

    await submitCell(markAccount, await openSaturday(), body).expect(201);
  });

  it('refuses a DCC line for a closed week to a leader, and takes an Admin amendment, audited', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return;
    }
    const disciple = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, disciple.id, mark.id);
    const eventId = await createEvent(shift(closed, 1));
    const records = [{ person_id: disciple.id, present: true, version: null }];

    const refused = await submitDcc(markAccount, eventId, { records }).expect(409);
    expect(refused.body.error.code).toBe('PERIOD_CLOSED');
    expect(refused.body.error.message).toMatch(/week is closed/);

    await submitDcc(admin, eventId, {
      records,
      amendment: { reason: 'Paper register found.' },
    }).expect(201);
    expect(await audited('dcc_attendance.amended')).toBe(1);
  });

  it('never adds a Sunday whose week has closed to the DCC calendar', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return;
    }
    const sunday = shift(closed, 1);
    const calendar = app.get(DccCalendarService);
    await calendar.generate();
    await sql`UPDATE settings SET value = to_jsonb(${sunday}::text) WHERE key = 'dcc_calendar_start'`.execute(
      db,
    );

    const run = await calendar.generate();
    const now = (await databaseNow(db)).getTime();

    expect(run.created).not.toContain(sunday);
    expect(run.closedMonthsShort).toContain(reportingMonthOf(sunday));
    for (const day of run.created) {
      expect(recordClosesAt(day).getTime()).toBeGreaterThan(now);
    }
  });

  it('counts a meeting as behind only while its week is open', async () => {
    const closed = await closedSaturdayInOpenMonth();
    if (closed === null) {
      return;
    }
    const month = reportingMonthOf(closed);
    const now = (await databaseNow(db)).getTime();
    const today = manilaDayOf(await databaseNow(db));
    // Every Saturday of that month that has begun and has no record, and still open.
    let expected = 0;
    for (
      let day = `${month.slice(0, 8)}01`;
      day.startsWith(month.slice(0, 7));
      day = shift(day, 1)
    ) {
      if (new Date(`${day}T00:00:00Z`).getUTCDay() === 6 && day <= today) {
        expected += recordClosesAt(day).getTime() > now ? 1 : 0;
      }
    }

    const response = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month })
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const row = (response.body.data as { id: string; coverage: { behind: number } }[]).find(
      (cell) => cell.id === markCell.id,
    );

    expect(response.body.open).toBe(true);
    // The closed week's meeting has no record and is not behind (owner, 2026-10-13).
    expect(row?.coverage.behind).toBe(expected);
  });

  /**
   * The Branch screen's two figures, for the current month (decision 0252): behind only while
   * the week is open. **Discriminating only once the month has a closed week**, from about
   * the 19th to its end; before that every week of the month is open and both counts agree
   * with the unbounded ones.
   */
  it('counts the Branch screen’s Cell meetings and DCC records behind only while the week is open', async () => {
    const today = manilaDayOf(await databaseNow(db));
    const now = (await databaseNow(db)).getTime();
    const month = reportingMonthOf(today);
    const disciple = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, disciple.id, mark.id);

    let saturdays = 0;
    let sundays = 0;
    for (let day = month; day <= today && day.startsWith(month.slice(0, 7)); day = shift(day, 1)) {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const open = recordClosesAt(day).getTime() > now;
      if (weekday === 6 && open) {
        saturdays += 1;
      }
      if (weekday === 0) {
        await createEvent(day);
        sundays += open ? 1 : 0;
      }
    }

    const read = (route: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/leaders/${root.id}/${route}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

    expect((await read('cell-figures')).body.branch_meetings_behind).toBe(saturdays);
    // Two obligations a Sunday: Oriel's for Mark's line and Mark's for Timothy's.
    expect((await read('dcc-behind')).body.branch_behind).toBe(sundays * 2);
  });
});
