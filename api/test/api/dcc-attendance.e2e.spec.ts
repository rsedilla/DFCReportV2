import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { databaseNow } from '../../src/attendance/submission-window';
import { manilaDayOf, startOfManilaDay } from '../../src/common/time/manila';
import { countWhileInFlight, track } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * DCC recording (SKILL.md sections 9 and 14; decisions 0171 and 0172).
 *
 * **Dates are computed from the database's own day rather than written down**, for
 * the reason `dcc-calendar.e2e.spec.ts` gives: the service reads its instant from
 * the database and there is no seam to inject one, so a case pinned to a literal
 * Sunday would be true this year and false next. Every case here asserts a
 * relationship — this Sunday has passed, that month has closed — and computes the
 * dates it needs.
 *
 * `recentSunday()` is the load-bearing one: the most recent Sunday on or before
 * today is always inside an **open** month. For a day of the month past the 7th it
 * falls in the current month, because the first seven days of any month contain a
 * Sunday; and for a day on or before the 7th it may fall in the previous month,
 * whose window has not shut yet — it shuts at the end of the 7th (decision 0170).
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('DCC recording (sections 9 and 14)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Raymond (root) -> Manuel -> { Mark -> Timothy, Nathan -> Paul -> Quentin }
  //
  // Manuel, Mark and Raymond hold accounts; Timothy, Nathan, Paul and Quentin do
  // not. So Manuel's checklist is Mark, Nathan, Paul and Quentin: it stops at Mark,
  // who is his own submitter, and passes through two levels of account-less chain
  // below Nathan — which is the half of section 9's rule a reader building the
  // first clause plus one level would miss (decision 0172).
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let timothy: TestPerson;
  let nathan: TestPerson;
  let paul: TestPerson;
  let quentin: TestPerson;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    timothy = await createPerson(db, { firstName: 'Timothy', network: 'MENS' });
    await assignTo(db, timothy.id, mark.id);

    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    paul = await createPerson(db, { firstName: 'Paul', network: 'MENS' });
    await assignTo(db, paul.id, nathan.id);

    quentin = await createPerson(db, { firstName: 'Quentin', network: 'MENS' });
    await assignTo(db, quentin.id, paul.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Dates, all computed from the database's day
  // ---------------------------------------------------------------------------

  /**
   * The Manila day **the database** is in.
   *
   * Read from the database rather than from this process, because that is what the
   * service compares against (decision 0160, and `submission-window.ts`). Taking it
   * from the host would put the test and the code it exercises on two clocks, which
   * is the failure `fixtures.ts` states the rule about — reached here through a
   * boundary rather than through a period.
   */
  const today = async (): Promise<string> => manilaDayOf(await databaseNow(db));

  /** `YYYY-MM-DD` shifted by whole days, on plain calendar arithmetic. */
  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + days));

    return at.toISOString().slice(0, 10);
  };

  const isoDayOf = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);

    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  /**
   * The most recent Sunday **strictly before** today. Always inside an open month,
   * and always a day that has ended.
   *
   * Open: for today on the 8th or later the Sunday falls in the current month, since
   * `today - 7` is at least the 1st; for today on the 7th or earlier it may fall in
   * the previous month, whose window shuts at the end of the 7th (decision 0170).
   *
   * **Strictly before, and that is load-bearing rather than tidy.** Two cases move a
   * pastoral assignment to the day after the event and assert the record does not
   * follow it. With today's own Sunday they would place that move in the *future*,
   * where a service reading the tree at `now` — the defect they exist to catch —
   * would answer correctly anyway. They passed against that mutant until this was
   * narrowed, on every day of the week except Sunday.
   */
  const recentSunday = async (): Promise<string> => {
    const now = await today();
    const dayOfWeek = isoDayOf(now);

    return shift(now, dayOfWeek === 0 ? -7 : -dayOfWeek);
  };

  const nextSunday = async (): Promise<string> => shift(await recentSunday(), 7);

  /** A Sunday two months back, whose window shut on the 7th of the month after it. */
  const closedMonthSunday = async (): Promise<string> => {
    let day = shift(await recentSunday(), -63);
    while (isoDayOf(day) !== 0) {
      day = shift(day, 1);
    }

    return day;
  };

  const createEvent = async (
    eventDate: string,
    removal?: { reason: string; by: string },
  ): Promise<string> => {
    const row = await db
      .insertInto('dcc_events')
      .values({
        event_date: eventDate,
        removed_at: removal ? new Date() : null,
        removed_by: removal?.by ?? null,
        removal_reason: removal?.reason ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  // ---------------------------------------------------------------------------
  // Requests
  // ---------------------------------------------------------------------------

  const roster = (account: TestAccount, eventId: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/dcc/events/${eventId}/roster${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  interface Line {
    person_id: string;
    present: boolean;
    version: number | null;
    correction_reason?: string;
  }

  const submit = (
    account: TestAccount,
    eventId: string,
    records: Line[],
    key: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/dcc/events/${eventId}/submit`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ records });

  const liveRows = (eventId: string) =>
    db
      .selectFrom('dcc_attendance')
      .selectAll()
      .where('dcc_event_id', '=', eventId)
      .where('superseded_at', 'is', null)
      .execute();

  // ---------------------------------------------------------------------------
  // The checklist (section 9; decision 0172)
  // ---------------------------------------------------------------------------

  describe('the checklist', () => {
    it('is the people whose submitter the actor is, through account-less leaders', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await roster(manuelAccount, eventId).expect(200);
      const ids = (response.body.data as { person_id: string }[]).map((line) => line.person_id);

      // Mark and Nathan are Manuel's direct children. Paul and Quentin are below
      // Nathan, who holds no account, so their submitter walks up through him to
      // Manuel — and Quentin is two levels down, which is the case the one-level
      // reading of section 9 drops.
      expect(new Set(ids)).toEqual(new Set([mark.id, nathan.id, paul.id, quentin.id]));
    });

    it('stops at a downline leader who holds an account', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await roster(manuelAccount, eventId).expect(200);
      const ids = (response.body.data as { person_id: string }[]).map((line) => line.person_id);

      // Section 9: "where a leader with an account sits between them and the leader
      // without one, the obligation is the nearer leader's, and showing it to both
      // leaves each assuming the other will submit." Timothy is Mark's, and Mark can
      // sign in.
      expect(ids).not.toContain(timothy.id);

      const marks = await roster(markAccount, eventId).expect(200);
      expect((marks.body.data as { person_id: string }[]).map((line) => line.person_id)).toEqual([
        timothy.id,
      ]);
    });

    it('drops the covered branch the moment its leader is given an account', async () => {
      // The rule above run as a mutation, in the direction the domain actually moves.
      // Section 9: "The arrangement is intended to be temporary. When that leader
      // takes a Cell, their account becomes provisionable and, once provisioned, they
      // become their own submitter and the covering load falls away."
      //
      // Provisioning rather than removing an account, because nothing removes one:
      // `account_roles` and `accounts` both refuse a delete (principle 12).
      const before = await roster(manuelAccount, await createEvent(await recentSunday()));
      expect((before.body.data as { person_id: string }[]).map((line) => line.person_id)).toEqual(
        expect.arrayContaining([paul.id, quentin.id]),
      );

      await createAccount(app, db, { person: nathan, roles: ['LEADER'] });

      const eventId = await createEvent(shift(await recentSunday(), -7));
      const after = await roster(manuelAccount, eventId).expect(200);
      const ids = (after.body.data as { person_id: string }[]).map((line) => line.person_id);

      // Nathan stays -- he is Manuel's own direct child -- and his branch leaves.
      expect(ids).toContain(nathan.id);
      expect(ids).not.toContain(paul.id);
      expect(ids).not.toContain(quentin.id);
    });

    it('puts the Network roots on a Whole Church holder and on nobody else', async () => {
      const eventId = await createEvent(await recentSunday());

      // Section 9 says Admin records a root's attendance and says nothing about how
      // Admin reaches them; decision 0172 rests it on the Whole Church grant rather
      // than on the role, because a Senior Pastor is a root too.
      const forAdmin = await roster(admin, eventId).expect(200);
      const adminIds = (forAdmin.body.data as { person_id: string }[]).map(
        (line) => line.person_id,
      );
      expect(adminIds).toContain(raymond.id);

      const forManuel = await roster(manuelAccount, eventId).expect(200);
      const manuelIds = (forManuel.body.data as { person_id: string }[]).map(
        (line) => line.person_id,
      );
      expect(manuelIds).not.toContain(raymond.id);
    });

    it('leaves an archived Person off it', async () => {
      await db
        .updateTable('person_lifecycle')
        .set({ state: 'ARCHIVED', reason: 'NO_LONGER_IN_CURRENT_NETWORK' })
        .where('person_id', '=', quentin.id)
        .where('ended_at', 'is', null)
        .execute();

      const eventId = await createEvent(await recentSunday());
      const response = await roster(manuelAccount, eventId).expect(200);
      const ids = (response.body.data as { person_id: string }[]).map((line) => line.person_id);

      expect(ids).not.toContain(quentin.id);
      expect(ids).toContain(paul.id);
    });

    it('reads the tree as of the event date, not as of now', async () => {
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);

      // Quentin moves from Paul to Mark the day after the event. Both ends of the
      // period come from one clock — fixed constants here — which is the rule
      // `fixtures.ts` states per period rather than per call site.
      const movedAt = startOfManilaDay(shift(sunday, 1));

      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: movedAt })
        .where('person_id', '=', quentin.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, quentin.id, mark.id, movedAt);

      // Section 9: "If a person moves from one leader to another in November,
      // October's DCC records remain with whoever was responsible in October."
      // Quentin is still Manuel's for this event, and not yet Mark's.
      const forManuel = await roster(manuelAccount, eventId).expect(200);
      const line = (
        forManuel.body.data as { person_id: string; responsible_leader_id: string }[]
      ).find((row) => row.person_id === quentin.id);

      expect(line).toBeDefined();
      expect(line?.responsible_leader_id).toBe(paul.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination (section 22; decision 0174)
  // ---------------------------------------------------------------------------

  describe('the roster as a collection', () => {
    it('orders by (last name, first name, Member ID) and pages with a cursor', async () => {
      const eventId = await createEvent(await recentSunday());

      // Manuel's checklist is Mark, Nathan, Paul and Quentin. Distinct surnames so the
      // order is decided by the first key rather than by the tie-break.
      const surnames = new Map([
        [mark.id, 'Delacruz'],
        [nathan.id, 'Bautista'],
        [paul.id, 'Aquino'],
        [quentin.id, 'Castillo'],
      ]);

      for (const [personId, lastName] of surnames) {
        await db
          .updateTable('persons')
          .set({ last_name: lastName })
          .where('id', '=', personId)
          .execute();
      }

      const first = await roster(manuelAccount, eventId, '?limit=2').expect(200);
      const firstIds = (first.body.data as { person_id: string }[]).map((line) => line.person_id);

      expect(firstIds).toEqual([paul.id, nathan.id]);
      expect(first.body.next_cursor).toBeTruthy();

      const second = await roster(
        manuelAccount,
        eventId,
        `?limit=2&cursor=${encodeURIComponent(String(first.body.next_cursor))}`,
      ).expect(200);
      const secondIds = (second.body.data as { person_id: string }[]).map((line) => line.person_id);

      // The page after, with nothing repeated and nothing skipped.
      expect(secondIds).toEqual([quentin.id, mark.id]);
      expect(second.body.next_cursor).toBeNull();
    });

    it('refuses a cursor it cannot resolve rather than starting again', async () => {
      const eventId = await createEvent(await recentSunday());

      // Section 22, and the ruling of 2026-08-31: "A client sends a cursor because it
      // already holds a page; handed the first page again with a `200`, it appends what
      // it already has and cannot tell that from a collection that grew."
      const response = await roster(manuelAccount, eventId, '?cursor=bm90LWEtY3Vyc29y').expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('cursor');
    });

    it('refuses a limit above the maximum', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await roster(manuelAccount, eventId, '?limit=500').expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // ---------------------------------------------------------------------------
  // The event, and when it takes a record
  // ---------------------------------------------------------------------------

  describe('an event that takes no record', () => {
    it('answers the roster with a reason rather than refusing it, and refuses the write', async () => {
      const admin_ = admin;
      const eventId = await createEvent(await recentSunday(), {
        reason: 'Absorbed into the regional conference.',
        by: admin_.id,
      });

      // Section 9 requires a removal to be visible rather than hidden, so the read
      // succeeds and says why.
      const response = await roster(manuelAccount, eventId).expect(200);
      expect(response.body.event.recordable).toBe(false);
      expect(response.body.event.not_recordable_reason).toBe('REMOVED');
      expect(response.body.event.removal_reason).toBe('Absorbed into the regional conference.');

      const refused = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(409);

      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await liveRows(eventId)).toHaveLength(0);
    });

    it('refuses an event whose Manila day has not begun', async () => {
      // Ruling of 2026-08-31. The window refuses none of these on its own: a future
      // month's window is open until the 7th of the month after it, so a record
      // against a future Sunday would advance a classification in a month nobody has
      // reported.
      const eventId = await createEvent(await nextSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/has not taken place/i);

      const read = await roster(manuelAccount, eventId).expect(200);
      expect(read.body.event.not_recordable_reason).toBe('NOT_YET_HELD');
    });

    it('answers PERIOD_CLOSED once the month has shut', async () => {
      const eventId = await createEvent(await closedMonthSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(409);

      // Section 22 gives a closed period its own code: the record is not wrong, the
      // month is shut, and only Admin may amend it.
      expect(response.body.error.code).toBe('PERIOD_CLOSED');
      expect(await liveRows(eventId)).toHaveLength(0);
    });

    it('answers NOT_FOUND for an event the calendar does not hold', async () => {
      const response = await roster(manuelAccount, randomUUID()).expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  describe('a first submission', () => {
    it('writes one row per person, at version 1, with the responsible leader frozen', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
        { person_id: nathan.id, present: false, version: null },
        { person_id: paul.id, present: true, version: null },
      ]).expect(201);

      expect(response.body.created).toBe(3);
      expect(response.body.corrected).toBe(0);
      expect(response.body.unchanged).toBe(0);

      const rows = await liveRows(eventId);
      expect(rows).toHaveLength(3);

      const byPerson = new Map(rows.map((row) => [row.person_id, row]));
      expect(byPerson.get(mark.id)?.present).toBe(true);
      expect(byPerson.get(nathan.id)?.present).toBe(false);
      expect(byPerson.get(mark.id)?.version).toBe(1);

      // Section 9: the responsible leader is the person's **direct** pastoral
      // leader, never the actor who happened to submit.
      expect(byPerson.get(mark.id)?.responsible_leader_id).toBe(manuel.id);
      expect(byPerson.get(paul.id)?.responsible_leader_id).toBe(nathan.id);
      expect(byPerson.get(mark.id)?.recorded_by).toBe(manuelAccount.id);
    });

    it('records a Network root with no responsible leader', async () => {
      const eventId = await createEvent(await recentSunday());

      await submit(admin, eventId, [
        { person_id: raymond.id, present: true, version: null },
      ]).expect(201);

      const rows = await liveRows(eventId);
      const root = rows.find((row) => row.person_id === raymond.id);

      // Section 9: a root "has no pastoral leader and therefore no responsible
      // leader", and the column is nullable for exactly this case.
      expect(root?.responsible_leader_id).toBeNull();
    });

    it('refuses a Person with no pastoral assignment on the event date', async () => {
      const orphan = await createPerson(db, { firstName: 'Orlando', network: 'MENS' });
      const eventId = await createEvent(await recentSunday());

      const response = await submit(admin, eventId, [
        { person_id: orphan.id, present: true, version: null },
      ]).expect(409);

      // Section 9: "A Person with no open assignment row cannot have DCC attendance
      // recorded, because there is no responsible leader to record it against."
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await liveRows(eventId)).toHaveLength(0);
    });

    it('refuses an archived Person', async () => {
      await db
        .updateTable('person_lifecycle')
        .set({ state: 'ARCHIVED', reason: 'NO_LONGER_IN_CURRENT_NETWORK' })
        .where('person_id', '=', nathan.id)
        .where('ended_at', 'is', null)
        .execute();

      const eventId = await createEvent(await recentSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: nathan.id, present: true, version: null },
      ]).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses one person named twice', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
        { person_id: mark.id, present: false, version: null },
      ]).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await liveRows(eventId)).toHaveLength(0);
    });

    it('records the person whose leader was assigned on the event day itself', async () => {
      // Section 9's VIP workflow: the Person is created "including the pastoral
      // leader they are being placed under" and their attendance is recorded in one
      // sitting, at the service. Resolving the leader at the **start** of the event's
      // day would refuse this, which is why the instant is clamped to now (0171).
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);

      // **During the service, not at midnight**, which is the whole of the case. An
      // assignment starting at 00:00 is in force at the start of the day too, so a
      // fixture using midnight passes against the start-of-day reading this exists to
      // refuse — it did, until the mutation was actually run.
      const duringTheService = new Date(startOfManilaDay(sunday).getTime() + 10 * 60 * 60 * 1000);

      const visitor = await createPerson(db, {
        firstName: 'Vicente',
        network: 'MENS',
        startedAt: duringTheService,
      });
      await assignTo(db, visitor.id, manuel.id, duringTheService);

      await submit(manuelAccount, eventId, [
        { person_id: visitor.id, present: true, version: null },
      ]).expect(201);

      const rows = await liveRows(eventId);
      expect(rows.find((row) => row.person_id === visitor.id)?.responsible_leader_id).toBe(
        manuel.id,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Corrections and versions (section 14)
  // ---------------------------------------------------------------------------

  describe('a correction', () => {
    const recordOnce = async (): Promise<string> => {
      const eventId = await createEvent(await recentSunday());
      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      return eventId;
    };

    it('supersedes rather than overwriting, and preserves the responsible leader', async () => {
      const eventId = await recordOnce();

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: false, version: 1, correction_reason: 'Marked in error.' },
      ]).expect(201);

      expect(response.body.corrected).toBe(1);

      const all = await db
        .selectFrom('dcc_attendance')
        .selectAll()
        .where('dcc_event_id', '=', eventId)
        .execute();

      expect(all).toHaveLength(2);

      const superseded = all.find((row) => row.superseded_at !== null);
      const live = all.find((row) => row.superseded_at === null);

      // Section 9: "A correction never overwrites. The prior row is marked superseded
      // and a new row written." `superseded_by` holds the replacing row, not an actor.
      expect(superseded?.present).toBe(true);
      expect(superseded?.superseded_by).toBe(live?.id);
      expect(live?.present).toBe(false);
      expect(live?.version).toBe(2);
      expect(live?.correction_reason).toBe('Marked in error.');

      // Section 14 lists the responsible leader among what a correction preserves,
      // so it is carried rather than resolved again.
      expect(live?.responsible_leader_id).toBe(manuel.id);
    });

    it('keeps the responsible leader when a reassignment is backdated behind the event', async () => {
      // **The case that makes the freeze visible, and the reason it took two
      // attempts.** A reassignment dated *after* the event cannot catch a defect
      // here: the responsible leader is re-resolved at the event's own instant, so a
      // later move gives the same answer either way, and a test built on one passes
      // against the mutant. What discriminates is a move backdated behind the event
      // -- which section 5 permits an Admin to do -- because the row in force at the
      // event instant then genuinely differs from what was frozen.
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);

      await submit(manuelAccount, eventId, [
        { person_id: quentin.id, present: true, version: null },
      ]).expect(201);

      const backdatedTo = startOfManilaDay(shift(sunday, -2));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: backdatedTo })
        .where('person_id', '=', quentin.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, quentin.id, manuel.id, backdatedTo);

      await submit(manuelAccount, eventId, [
        { person_id: quentin.id, present: false, version: 1, correction_reason: 'Miscounted.' },
      ]).expect(201);

      const live = await liveRows(eventId);

      // Section 9: "A later reassignment never moves historical records." Section 14
      // lists the responsible leader among what a correction preserves. Re-resolving
      // would answer Manuel and move a recorded attendance between leaders' totals
      // inside a month that may already have closed.
      expect(live).toHaveLength(1);
      expect(live[0].version).toBe(2);
      expect(live[0].responsible_leader_id).toBe(paul.id);
    });

    it('leaves an unchanged value alone rather than superseding it', async () => {
      const eventId = await recordOnce();

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: 1 },
      ]).expect(201);

      expect(response.body.unchanged).toBe(1);
      expect(response.body.corrected).toBe(0);

      const all = await db
        .selectFrom('dcc_attendance')
        .selectAll()
        .where('dcc_event_id', '=', eventId)
        .execute();

      // Superseding a row to write the same fact records that nothing happened, and
      // moves a version every other client then has to resolve against.
      expect(all).toHaveLength(1);
      expect(all[0].version).toBe(1);
    });

    it('conflicts on a stale version, carrying both values, both actors and both timestamps', async () => {
      const eventId = await recordOnce();

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: false, version: 1 },
      ]).expect(201);

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: 1 },
      ]).expect(409);

      const { code, details } = response.body.error;

      expect(code).toBe('VERSION_CONFLICT');
      expect(details.submitted_version).toBe(1);
      expect(details.current_version).toBe(2);

      // Section 22: a conflict omitting any of these "cannot satisfy Section 14,
      // because the person resolving it cannot tell which record to keep".
      expect(details.submitted.present).toBe(true);
      expect(details.current.present).toBe(false);
      expect(details.submitted.actor.name).toBeTruthy();
      expect(details.current.actor.name).toBeTruthy();
      expect(details.submitted.recorded_at).toBeTruthy();
      expect(details.current.recorded_at).toBeTruthy();
    });

    it('conflicts with a null submitted version where a record arrived meanwhile', async () => {
      const eventId = await recordOnce();

      // The client read a roster with no record for Mark and submitted against that.
      // Section 22 names this as one of the two cases carrying a null
      // `submitted_version` — the DCC one, added on 2026-08-31.
      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: false, version: null },
      ]).expect(409);

      expect(response.body.error.code).toBe('VERSION_CONFLICT');
      expect(response.body.error.details.submitted_version).toBeNull();
      expect(response.body.error.details.current_version).toBe(1);
    });

    it('refuses a version sent for a person with no record', async () => {
      const eventId = await createEvent(await recentSunday());

      // Section 22: "a refusal with no second value to show is not one, whatever went
      // stale" — so this is not a VERSION_CONFLICT.
      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: 4 },
      ]).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses a correction reason on a line that creates a record', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null, correction_reason: 'No subject.' },
      ]).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('applies none of a submission that conflicts on one line, and names the first', async () => {
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: nathan.id, present: true, version: null },
      ]).expect(201);

      // Section 14: "It applies none of them and names the first." Mark is fine and
      // Nathan is stale; Mark must not be written.
      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
        { person_id: nathan.id, present: false, version: 7 },
      ]).expect(409);

      expect(response.body.error.code).toBe('VERSION_CONFLICT');

      const rows = await liveRows(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].person_id).toBe(nathan.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization (section 7)
  // ---------------------------------------------------------------------------

  describe('who may record', () => {
    it('lets an upline record on behalf, and audits it', async () => {
      const eventId = await createEvent(await recentSunday());

      // Timothy is Mark's, not Manuel's, but he is inside Manuel's subtree — which is
      // what section 14's on-behalf rule reaches.
      await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: true, version: null },
      ]).expect(201);

      const rows = await liveRows(eventId);
      const row = rows.find((each) => each.person_id === timothy.id);

      // The responsible leader stays Mark; the actor is recorded separately
      // (section 9, An upline leader may record on behalf).
      expect(row?.responsible_leader_id).toBe(mark.id);
      expect(row?.recorded_by).toBe(manuelAccount.id);

      const entries = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'dcc_attendance.submitted_on_behalf')
        .execute();

      // Section 21 lists "Attendance submission on behalf" as auditable, and the
      // target is the Person so that section 7 can resolve who may read it.
      expect(entries).toHaveLength(1);
      expect(entries[0].target_id).toBe(timothy.id);
      expect(entries[0].actor_id).toBe(manuelAccount.id);
    });

    it('writes no audit entry for a leader recording their own checklist', async () => {
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      // Section 21 lists submission on behalf and corrections, and no ordinary first
      // submission: the record is the entry, and it carries its own actor.
      const entries = await db.selectFrom('audit_log').selectAll().execute();
      expect(entries).toHaveLength(0);
    });

    it('audits a correction', async () => {
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);
      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: false, version: 1, correction_reason: 'Miscounted.' },
      ]).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'dcc_attendance.corrected')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].target_id).toBe(mark.id);
      expect(entries[0].reason).toBe('Miscounted.');
      expect(entries[0].before).toEqual({ present: true, version: 1 });
    });

    it('refuses on behalf without dcc.submit_on_behalf, though the person is in scope', async () => {
      const eventId = await createEvent(await recentSunday());

      // Timothy is inside Manuel's subtree, so `dcc.take_attendance` covers him --
      // but Manuel is not his submitter, and section 14 makes reporting for somebody
      // else's obligation its own capability. Without it the write is refused even
      // though the person is squarely in scope.
      await db
        .updateTable('account_roles')
        // `now()`, not a host `Date`: `granted_at` comes from the database default,
        // and `account_roles_period_ordered` compares the two. Taking the ends of one
        // period from two clocks is what `fixtures.ts` states the rule about, and it
        // fails only when the elapsed time is short — which here it is.
        .set({ revoked_at: sql<Date>`now()` })
        .where('account_id', '=', manuelAccount.id)
        .execute();

      await db
        .insertInto('capability_grants')
        .values({
          account_id: manuelAccount.id,
          capability: 'dcc.take_attendance',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      // Manuel's own checklist still records, which is what makes the refusal about
      // the on-behalf capability rather than about scope.
      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      const response = await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: true, version: null },
      ]).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('dcc.submit_on_behalf');
    });

    it('refuses somebody outside the actor’s subtree', async () => {
      const stranger = await createPerson(db, { firstName: 'Salome', network: 'WOMENS' });
      await assignTo(db, stranger.id, null);

      const eventId = await createEvent(await recentSunday());

      const response = await submit(manuelAccount, eventId, [
        { person_id: stranger.id, present: true, version: null },
      ]).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses a correction to somebody the actor may record but not correct', async () => {
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      // Section 7 keeps `dcc.correct_subtree` separate from `take_attendance`, "which
      // guards the first submission". With the correcting grant withdrawn the first
      // submission still succeeded and the amendment does not.
      await db
        .updateTable('account_roles')
        // `now()`, not a host `Date`: `granted_at` comes from the database default,
        // and `account_roles_period_ordered` compares the two. Taking the ends of one
        // period from two clocks is what `fixtures.ts` states the rule about, and it
        // fails only when the elapsed time is short — which here it is.
        .set({ revoked_at: sql<Date>`now()` })
        .where('account_id', '=', manuelAccount.id)
        .execute();

      await db
        .insertInto('capability_grants')
        .values([
          {
            account_id: manuelAccount.id,
            capability: 'dcc.take_attendance',
            scope_type: 'OWN_SUBTREE',
            read_only: false,
            reason: 'Invented for this case (CLAUDE.md, Secrets).',
            granted_by: admin.id,
          },
        ])
        .execute();

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: false, version: 1 },
      ]).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('dcc.correct_subtree');
    });
  });

  // ---------------------------------------------------------------------------
  // The race two first submissions run (section 22, Write conflicts)
  // ---------------------------------------------------------------------------

  describe('two first submissions for one person', () => {
    it('answers the loser a conflict with a null submitted version, not a 500', async () => {
      // `docs/ROADMAP.md` makes this Stage 4's "Done when": "a concurrent double
      // submission produces a conflict for a person to resolve rather than a silent
      // overwrite". Section 22 names the mechanism — neither writer holds a version,
      // so the loser meets `dcc_attendance_one_live` rather than a stale version, and
      // "a uniqueness violation left to surface on its own is an `INTERNAL_ERROR` on
      // an ordinary race".
      //
      // **Provoked deterministically rather than by firing two requests and hoping.**
      // A holder opens a transaction, writes the row and does not commit; the request
      // then reads no record, sends a null version, and blocks on the index. The
      // interleaving is forced by the lock, so the case is the same on every run.
      const eventId = await createEvent(await recentSunday());

      const holder = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query(
          `INSERT INTO dcc_attendance
             (dcc_event_id, person_id, present, responsible_leader_id, recorded_by, version)
           VALUES ($1, $2, true, $3, $4, 1)`,
          [eventId, mark.id, manuel.id, admin.id],
        );

        const attempt = submit(manuelAccount, eventId, [
          { person_id: mark.id, present: false, version: null },
        ]);
        const inFlight = track(attempt);

        // Bounded by the attempt rather than by a wall clock measured from dispatch,
        // which is the rule `test/setup/concurrency.ts` exists to state.
        const waiters = await countWhileInFlight(
          async () => {
            const { rows } = await holder.query<{ count: string }>(
              `SELECT count(*) AS count FROM pg_locks
                WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
            );

            return Number(rows[0].count);
          },
          inFlight,
          'the submission to block on dcc_attendance_one_live',
        );

        expect(waiters).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('VERSION_CONFLICT');
        expect(response.body.error.details.submitted_version).toBeNull();
        expect(response.body.error.details.current_version).toBe(1);

        // Both sides, which is what section 14 requires a person to choose between.
        expect(response.body.error.details.submitted.present).toBe(false);
        expect(response.body.error.details.current.present).toBe(true);

        // The loser wrote nothing: the winner's row stands alone.
        const rows = await liveRows(eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0].recorded_by).toBe(admin.id);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('answers a conflict when a correction loses the race under the row lock', async () => {
      // The other half, and the interleaving is the classic lost update. Both writers
      // read version 1 and both pass the version check; the loser's supersede then
      // matches no row, because the winner has already closed it.
      //
      // It answers `VERSION_CONFLICT` rather than `RESOURCE_BUSY`: the identical body
      // resubmitted cannot succeed, since its version is now stale, which is the
      // question decision 0158 places a refusal by.
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      const stored = (await liveRows(eventId))[0];
      const successorId = randomUUID();

      const holder = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await holder.connect();

      try {
        // A correction written by hand, in the order the deferred `superseded_by`
        // foreign key permits: close the predecessor, then write its replacement.
        await holder.query('BEGIN');
        await holder.query(
          'UPDATE dcc_attendance SET superseded_at = now(), superseded_by = $2 WHERE id = $1',
          [stored.id, successorId],
        );
        await holder.query(
          `INSERT INTO dcc_attendance
             (id, dcc_event_id, person_id, present, responsible_leader_id, recorded_by, version)
           VALUES ($1, $2, $3, false, $4, $5, 2)`,
          [successorId, eventId, mark.id, manuel.id, admin.id],
        );

        // Dispatched while the holder is uncommitted, so it reads version 1 and its
        // version check passes -- then blocks on the row the holder has locked.
        const attempt = submit(manuelAccount, eventId, [
          { person_id: mark.id, present: false, version: 1 },
        ]);
        const inFlight = track(attempt);

        const waiters = await countWhileInFlight(
          async () => {
            const { rows } = await holder.query<{ count: string }>(
              `SELECT count(*) AS count FROM pg_locks
                WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
            );

            return Number(rows[0].count);
          },
          inFlight,
          'the correction to block on the stored row',
        );

        expect(waiters).toBeGreaterThan(0);

        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('VERSION_CONFLICT');
        expect(response.body.error.details.submitted_version).toBe(1);
        expect(response.body.error.details.current_version).toBe(2);

        // The loser wrote nothing, and the winner's row is the only live one.
        const rows = await liveRows(eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(successorId);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency (section 22; CLAUDE.md, Write endpoints)
  // ---------------------------------------------------------------------------

  describe('idempotency', () => {
    it('replays exactly what it returned, and writes once', async () => {
      const eventId = await createEvent(await recentSunday());
      const key = randomUUID();

      const first = await submit(
        manuelAccount,
        eventId,
        [{ person_id: mark.id, present: true, version: null }],
        key,
      ).expect(201);

      const repeat = await submit(
        manuelAccount,
        eventId,
        [{ person_id: mark.id, present: true, version: null }],
        key,
      );

      expect(repeat.status).toBe(first.status);
      expect(repeat.body).toEqual(first.body);

      const all = await db
        .selectFrom('dcc_attendance')
        .selectAll()
        .where('dcc_event_id', '=', eventId)
        .execute();

      expect(all).toHaveLength(1);
    });

    it('records its completion inside the transaction that writes', async () => {
      const eventId = await createEvent(await recentSunday());
      const key = randomUUID();

      const response = await submit(
        manuelAccount,
        eventId,
        [{ person_id: mark.id, present: true, version: null }],
        key,
      ).expect(201);

      const stored = await db
        .selectFrom('idempotency_keys')
        .selectAll()
        .where('key', '=', key)
        .executeTakeFirstOrThrow();

      // What is recorded is what is returned (section 22): a replay reproduces what
      // was stored, so a divergence would hand two identical requests two answers.
      expect(stored.response_status).toBe(201);
      expect(stored.response_body).toEqual(response.body);
    });

    it('writes no attendance when the submission is refused', async () => {
      // Deliberately not a claim about the key. Section 22 **does** store a 4xx
      // against it and replay it for the retention, which is the point of splitting
      // on the status — so a case named for the key not being written would assert
      // the opposite of the rule.
      const eventId = await createEvent(await recentSunday());
      const key = randomUUID();

      await submit(
        manuelAccount,
        eventId,
        [{ person_id: mark.id, present: true, version: 9 }],
        key,
      ).expect(409);

      const rows = await db
        .selectFrom('dcc_attendance')
        .selectAll()
        .where('dcc_event_id', '=', eventId)
        .execute();

      expect(rows).toHaveLength(0);
    });
  });
});
