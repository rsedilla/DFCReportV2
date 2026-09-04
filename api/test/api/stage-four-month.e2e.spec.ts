import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
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
 * Stage 4's exit criterion, walked end to end (`docs/ROADMAP.md`).
 *
 * > a leader records a full month of Cell meetings and a month of DCC, the month closes on
 * > the 7th, and a concurrent double submission produces a conflict for a person to resolve
 * > rather than a silent overwrite.
 *
 * Every other attendance spec exercises one slice against a fixture built for it. This one
 * exists because the slices were never run *together*: recording, the submission window,
 * an Admin amendment, a status transition and a conflict all touch the same rows, and a
 * month is the unit the domain is actually measured in (sections 12 and 20).
 *
 * **"A full month" means every meeting of the month that has already happened**, and on the
 * first seven days of any month that is the whole of the previous one. The walk anchors on
 * the most recent Saturday strictly before today, so every date it names is in the past and
 * inside an open window; how many meetings that is varies between one and five with the
 * calendar, so the assertions count what the schedule derives rather than a number written
 * here. A test that hard-codes four goes red on the days when the answer is three.
 *
 * **The close is shown on a different month, because a test cannot advance the clock.** The
 * service reads its instant from the database and there is no seam to inject one, so the
 * month that shuts is one that genuinely has, two months back. That is the honest version:
 * a real refusal, not a simulated one.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Stage 4 exit criterion: a month, its close, and a conflict', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  /** Raymond (root) -> Manuel -> Mark -> Timothy. Mark leads the Cell. */
  let mark: TestPerson;
  let timothy: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let admin: TestAccount;
  let members: TestPerson[];

  /** Long before any month this walks, so no meeting predates the Cell (decision 0184). */
  const CREATED = new Date('2026-01-03T10:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    // A month of meetings is a lot of requests against one source address, and the limiter
    // is global at 120 a minute (`fixtures.ts`).
    resetRateLimits(app);

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);

    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    members = [];
    for (const name of ['Aurelio', 'Benigno', 'Crisanto']) {
      members.push(await member(name));
    }
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function member(firstName: string): Promise<TestPerson> {
    const person = await createPerson(db, { firstName, network: 'MENS' });
    await assignTo(db, person.id, mark.id);
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: markCell.id, started_at: CREATED })
      .execute();

    return person;
  }

  // ---------------------------------------------------------------------------
  // Dates, every one of them computed from the database's own day
  // ---------------------------------------------------------------------------

  const today = async (): Promise<string> => manilaDayOf(await databaseNow(db));

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  const isoDayOf = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  /**
   * The most recent Saturday **strictly before** today, which is always inside an open
   * month and is always a day that has finished.
   *
   * Strictly before, so that a meeting moved forward by a day still lands in the past. With
   * today's own Saturday, a reschedule on a Saturday run would name tomorrow.
   */
  const anchorSaturday = async (): Promise<string> => {
    const now = await today();
    const weekday = isoDayOf(now);

    return shift(now, weekday === 6 ? -7 : -((weekday + 1) % 7));
  };

  /**
   * Every day of the anchor's month falling on `weekday` that has already happened.
   *
   * Bounded by **today** rather than by the Saturday anchor, and the difference is a whole
   * meeting: with the anchor as the bound, a Sunday later in the same month than the last
   * Saturday is dropped, so "a month of DCC" quietly became a month minus one. The anchor
   * fixes which month is walked; today fixes how much of it has happened.
   */
  const monthDays = async (weekday: number): Promise<string[]> => {
    const anchor = await anchorSaturday();
    const now = await today();
    const [year, month] = anchor.split('-').map(Number);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    let day = `${prefix}-01`;
    while (isoDayOf(day) !== weekday) {
      day = shift(day, 1);
    }

    const days: string[] = [];
    while (day.startsWith(prefix)) {
      if (day <= now) {
        days.push(day);
      }
      day = shift(day, 7);
    }

    return days;
  };

  /** Every Saturday of the anchor's month that has already happened, in order. */
  const monthMeetings = async (): Promise<string[]> => monthDays(6);

  /** A Saturday whose month shut on the 7th of the month after it. */
  const closedMonthSaturday = async (): Promise<string> => {
    let day = shift(await anchorSaturday(), -63);
    while (isoDayOf(day) !== 6) {
      day = shift(day, 1);
    }

    return day;
  };

  /** Every Sunday of the anchor's month that has already happened. */
  const monthSundays = async (): Promise<string[]> => monthDays(0);

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  const submitMeeting = (date: string, body: Record<string, unknown>, as = markAccount) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${markCell.id}/meetings/${date}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const fullRoster = () => members.map((person) => ({ person_id: person.id, present: true }));

  const createEvent = async (eventDate: string): Promise<string> => {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: eventDate })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  const submitDcc = (eventId: string, records: unknown[], as = markAccount) =>
    request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${as.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ records });

  // ---------------------------------------------------------------------------

  it('records every meeting of the month, in both domains, with a move among them', async () => {
    const meetings = await monthMeetings();
    expect(meetings.length).toBeGreaterThan(0);

    // **The first meeting is recorded and then moved**, which is the order section 13
    // requires: a first submission cannot carry `RESCHEDULED`, so a meeting that had
    // already moved when it was first reported is recorded and then rescheduled.
    const moved = meetings[0];
    const movedTo = shift(moved, 1);

    await submitMeeting(moved, { status: 'HELD', attendance: fullRoster() }).expect(201);
    await submitMeeting(moved, {
      status: 'RESCHEDULED',
      version: 1,
      actual_date: movedTo,
      correction_reason: 'The venue was unavailable.',
      attendance: fullRoster(),
    }).expect(201);

    // The last meeting of the month did not happen, and says why. `NOT_HELD` is a first
    // submission rather than a transition — `HELD` to `NOT_HELD` is not one of the four.
    const notHeld = meetings.length > 1 ? meetings[meetings.length - 1] : null;
    if (notHeld !== null) {
      await submitMeeting(notHeld, {
        status: 'NOT_HELD',
        not_held_reason: 'WEATHER_OR_CALAMITY',
      }).expect(201);
    }

    // Everything between them is an ordinary week: the whole roster, one person absent.
    const ordinary = meetings.slice(1, notHeld === null ? undefined : -1);
    for (const date of ordinary) {
      await submitMeeting(date, {
        status: 'HELD',
        attendance: [
          { person_id: members[0].id, present: true },
          { person_id: members[1].id, present: false },
          { person_id: members[2].id, present: true },
        ],
      }).expect(201);
    }

    // **Every meeting the schedule derived for the month has exactly one row.** Coverage in
    // section 12 counts rows against a denominator derived from the schedule, so this is
    // the fact the coverage line is built on.
    const rows = await db
      .selectFrom('cell_meetings')
      .select(['scheduled_date', 'actual_date', 'status', 'reporting_month'])
      .where('cell_id', '=', markCell.id)
      .orderBy('scheduled_date')
      .execute();

    expect(rows.map((row) => row.scheduled_date)).toEqual(meetings);

    // The move kept its identity and its reporting month, and changed only where it
    // happened (section 13).
    const movedRow = rows.find((row) => row.scheduled_date === moved);
    expect(movedRow?.status).toBe('RESCHEDULED');
    expect(movedRow?.actual_date).toBe(movedTo);
    expect(movedRow?.reporting_month).toBe(`${moved.slice(0, 7)}-01`);

    if (notHeld !== null) {
      const notHeldRow = rows.find((row) => row.scheduled_date === notHeld);
      expect(notHeldRow?.status).toBe('NOT_HELD');
      expect(notHeldRow?.actual_date).toBeNull();
    }

    // **Every member is recorded at every meeting that took place, present or not.** This
    // is what section 20's reconciliation rests on: a roster with holes cannot make the
    // classification and monthly-attendance buckets sum to the same unique-people total.
    const held = rows.filter((row) => row.status !== 'NOT_HELD');
    for (const row of held) {
      const lines = await db
        .selectFrom('cell_attendance')
        .innerJoin('cell_meetings', 'cell_meetings.id', 'cell_attendance.cell_meeting_id')
        .select('cell_attendance.person_id')
        .where('cell_meetings.scheduled_date', '=', row.scheduled_date)
        .where('cell_meetings.cell_id', '=', markCell.id)
        .where('cell_attendance.superseded_at', 'is', null)
        .execute();

      expect(new Set(lines.map((line) => line.person_id))).toEqual(
        new Set(members.map((person) => person.id)),
      );
    }

    // A `NOT_HELD` meeting carries none, and the move closed nothing it should not have.
    if (notHeld !== null) {
      const none = await db
        .selectFrom('cell_attendance')
        .innerJoin('cell_meetings', 'cell_meetings.id', 'cell_attendance.cell_meeting_id')
        .select('cell_attendance.id')
        .where('cell_meetings.scheduled_date', '=', notHeld)
        .where('cell_attendance.superseded_at', 'is', null)
        .execute();

      expect(none).toHaveLength(0);
    }

    // ---- and a month of DCC alongside it (section 9) ----
    //
    // Mark's checklist is Timothy: section 9 makes attendance the *direct pastoral
    // leader's* obligation, so a person is never on their own list and the walk starts at
    // their leader.
    const sundays = await monthSundays();
    expect(sundays.length).toBeGreaterThan(0);

    for (const sunday of sundays) {
      const eventId = await createEvent(sunday);
      await submitDcc(eventId, [{ person_id: timothy.id, present: true, version: null }]).expect(
        201,
      );
    }

    const dcc = await db
      .selectFrom('dcc_attendance')
      .innerJoin('dcc_events', 'dcc_events.id', 'dcc_attendance.dcc_event_id')
      .select(['dcc_events.event_date', 'dcc_attendance.person_id', 'dcc_attendance.present'])
      .where('dcc_attendance.superseded_at', 'is', null)
      .orderBy('dcc_events.event_date')
      .execute();

    expect(dcc.map((row) => row.event_date)).toEqual(sundays);
    expect(dcc.every((row) => row.person_id === timothy.id && row.present)).toBe(true);
  });

  it('shuts the month, and only an Admin amendment reaches back through it', async () => {
    // Section 13: attendance for a month may be recorded or corrected until the end of the
    // 7th of the following month. After that "the month is closed", and only Admin may
    // amend it — with `records.backdate_effective_date`, a reason, and an audit entry.
    //
    // A month that has genuinely shut, rather than a simulated boundary: the service reads
    // its instant from the database and there is nothing to inject one through.
    const shut = await closedMonthSaturday();

    const refused = await submitMeeting(shut, { status: 'HELD', attendance: fullRoster() });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PERIOD_CLOSED');

    // The leader's own capability is not the thing that is missing — the window is. An
    // Admin without the flag is refused identically, so a retry arriving after the 7th
    // never rewrites a closed period by accident.
    const adminNoFlag = await submitMeeting(
      shut,
      { status: 'HELD', attendance: fullRoster() },
      admin,
    );
    expect(adminNoFlag.status).toBe(409);
    expect(adminNoFlag.body.error.code).toBe('PERIOD_CLOSED');

    const amended = await submitMeeting(
      shut,
      {
        status: 'HELD',
        attendance: fullRoster(),
        amendment: { reason: 'Paper register found after the window shut.' },
      },
      admin,
    );
    expect(amended.status).toBe(201);
    expect(amended.body.recorded).toBe(members.length);

    // Section 21 requires the amendment audited, and a first submission writes no entry of
    // its own — so without this the closed month would be rewritten with nothing logged.
    const entries = await db
      .selectFrom('audit_log')
      .select(['action', 'reason'])
      .orderBy('occurred_at')
      .execute();

    expect(
      entries.some((entry) => entry.reason === 'Paper register found after the window shut.'),
    ).toBe(true);
  });

  it('answers a stale submission a conflict, and overwrites nothing', async () => {
    // The last clause of the criterion. Section 14 makes the meeting the version unit, and
    // section 22 requires a lost writer to be told rather than silently overridden.
    const date = (await monthMeetings())[0];

    // Benigno is recorded absent, so the correction below has something to change. **A
    // submission that changes nothing does not move the version** (decision 0191: a write
    // that writes nothing owes no amendment capability), so a first draft of this case
    // resubmitted the identical roster, the meeting stayed at version 1, and the "stale"
    // writer was answered 201 — correctly, and testing nothing.
    await submitMeeting(date, {
      status: 'HELD',
      attendance: [
        { person_id: members[0].id, present: true },
        { person_id: members[1].id, present: false },
        { person_id: members[2].id, present: true },
      ],
    }).expect(201);

    // One correction lands, taking the meeting to version 2.
    const corrected = await submitMeeting(date, {
      status: 'HELD',
      version: 1,
      correction_reason: 'Benigno was there after all.',
      attendance: fullRoster(),
    });
    expect(corrected.status).toBe(201);
    expect(corrected.body.corrected).toBe(1);

    // A second writer still holding version 1 is refused, and is told what is stored.
    const stale = await submitMeeting(date, {
      status: 'HELD',
      version: 1,
      correction_reason: 'Working from an older screen.',
      attendance: members.map((person) => ({ person_id: person.id, present: false })),
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    // Nothing the stale writer sent was applied: everyone is still present.
    const lines = await db
      .selectFrom('cell_attendance')
      .innerJoin('cell_meetings', 'cell_meetings.id', 'cell_attendance.cell_meeting_id')
      .select('cell_attendance.present')
      .where('cell_meetings.scheduled_date', '=', date)
      .where('cell_attendance.superseded_at', 'is', null)
      .execute();

    expect(lines).toHaveLength(members.length);
    expect(lines.every((line) => line.present)).toBe(true);
  });
});
