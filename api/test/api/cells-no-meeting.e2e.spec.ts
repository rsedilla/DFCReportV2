import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import * as submissionWindow from '../../src/common/time/submission-window';
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
 * `GET /api/v1/cells?no_meeting=true` — section 15's *Cells with no meeting held*, built
 * as the *No meeting in 3 months* filter (decision 0355), and the `may_close` flag every
 * running row now carries.
 *
 * **The clock is fixed, and that is the point of this file.** Whether a Cell is on the
 * list depends on which months have finished and on whether each unrecorded meeting's
 * week is still open to recording (decision 0335), so a case written against the real
 * day would discriminate on some days and pass vacuously on others. `databaseNow` — the
 * one instant the route reads (decision 0160) — is held at {@link NOW}, a Wednesday in
 * August 2026, and the weekly deadline is moved to start in January 2026 through
 * `WEEKLY_DEADLINE_FROM`, as `weekly-deadline-recording.e2e.spec.ts` does. Then:
 *
 * - the window is May, June and July 2026 (`cell_attention_months` is seeded 3);
 * - every Saturday of the window is closed to recording (Saturday 25 July's week closes
 *   at noon on Monday 17 August);
 * - Thursday 30 July's week closes at noon on Monday 24 August, so it is still open.
 *
 * Every fixture's history starts at `EPOCH` (2020), so the tree is in force at NOW.
 *
 * The tree is `Raymond (root) -> Manuel -> { Mark, Nathan }`, with a Saturday Cell each for
 * Manuel, Mark and Nathan created in 2020. Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Cells with no meeting held (section 15, decision 0355)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nathan: TestPerson;

  let manuelCell: TestCell;
  let markCell: TestCell;
  let nathanCell: TestCell;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  /** Wednesday 19 August 2026, 10:00 in Manila. */
  const NOW = new Date('2026-08-19T10:00:00+08:00');
  const MONTH = '2026-08-01';
  const WINDOW = ['2026-05-01', '2026-06-01', '2026-07-01'];

  const CREATED = new Date('2020-01-04T10:00:00+08:00');

  const previousDeadlineFrom = process.env.WEEKLY_DEADLINE_FROM;
  let clock: jest.SpyInstance;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';
    clock = jest.spyOn(submissionWindow, 'databaseNow').mockResolvedValue(NOW);

    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    manuelCell = await createCell(db, { leader: manuel, dayOfWeek: 6, createdAt: CREATED });
    markCell = await createCell(db, { leader: mark, dayOfWeek: 6, createdAt: CREATED });
    nathanCell = await createCell(db, { leader: nathan, dayOfWeek: 6, createdAt: CREATED });

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    // Full view (decision 0323), explicitly: the ruling says such a leader sees their
    // whole branch on this list, read-only.
    manuelAccount = await createAccount(app, db, {
      person: manuel,
      roles: ['LEADER'],
      fullView: true,
    });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterEach(() => {
    clock.mockRestore();
    if (previousDeadlineFrom === undefined) {
      delete process.env.WEEKLY_DEADLINE_FROM;
    } else {
      process.env.WEEKLY_DEADLINE_FROM = previousDeadlineFrom;
    }
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  type QuietMonth = { month: string; did_not_meet: number; not_recorded: number };
  type Row = { id: string; no_meeting: QuietMonth[]; may_close: boolean };

  const list = (
    as: TestAccount,
    query: Record<string, string | number> = {},
  ): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: MONTH, no_meeting: 'true', ...query })
      .set('Authorization', `Bearer ${as.accessToken}`);

  const idsOf = (response: request.Response): string[] =>
    (response.body.data as Row[]).map((row) => row.id).sort();

  const rowOf = (response: request.Response, cellId: string): Row | undefined =>
    (response.body.data as Row[]).find((row) => row.id === cellId);

  /** The Monday of the ISO week a day falls in, which the schema derives and checks. */
  const mondayOf = (day: string): string => {
    const at = new Date(`${day}T00:00:00Z`);
    const isoDay = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
    at.setUTCDate(at.getUTCDate() - (isoDay - 1));
    return at.toISOString().slice(0, 10);
  };

  const record = async (
    cell: TestCell,
    leader: TestPerson,
    day: string,
    outcome:
      { status: 'HELD' } | { status: 'NOT_HELD' } | { status: 'RESCHEDULED'; actualDate: string },
  ): Promise<void> => {
    await db
      .insertInto('cell_meetings')
      .values({
        cell_id: cell.id,
        scheduled_date: day,
        scheduled_time: '19:00',
        week_starting: mondayOf(day),
        reporting_month: `${day.slice(0, 7)}-01`,
        status: outcome.status,
        not_held_reason: outcome.status === 'NOT_HELD' ? 'LEADER_UNAVAILABLE' : null,
        actual_date: outcome.status === 'RESCHEDULED' ? outcome.actualDate : null,
        actual_time: outcome.status === 'RESCHEDULED' ? '19:00' : null,
        responsible_leader_id: leader.id,
        submitted_by: admin.id,
        submitted_at: new Date(),
      })
      .execute();
  };

  /** May has five Saturdays, June and July four each. */
  const nothingRecorded: QuietMonth[] = [
    { month: '2026-05-01', did_not_meet: 0, not_recorded: 5 },
    { month: '2026-06-01', did_not_meet: 0, not_recorded: 4 },
    { month: '2026-07-01', did_not_meet: 0, not_recorded: 4 },
  ];

  // -------------------------------------------------------------------------
  // Which Cells are on it, and what each row says
  // -------------------------------------------------------------------------

  it('lists a quiet Cell with each month of the window, oldest first', async () => {
    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(response.body.no_meeting_months).toEqual(WINDOW);
    expect(idsOf(response)).toEqual([manuelCell.id, markCell.id, nathanCell.id].sort());
    expect(rowOf(response, markCell.id)?.no_meeting).toEqual(nothingRecorded);
  });

  it('leaves off a Cell with one meeting held anywhere in the window', async () => {
    await record(markCell, mark, '2026-06-13', { status: 'HELD' });

    const response = await list(admin);

    expect(idsOf(response)).toEqual([manuelCell.id, nathanCell.id].sort());
  });

  it('ignores a meeting held before the window', async () => {
    // April is not one of the last three finished months.
    await record(markCell, mark, '2026-04-25', { status: 'HELD' });

    const response = await list(admin);

    expect(rowOf(response, markCell.id)?.no_meeting).toEqual(nothingRecorded);
  });

  it('counts a meeting moved to a day that has come as met', async () => {
    // Owner, 2026-10-16: a meeting recorded `RESCHEDULED` whose actual date has come.
    await record(markCell, mark, '2026-07-25', { status: 'RESCHEDULED', actualDate: '2026-07-27' });

    expect(idsOf(await list(admin))).not.toContain(markCell.id);
  });

  it('counts a move across a month boundary for the month it reports in', async () => {
    // Section 13: one planned for 30 May and held on 2 June belongs to May. With the
    // window narrowed to June and July it falls outside, so the Cell is listed; with May
    // in the window it is met. Both directions, so the month it counts for is pinned
    // rather than merely that it counts somewhere.
    await record(markCell, mark, '2026-05-30', { status: 'RESCHEDULED', actualDate: '2026-06-02' });

    expect(idsOf(await list(admin))).not.toContain(markCell.id);

    await db
      .updateTable('settings')
      .set({ value: sql`'2'::jsonb` })
      .where('key', '=', 'cell_attention_months')
      .execute();

    const narrowed = await list(admin);
    expect(narrowed.body.no_meeting_months).toEqual(['2026-06-01', '2026-07-01']);
    expect(idsOf(narrowed)).toContain(markCell.id);
  });

  it('does not count a move to a day still to come, and lists the Cell', async () => {
    // Moved from Saturday 25 July to 20 August, which has not come at NOW: not met, and
    // not *Did not meet* or *Not recorded* either — it has a record and may yet happen.
    await record(markCell, mark, '2026-07-25', { status: 'RESCHEDULED', actualDate: '2026-08-20' });

    const response = await list(admin);
    const row = rowOf(response, markCell.id);

    expect(row).toBeDefined();
    expect(row?.no_meeting[2]).toEqual({ month: '2026-07-01', did_not_meet: 0, not_recorded: 3 });
  });

  it('counts a meeting recorded as not held under Did not meet', async () => {
    await record(markCell, mark, '2026-06-06', { status: 'NOT_HELD' });
    await record(markCell, mark, '2026-06-13', { status: 'NOT_HELD' });

    const row = rowOf(await list(admin), markCell.id);

    expect(row?.no_meeting).toEqual([
      { month: '2026-05-01', did_not_meet: 0, not_recorded: 5 },
      { month: '2026-06-01', did_not_meet: 2, not_recorded: 2 },
      { month: '2026-07-01', did_not_meet: 0, not_recorded: 4 },
    ]);
  });

  it('lists a Cell whose every meeting was recorded as not held', async () => {
    // A quiet Cell told from one nobody reports on: all Did not meet, none Not recorded.
    for (const day of ['2026-07-04', '2026-07-11', '2026-07-18', '2026-07-25']) {
      await record(markCell, mark, day, { status: 'NOT_HELD' });
    }

    const row = rowOf(await list(admin), markCell.id);

    expect(row?.no_meeting[2]).toEqual({ month: '2026-07-01', did_not_meet: 4, not_recorded: 0 });
  });

  describe('a meeting whose week is still open to recording', () => {
    let thursdayCell: TestCell;
    let tomas: TestPerson;

    beforeEach(async () => {
      // Thursdays: 30 July's week (from Monday 27 July) closes at noon on 24 August,
      // after NOW; 23 July's closed at noon on 17 August, before it.
      tomas = await createPerson(db, { firstName: 'Tomas', network: 'MENS' });
      await assignTo(db, tomas.id, manuel.id);
      thursdayCell = await createCell(db, { leader: tomas, dayOfWeek: 4, createdAt: CREATED });
    });

    it('keeps the Cell off the list while the leader still has time to record', async () => {
      expect(submissionWindow.recordClosesAt('2026-07-30').getTime()).toBeGreaterThan(
        NOW.getTime(),
      );
      expect(submissionWindow.recordClosesAt('2026-07-23').getTime()).toBeLessThan(NOW.getTime());

      expect(idsOf(await list(admin))).not.toContain(thursdayCell.id);
    });

    it('lists it once that meeting is recorded, without counting it as Not recorded', async () => {
      await record(thursdayCell, tomas, '2026-07-30', { status: 'NOT_HELD' });

      const row = rowOf(await list(admin), thursdayCell.id);

      // July 2026 has five Thursdays: 30 July is the one recorded not held.
      expect(row?.no_meeting[2]).toEqual({
        month: '2026-07-01',
        did_not_meet: 1,
        not_recorded: 4,
      });
    });

    it('lists it once the week has closed, counting that meeting as Not recorded', async () => {
      clock.mockResolvedValue(new Date('2026-08-24T12:00:00+08:00'));

      const row = rowOf(await list(admin), thursdayCell.id);

      expect(row?.no_meeting[2]).toEqual({
        month: '2026-07-01',
        did_not_meet: 0,
        not_recorded: 5,
      });
    });
  });

  it('does not list a Cell created inside the window, and lists one created the day before', async () => {
    // "Created before the first day of the window": the first instant of 1 May in Manila
    // is inside it.
    const onTheFirst = await createPerson(db, { firstName: 'Paolo', network: 'MENS' });
    await assignTo(db, onTheFirst.id, manuel.id);
    const insideCell = await createCell(db, {
      leader: onTheFirst,
      dayOfWeek: 6,
      createdAt: new Date('2026-05-01T00:00:00+08:00'),
    });

    const theDayBefore = await createPerson(db, { firstName: 'Quino', network: 'MENS' });
    await assignTo(db, theDayBefore.id, manuel.id);
    const beforeCell = await createCell(db, {
      leader: theDayBefore,
      dayOfWeek: 6,
      createdAt: new Date('2026-04-30T23:59:00+08:00'),
    });

    const ids = idsOf(await list(admin));

    expect(ids).not.toContain(insideCell.id);
    expect(ids).toContain(beforeCell.id);
  });

  it('does not list a closed Cell', async () => {
    await closeCellDirectly(db, nathanCell.id, {
      reason: 'MEMBERS_STOPPED_ATTENDING',
      at: new Date('2026-08-11T10:00:00+08:00'),
    });

    expect(idsOf(await list(admin))).toEqual([manuelCell.id, markCell.id].sort());
  });

  it('reads the window from the church-wide setting', async () => {
    // "The number in the label is the setting's" (decision 0355, point 6).
    await record(markCell, mark, '2026-05-16', { status: 'HELD' });
    expect(idsOf(await list(admin))).not.toContain(markCell.id);

    await db
      .updateTable('settings')
      .set({ value: sql`'2'::jsonb` })
      .where('key', '=', 'cell_attention_months')
      .execute();

    const response = await list(admin);
    expect(response.body.no_meeting_months).toEqual(['2026-06-01', '2026-07-01']);
    expect(rowOf(response, markCell.id)?.no_meeting).toEqual(nothingRecorded.slice(1));
  });

  // -------------------------------------------------------------------------
  // Scope, and who may close
  // -------------------------------------------------------------------------

  it('narrows to the reader’s branch', async () => {
    // Mark leads one Cell and oversees nobody.
    expect(idsOf(await list(markAccount))).toEqual([markCell.id]);
    expect(idsOf(await list(markAccount, { led_by: 'me' }))).toEqual([markCell.id]);
  });

  it('shows a Full view leader their whole branch, read-only', async () => {
    const response = await list(manuelAccount);

    expect(idsOf(response)).toEqual([manuelCell.id, markCell.id, nathanCell.id].sort());
    expect((response.body.data as Row[]).every((row) => row.may_close === false)).toBe(true);
  });

  it('tells an Admin they may close every row', async () => {
    const response = await list(admin);

    expect(response.body.data.length).toBeGreaterThan(0);
    expect((response.body.data as Row[]).every((row) => row.may_close === true)).toBe(true);
  });

  it('says may_close on the unfiltered running list too, which carries no window', async () => {
    const unfiltered = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: MONTH })
      .set('Authorization', `Bearer ${markAccount.accessToken}`);

    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body.no_meeting_months).toBeUndefined();
    expect(unfiltered.body.data[0].no_meeting).toBeUndefined();
    expect(unfiltered.body.data[0].may_close).toBe(false);

    const adminUnfiltered = await request(app.getHttpServer())
      .get('/api/v1/cells')
      .query({ month: MONTH })
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect((adminUnfiltered.body.data as Row[]).every((row) => row.may_close)).toBe(true);
  });

  it('tells a leader holding the capability only over their subtree they may not close', async () => {
    // The Leader default of `cell.manage_lifecycle` is OWN_SUBTREE (kept for handovers and
    // restarts); closing needs Whole Church, so the server answers false.
    const row = rowOf(await list(markAccount), markCell.id);

    expect(row?.may_close).toBe(false);
  });

  it('agrees with the closure route: may_close true is a closure the route accepts', async () => {
    // Two answers claimed to be equal need a case taking one to the other.
    const listed = rowOf(await list(admin), markCell.id);
    expect(listed?.may_close).toBe(true);

    clock.mockRestore();
    await request(app.getHttpServer())
      .post(`/api/v1/cells/${markCell.id}/closure`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'No meeting since April (invented).',
        members: [],
      })
      .expect(200);
  });

  it('agrees with the closure route: may_close false is a closure the route refuses', async () => {
    const listed = rowOf(await list(markAccount), markCell.id);
    expect(listed?.may_close).toBe(false);

    clock.mockRestore();
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/cells/${markCell.id}/closure`)
      .set('Authorization', `Bearer ${markAccount.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'No meeting since April (invented).',
        members: [],
      });

    expect(refused.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Paging, and what it refuses
  // -------------------------------------------------------------------------

  it('pages over the filtered list, never over the Cells it leaves out', async () => {
    // Cell IDs are issued in creation order, so manuel < mark < nathan, and Mark's Cell —
    // the middle one — is taken off the list. A page cut before filtering would come back
    // short or carry it.
    await record(markCell, mark, '2026-07-11', { status: 'HELD' });

    const first = await list(admin, { limit: 1 });
    expect(first.status).toBe(200);
    expect(idsOf(first)).toEqual([manuelCell.id]);
    expect(first.body.next_cursor).not.toBeNull();

    const second = await list(admin, { limit: 1, cursor: first.body.next_cursor });
    expect(idsOf(second)).toEqual([nathanCell.id]);
    expect(second.body.next_cursor).toBeNull();
    // The window rides on every page.
    expect(second.body.no_meeting_months).toEqual(WINDOW);
  });

  it('answers a full last page with no further cursor', async () => {
    const page = await list(admin, { limit: 3 });

    expect(page.body.data).toHaveLength(3);
    expect(page.body.next_cursor).toBeNull();
  });

  it('refuses no_meeting on the closed view', async () => {
    const response = await list(admin, { state: 'CLOSED' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.field).toBe('no_meeting');
  });

  it('refuses a no_meeting other than true', async () => {
    const response = await list(admin, { no_meeting: 'false' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
