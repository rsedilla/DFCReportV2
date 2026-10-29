import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { reportRangeGuardMonth } from '../../src/common/time/report-range';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * A scheduled Cell meeting dated when the Cell had no member is not owed, and is not
 * recorded (SKILL.md sections 12 and 13, decision 0409), pinned at the API.
 *
 * "Had a member" is the roster's own rule: a membership whose **Manila** start date is on or
 * before the meeting's date and whose end date, if any, is on or after it. A Cell's leader
 * holds no membership, so a Cell with only its leader owes nothing.
 *
 * The tree is `Raymond -> Manuel -> Mark`, with `Nestor` beside Mark under Manuel. Raymond is
 * the Men's root and a Senior Pastor; `Gemma` is the Women's. `Oscar` holds an Admin account
 * and no place in the tree. Every Cell meets on Saturdays unless a case says otherwise.
 *
 * Two fixtures, because the rule is read on two clocks. **June 2026**, fixed and past, for the
 * figures a report, the Cells list and Recording Status compute over a month; and **today**,
 * read from the database, for the recording lists and the submission, which only reach a
 * meeting whose week is still open (decision 0335). Fixture names are invented (CLAUDE.md,
 * Secrets).
 */
describe('a Cell meeting with no member is not owed (decision 0409)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let gemma: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nestor: TestPerson;
  let oscar: TestPerson;

  let admin: TestAccount;
  let pastor: TestAccount;
  let markAccount: TestAccount;

  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeAll(async () => {
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

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alcaraz',
      network: 'MENS',
    });
    await assignTo(db, raymond.id, null);
    gemma = await createPerson(db, { firstName: 'Gemma', lastName: 'Bautista', network: 'WOMENS' });
    await assignTo(db, gemma.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Cortez', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Dimalanta', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    nestor = await createPerson(db, { firstName: 'Nestor', lastName: 'Esguerra', network: 'MENS' });
    await assignTo(db, nestor.id, manuel.id);
    oscar = await createPerson(db, { firstName: 'Oscar', lastName: 'Fajardo', network: 'MENS' });

    nameSeniorPastors(app, [raymond.id, gemma.id]);
    pastor = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    await createAccount(app, db, { person: gemma, roles: ['SENIOR_PASTOR'], seniorPastorSlot: 2 });
    admin = await createAccount(app, db, { person: oscar, roles: ['ADMIN'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'], fullView: true });
  });

  /** A member of the Cell from `from` until `until`, if given, as the instants written. */
  async function member(
    cell: TestCell,
    firstName: string,
    from: Date,
    until: Date | null = null,
  ): Promise<TestPerson> {
    const person = await createPerson(db, {
      firstName,
      lastName: `Memberfixture${randomUUID().slice(0, 6)}`,
      network: 'MENS',
    });
    await assignTo(db, person.id, cell.leaderId);
    await db
      .insertInto('cell_memberships')
      .values({ cell_id: cell.id, person_id: person.id, started_at: from, ended_at: until })
      .execute();

    return person;
  }

  /** A record made before decision 0409, written directly: the state the ruling keeps. */
  async function recordDirectly(
    cell: TestCell,
    date: string,
    leaderId: string,
    attendees: TestPerson[] = [],
  ): Promise<string> {
    const row = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, responsible_leader_id, submitted_by, submitted_at
      )
      VALUES (
        ${cell.id}::uuid, ${date}::date, '19:00'::time,
        ${date}::date - ((EXTRACT(ISODOW FROM ${date}::date)::integer) - 1),
        date_trunc('month', ${date}::date)::date,
        'HELD'::cell_meeting_status, ${leaderId}::uuid, ${admin.id}::uuid, now()
      )
      RETURNING id
    `.execute(db);
    const id = row.rows[0].id;

    for (const person of attendees) {
      await db
        .insertInto('cell_attendance')
        .values({ cell_meeting_id: id, person_id: person.id, present: true, recorded_by: admin.id })
        .execute();
    }

    return id;
  }

  const get = (path: string, as: TestAccount, query: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  // ---------------------------------------------------------------------------
  // A fixed past month: June 2026, whose Saturdays are the 6th, 13th, 20th and 27th.
  // ---------------------------------------------------------------------------

  describe('the figures over a month (section 12)', () => {
    const JUNE = '2026-06-01';
    const CREATED = new Date('2026-05-01T10:00:00+08:00');

    /** Mark's Cell: its one member joins on the 13th, at 00:30 Manila — the 12th in UTC. */
    let joined: TestCell;
    /** Manuel's Cell: its one member leaves on the 13th, at 01:00 Manila — the 12th in UTC. */
    let leftOnTheDay: TestCell;
    /** Nestor's Cell: its one member leaves on the 12th, at 23:00 Manila. */
    let leftTheDayBefore: TestCell;
    let ana: TestPerson;

    beforeEach(async () => {
      // Recording Status counts who recorded rather than when (as its own suite does).
      process.env.WEEKLY_DEADLINE_FROM = '2100-01-04';

      joined = await createCell(db, { leader: mark, createdAt: CREATED });
      leftOnTheDay = await createCell(db, { leader: manuel, createdAt: CREATED });
      leftTheDayBefore = await createCell(db, { leader: nestor, createdAt: CREATED });

      ana = await member(joined, 'Ana', new Date('2026-06-13T00:30:00+08:00'));
      await member(leftOnTheDay, 'Benito', CREATED, new Date('2026-06-13T01:00:00+08:00'));
      await member(leftTheDayBefore, 'Carlo', CREATED, new Date('2026-06-12T23:00:00+08:00'));

      // The 13th, attended by Ana: owed and recorded.
      await recordDirectly(joined, '2026-06-13', mark.id, [ana]);
      // The 6th, recorded before the ruling while the Cell had nobody (decision 0409, point 3).
      await recordDirectly(joined, '2026-06-06', mark.id);
    });

    const monthly = (query: Record<string, string>) =>
      get('reports/cells/monthly', admin, { period: JUNE, ...query });

    it('owes, per Cell, only the dates the Cell had a member, by the Manila date', async () => {
      // `joined` owes the 13th, 20th and 27th: a member joining ON the meeting day makes it
      // owed. `leftOnTheDay` owes the 6th and 13th: an end on the meeting's Manila day still
      // covers it, though the instant is the 12th in UTC. `leftTheDayBefore` owes the 6th
      // alone. The record on `joined`'s 6th matches no owed meeting, so it is in neither term.
      const expected: [TestCell, { recorded: number; scheduled: number }][] = [
        [joined, { recorded: 1, scheduled: 3 }],
        [leftOnTheDay, { recorded: 0, scheduled: 2 }],
        [leftTheDayBefore, { recorded: 0, scheduled: 1 }],
      ];

      for (const [cell, coverage] of expected) {
        const response = await monthly({ scope: 'CELL', cell_id: cell.id });
        expect(response.status).toBe(200);
        expect(response.body.coverage).toEqual(coverage);
      }
    });

    it('carries the same rule at LEADER and WHOLE_CHURCH scope', async () => {
      const markOwn = await monthly({ scope: 'LEADER', leader_id: mark.id });
      const manuelOwn = await monthly({ scope: 'LEADER', leader_id: manuel.id });
      const church = await monthly({ scope: 'WHOLE_CHURCH' });

      expect(markOwn.status).toBe(200);
      expect(markOwn.body.coverage).toEqual({ recorded: 1, scheduled: 3 });
      expect(manuelOwn.body.coverage).toEqual({ recorded: 1, scheduled: 6 });
      expect(church.body.coverage).toEqual({ recorded: 1, scheduled: 6 });
    });

    it('owes nothing for a Cell holding only its leader', async () => {
      const alone = await createCell(db, { leader: nestor, createdAt: CREATED });

      const response = await monthly({ scope: 'CELL', cell_id: alone.id });

      expect(response.status).toBe(200);
      expect(response.body.coverage).toEqual({ recorded: 0, scheduled: 0 });
      // And it moves no aggregate.
      const church = await monthly({ scope: 'WHOLE_CHURCH' });
      expect(church.body.coverage).toEqual({ recorded: 1, scheduled: 6 });
    });

    it('carries the rule on the by-leader rows, which still add up to the monthly line', async () => {
      const response = await get('reports/cells/monthly/by-leader', admin, {
        period: JUNE,
        scope: 'WHOLE_CHURCH',
        limit: '200',
      });

      expect(response.status).toBe(200);
      const rows = response.body.data as { leader: { id: string }; filed: number; owed: number }[];
      const others = (response.body.others as { filed: number; owed: number } | null) ?? {
        filed: 0,
        owed: 0,
      };
      const summed = rows.reduce(
        (sum, row) => ({ filed: sum.filed + row.filed, owed: sum.owed + row.owed }),
        others,
      );

      expect(summed).toEqual({ filed: 1, owed: 6 });
      expect(response.body.total).toEqual({ filed: 1, owed: 6 });
    });

    it('carries the rule on the Cells list, whose numerator counts the record on its own', async () => {
      const response = await get('cells', admin, { month: JUNE });

      expect(response.status).toBe(200);
      const coverageOf = (cell: TestCell) =>
        (
          response.body.data as {
            id: string;
            coverage: { recorded: number; scheduled: number; behind: number };
          }[]
        ).find((row) => row.id === cell.id)?.coverage;

      // The record on the 6th counts in `joined`'s numerator although its meeting is not
      // owed (decision 0409, point 3). Every week of June has closed, so nothing is behind
      // (decision 0335); behind is pinned on today's weeks below.
      expect(coverageOf(joined)).toEqual({ recorded: 2, scheduled: 3, behind: 0 });
      expect(coverageOf(leftOnTheDay)).toEqual({ recorded: 0, scheduled: 2, behind: 0 });
      expect(coverageOf(leftTheDayBefore)).toEqual({ recorded: 0, scheduled: 1, behind: 0 });
    });

    it('lists every scheduled date on the Cell’s meetings, saying which had a member', async () => {
      const response = await get(`cells/${joined.id}/meetings`, admin, { month: JUNE });

      expect(response.status).toBe(200);
      const entries = response.body.meetings as {
        scheduled_date: string;
        had_a_member: boolean;
        meeting: unknown;
      }[];
      expect(entries.map((entry) => [entry.scheduled_date, entry.had_a_member])).toEqual([
        ['2026-06-06', false],
        ['2026-06-13', true],
        ['2026-06-20', true],
        ['2026-06-27', true],
      ]);
      // The record made on the 6th is still shown as it was.
      expect(entries[0].meeting).not.toBeNull();

      const ended = await get(`cells/${leftTheDayBefore.id}/meetings`, admin, { month: JUNE });
      expect(
        (ended.body.meetings as { had_a_member: boolean }[]).map((entry) => entry.had_a_member),
      ).toEqual([true, false, false, false]);
    });

    it('says on the roster whether the Cell had a member that day', async () => {
      const before = await get(`cells/${joined.id}/meetings/2026-06-06/roster`, admin);
      const on = await get(`cells/${joined.id}/meetings/2026-06-13/roster`, admin);

      expect(before.status).toBe(200);
      expect(before.body.had_a_member).toBe(false);
      expect(before.body.members).toEqual([]);
      expect(on.status).toBe(200);
      expect(on.body.had_a_member).toBe(true);
      expect((on.body.members as { person_id: string }[]).map((m) => m.person_id)).toEqual([
        ana.id,
      ]);
    });

    it('carries the rule on Recording Status, week by week', async () => {
      const status = (start: string) =>
        get('reports/recording-status', pastor, {
          kind: 'WEEK',
          start,
          period: reportRangeGuardMonth(
            'WEEK',
            start,
            new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
          ),
        });

      // The week of the 6th: Manuel's and Nestor's Cells had a member, Mark's had none, so
      // two leaders owe, and Mark's record on that day does not make him one who recorded.
      const first = await status('2026-06-01');
      expect(first.status).toBe(200);
      expect(first.body.whole_church.cell).toMatchObject({ recorded: 0, owed: 2 });

      // The week of the 20th: only Mark's Cell still had a member.
      const third = await status('2026-06-15');
      expect(third.status).toBe(200);
      expect(third.body.whole_church.cell).toMatchObject({ recorded: 0, owed: 1 });
    });

    it('reconciles: classification and monthly-attendance buckets sum to unique people (section 20)', async () => {
      const response = await monthly({ scope: 'CELL', cell_id: joined.id });

      expect(response.status).toBe(200);
      const body = response.body as {
        unique_people: number;
        classification: Record<string, number>;
        buckets: { times: number; people: number }[];
      };
      const classified = Object.values(body.classification).reduce((sum, n) => sum + n, 0);
      const bucketed = body.buckets.reduce((sum, bucket) => sum + bucket.people, 0);

      expect(body.unique_people).toBe(1);
      expect(classified).toBe(body.unique_people);
      expect(bucketed).toBe(body.unique_people);

      const church = await monthly({ scope: 'WHOLE_CHURCH' });
      const churchClassified = Object.values(
        church.body.classification as Record<string, number>,
      ).reduce((sum, n) => sum + n, 0);
      expect(churchClassified).toBe(church.body.unique_people);
      expect(church.body.unique_people).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Today, read from the database: every Cell meets on today's weekday, so it is
  // scheduled today (whose day has begun) and a week before.
  // ---------------------------------------------------------------------------

  describe('recording, while the week is open (sections 13 and 19)', () => {
    let today: string;
    let weekBefore: string;

    /** Cells that have met on today's weekday for a year. */
    let joinedToday: TestCell;
    let alwaysHadOne: TestCell;
    let neverHadOne: TestCell;
    let dario: TestPerson;

    beforeEach(async () => {
      process.env.WEEKLY_DEADLINE_FROM = '2026-01-05';

      today = (
        await sql<{ today: string }>`
          SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
        `.execute(db)
      ).rows[0].today;
      weekBefore = shift(today, -7);
      const yearAgo = new Date(`${shift(today, -365)}T02:00:00Z`);
      const dayOfWeek = isoWeekday(today);

      joinedToday = await createCell(db, { leader: mark, dayOfWeek, createdAt: yearAgo });
      alwaysHadOne = await createCell(db, { leader: mark, dayOfWeek, createdAt: yearAgo });
      neverHadOne = await createCell(db, { leader: mark, dayOfWeek, createdAt: yearAgo });

      // The start of today, Manila: a member joining ON the meeting day makes it owed.
      dario = await member(joinedToday, 'Dario', new Date(`${today}T00:00:00+08:00`));
      await member(alwaysHadOne, 'Emilio', yearAgo);
    });

    const shift = (day: string, days: number): string => {
      const [y, m, d] = day.split('-').map(Number);

      return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
    };

    const isoWeekday = (day: string): number => {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

      return weekday === 0 ? 7 : weekday;
    };

    /** Today and the later days of its month falling on the same weekday. */
    const sameWeekdayThroughMonthEnd = (day: string): number => {
      let count = 0;
      for (let next = day; next.slice(0, 7) === day.slice(0, 7); next = shift(next, 7)) {
        count += 1;
      }

      return count;
    };

    const submit = (cell: TestCell, date: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/v1/cells/${cell.id}/meetings/${date}/submit`)
        .set('Authorization', `Bearer ${markAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const meetingsOf = (cell: TestCell) =>
      db.selectFrom('cell_meetings').selectAll().where('cell_id', '=', cell.id).execute();

    it('leaves a meeting before the first member joined off Pending CG Records', async () => {
      const response = await get('cells/meetings/pending', markAccount);

      expect(response.status).toBe(200);
      const rows = response.body.data as {
        cell: { id: string };
        meetings: { scheduled_date: string }[];
      }[];
      const datesOf = (cell: TestCell) =>
        rows.find((row) => row.cell.id === cell.id)?.meetings.map((m) => m.scheduled_date);

      // The control owes both, so both weeks are open and the list reaches them.
      expect(datesOf(alwaysHadOne)).toEqual(expect.arrayContaining([weekBefore, today]));
      expect(datesOf(joinedToday)).toEqual([today]);
      // A Cell that has never had a member owes nothing, so it has no row at all.
      expect(datesOf(neverHadOne)).toBeUndefined();
    });

    it('leaves a meeting before the first member joined out of the recording queue', async () => {
      const datesFor = async (cell: TestCell, month: string): Promise<string[]> => {
        const response = await get('cells/meetings/awaiting', markAccount, { month });
        expect(response.status).toBe(200);

        return (response.body.meetings as { cell_id: string; scheduled_date: string }[])
          .filter((m) => m.cell_id === cell.id)
          .map((m) => m.scheduled_date);
      };
      const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

      expect(await datesFor(alwaysHadOne, monthOf(weekBefore))).toContain(weekBefore);
      expect(await datesFor(joinedToday, monthOf(weekBefore))).not.toContain(weekBefore);
      expect(await datesFor(joinedToday, monthOf(today))).toContain(today);
      expect(await datesFor(neverHadOne, monthOf(today))).toEqual([]);
      expect(await datesFor(neverHadOne, monthOf(weekBefore))).toEqual([]);
    });

    it('counts only the owed meetings on the Cells list and the Branch screen', async () => {
      const month = `${today.slice(0, 7)}-01`;
      const list = await get('cells', admin, { month });
      expect(list.status).toBe(200);
      const rows = list.body.data as {
        id: string;
        coverage: { recorded: number; scheduled: number; behind: number };
      }[];
      const coverageOf = (cell: TestCell) => rows.find((row) => row.id === cell.id)?.coverage;

      expect(coverageOf(neverHadOne)).toEqual({ recorded: 0, scheduled: 0, behind: 0 });
      // Joined today: it owes today and the month's later dates on its weekday, and only
      // today has begun, so one is behind. The control owes the earlier dates as well.
      const fromToday = sameWeekdayThroughMonthEnd(today);
      expect(coverageOf(joinedToday)).toEqual({ recorded: 0, scheduled: fromToday, behind: 1 });
      expect(coverageOf(alwaysHadOne)?.scheduled).toBe(
        fromToday + Math.floor((Number(today.slice(8, 10)) - 1) / 7),
      );

      // The Branch screen counts the same owed meetings: adding a member from long ago to
      // the Cell that never had one moves it by exactly what the control owes.
      const before = await get(`leaders/${manuel.id}/cell-figures`, admin);
      expect(before.status).toBe(200);
      await member(neverHadOne, 'Fidel', new Date(`${shift(today, -365)}T02:00:00Z`));
      const after = await get(`leaders/${manuel.id}/cell-figures`, admin);
      expect(after.body.branch_meetings_behind - before.body.branch_meetings_behind).toBe(
        coverageOf(alwaysHadOne)?.behind,
      );
    });

    it('refuses a first submission on a date the Cell had no member, and writes nothing', async () => {
      const notHeld = await submit(joinedToday, weekBefore, {
        status: 'NOT_HELD',
        not_held_reason: 'LEADER_UNAVAILABLE',
      });
      // A HELD body has nobody it could name: with no roster at all, and with a person who
      // joins later, the refusal is this rule's rather than the roster's.
      const held = await submit(joinedToday, weekBefore, { status: 'HELD' });
      const heldNaming = await submit(joinedToday, weekBefore, {
        status: 'HELD',
        attendance: [{ person_id: dario.id, present: true }],
      });
      const never = await submit(neverHadOne, today, {
        status: 'NOT_HELD',
        not_held_reason: 'WEATHER_OR_CALAMITY',
      });
      // An empty roster is refused at the edge before the rule is reached (ArrayNotEmpty):
      // still refused, as VALIDATION_FAILED.
      const heldEmpty = await submit(joinedToday, weekBefore, { status: 'HELD', attendance: [] });
      expect(heldEmpty.status).toBe(422);
      expect(heldEmpty.body.error.code).toBe('VALIDATION_FAILED');

      for (const response of [notHeld, held, heldNaming, never]) {
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
        expect(response.body.error.message).toContain('No member was in this Cell');
      }
      expect(await meetingsOf(joinedToday)).toHaveLength(0);
      expect(await meetingsOf(neverHadOne)).toHaveLength(0);
      expect(await db.selectFrom('cell_meeting_changes').select('id').execute()).toHaveLength(0);
    });

    it('admits a first submission from the day the member joined', async () => {
      const response = await submit(joinedToday, today, {
        status: 'NOT_HELD',
        not_held_reason: 'LEADER_UNAVAILABLE',
      });

      expect(response.status).toBe(201);
      expect(await meetingsOf(joinedToday)).toHaveLength(1);
    });

    it('corrects a record already made on such a date, and counts it in neither Reports term', async () => {
      await recordDirectly(neverHadOne, today, mark.id);

      const corrected = await submit(neverHadOne, today, {
        status: 'NOT_HELD',
        version: 1,
        not_held_reason: 'WEATHER_OR_CALAMITY',
        correction_reason: 'It did not meet after all',
      });

      expect(corrected.status).toBe(201);
      expect(corrected.body.status).toBe('NOT_HELD');
      const [row] = await meetingsOf(neverHadOne);
      expect(row.status).toBe('NOT_HELD');

      const month = `${today.slice(0, 7)}-01`;
      const report = await get('reports/cells/monthly', admin, {
        period: month,
        scope: 'CELL',
        cell_id: neverHadOne.id,
      });
      expect(report.status).toBe(200);
      expect(report.body.coverage).toEqual({ recorded: 0, scheduled: 0 });

      const list = await get('cells', admin, { month });
      const coverage = (
        list.body.data as { id: string; coverage: { recorded: number; scheduled: number } }[]
      ).find((entry) => entry.id === neverHadOne.id)?.coverage;
      expect(coverage).toMatchObject({ recorded: 1, scheduled: 0 });
    });
  });
});
