import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { databaseNow } from '../../src/common/time/submission-window';
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

    it('records into a closed month with the amendment flag and the capability', async () => {
      // Section 9, decision 0182: "One shape across both domains, because an amendment is
      // a submission with a different precondition and nothing else." The flag skips the
      // window check and nothing else — every per-line rule below still runs.
      const eventId = await createEvent(await closedMonthSunday());

      const response = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${eventId}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [{ person_id: mark.id, present: true, version: null }],
          amendment: { reason: 'Register reconciled after the window shut.' },
        });

      expect(response.status).toBe(201);
      expect(response.body.created).toBe(1);
      expect(await liveRows(eventId)).toHaveLength(1);

      // One entry for the submission rather than one per line, carrying the reason.
      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'reason'])
        .where('action', '=', 'dcc_attendance.amended')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Register reconciled after the window shut.');
    });

    it('targets each recorded person, not the amender', async () => {
      // **Section 7 resolves an audit entry's scope through its target**, and
      // `dcc_attendance`'s existing twins target the *subject* (decision 0189). A first
      // version wrote one entry against `actor.personId`: it resolved into the amender's
      // own upline scope and out of the scope of the leaders whose people's closed-month
      // figures had moved — readable by the wrong population, and inverted from the Cell
      // twin, which is readable by a scope that reaches the Cell.
      //
      // One entry per person, because a DCC submission may name people belonging to many
      // different leaders and a single entry resolves through one target only. Section 14
      // already makes the person the unit in this domain and the meeting the unit in the
      // other, so the granularity follows a seam that was settled.
      const eventId = await createEvent(await closedMonthSunday());

      const response = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${eventId}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [
            { person_id: mark.id, present: true, version: null },
            { person_id: timothy.id, present: false, version: null },
          ],
          amendment: { reason: 'Two people reconciled after the window shut.' },
        });

      expect(response.status).toBe(201);

      const targets = (
        await db
          .selectFrom('audit_log')
          .select('target_id')
          .where('action', '=', 'dcc_attendance.amended')
          .execute()
      ).map((row) => row.target_id);

      expect(targets).toHaveLength(2);
      expect(targets).toEqual(expect.arrayContaining([mark.id, timothy.id]));
      // The amender is Adele, and naming her would put the entry in her upline's scope.
      expect(targets).not.toContain(admin.personId);
    });

    it('does not let the amendment flag reach a removed or not-yet-held event', async () => {
      // **"An amendment widens *when*, never *what*"** (section 9, decision 0182), and
      // the whole of that enforcement is a branch order: the flag is conjoined with
      // `MONTH_CLOSED`, so every other reason falls through to the ordinary refusal.
      // Swapping those two arms, or widening the first condition, silently hands Admin
      // the power to record against a Sunday that was removed or has not begun — and
      // nothing reddened. A rule with nothing that can fail on it is what decision 0142
      // is about, and this one sits on the boundary the flag was added at.
      // `removed_by` references `accounts`, not `persons`.
      const removed = await createEvent(await recentSunday(), {
        reason: 'Absorbed into the regional conference.',
        by: admin.id,
      });
      const future = await createEvent(await nextSunday());

      const amend = (eventId: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/dcc/events/${eventId}/submit`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            records: [{ person_id: mark.id, present: true, version: null }],
            amendment: { reason: 'The flag must not reach this.' },
          });

      const onRemoved = await amend(removed);
      expect(onRemoved.status).toBe(409);
      expect(onRemoved.body.error.code).not.toBe('PERIOD_CLOSED');

      const onFuture = await amend(future);
      expect(onFuture.status).toBe(409);
      expect(onFuture.body.error.code).not.toBe('PERIOD_CLOSED');

      expect(await liveRows(removed)).toHaveLength(0);
      expect(await liveRows(future)).toHaveLength(0);
    });

    it('writes no entry for a line the amendment did not change', async () => {
      // Section 9: "an unchanged line is not an amendment". Section 21 asks for one entry
      // per action performed. Iterating every *named* line wrote one for the unchanged
      // ones too, so resubmitting an identical body told that person's leader their
      // frozen figure had moved — once per resubmission.
      const eventId = await createEvent(await closedMonthSunday());

      const send = (reason: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/dcc/events/${eventId}/submit`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', randomUUID())
          .send({
            records: [{ person_id: mark.id, present: true, version: null }],
            amendment: { reason },
          });

      await send('Creates the record.').expect(201);

      const again = await send('Changes nothing at all.');

      expect(again.status).toBe(201);
      expect(again.body.unchanged).toBe(1);

      const entries = await db
        .selectFrom('audit_log')
        .select('reason')
        .where('action', '=', 'dcc_attendance.amended')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].reason).toBe('Creates the record.');
    });

    it('treats an explicit null amendment as absent, in both directions', async () => {
      // `@IsOptional()` passes an explicit null through and skips the remaining
      // decorators, so `!== undefined` was true of it: a closed month dereferenced null
      // and answered 500 on a well-formed body, and an open month refused an ordinary
      // submission that amends nothing.
      const closed = await createEvent(await closedMonthSunday());

      const onClosed = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${closed}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [{ person_id: mark.id, present: true, version: null }],
          amendment: null,
        });

      expect(onClosed.status).toBe(409);
      expect(onClosed.body.error.code).toBe('PERIOD_CLOSED');

      const open = await createEvent(await recentSunday());

      const onOpen = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${open}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [{ person_id: mark.id, present: true, version: null }],
          amendment: null,
        });

      expect(onOpen.status).toBe(201);
    });

    it('refuses the amendment flag from an actor without the backdate capability', async () => {
      // Required *in addition to* `dcc.take_attendance`, never in place of it — Manuel
      // may record these people and may not reach past a closed window.
      const eventId = await createEvent(await closedMonthSunday());

      const response = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${eventId}/submit`)
        .set('Authorization', `Bearer ${manuelAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [{ person_id: mark.id, present: true, version: null }],
          amendment: { reason: 'Trying to reach past the window.' },
        });

      expect(response.status).toBe(403);
      expect(response.body.error.details.capability).toBe('records.backdate_effective_date');
      expect(await liveRows(eventId)).toHaveLength(0);
    });

    it('refuses the amendment flag on a month that is still open', async () => {
      const eventId = await createEvent(await recentSunday());

      const response = await request(app.getHttpServer())
        .post(`/api/v1/dcc/events/${eventId}/submit`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          records: [{ person_id: mark.id, present: true, version: null }],
          amendment: { reason: 'Nothing to amend.' },
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
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
      // sitting, at the service.
      //
      // **What makes this pass is that the instant is taken at the end of the event's
      // day**, not that it is clamped to now — an earlier comment here credited the
      // clamp, which is the opposite direction and would refuse this fixture if the
      // event were today. The clamp's own branch is unreachable from this file and is
      // pinned in `test/unit/recording-instant.spec.ts`.
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

      // **The chain does not overlap itself, asserted in SQL.**
      //
      // Comparing two JavaScript `Date`s here cannot fail: node-postgres renders
      // `timestamptz` with millisecond precision, so a predecessor ending at
      // `…883142+08` and a successor beginning at `…883+08` both arrive as `883` and
      // the assertion reads `883 >= 883`. That is exactly how the first attempt at this
      // rule shipped — the successor really began 142µs before its predecessor ended,
      // and this case passed. The comparison has to happen where the microseconds are.
      // **Compared as booleans, not as rendered text.** An earlier version asserted the
      // gap rendered as `'00:00:00'`, which is the zero interval under
      // `IntervalStyle = postgres` and `0` under `sql_standard` — so the case turned on
      // a session setting the pool does not pin (it pins `DateStyle` alone, decision
      // 0156). This is the third rendering-dependent comparison on this project; a
      // boolean has no rendering.
      const chain = await sql<{ overlaps: boolean; contiguous: boolean }>`
        SELECT successor.recorded_at < predecessor.superseded_at AS overlaps,
               successor.recorded_at = predecessor.superseded_at AS contiguous
          FROM dcc_attendance predecessor
          JOIN dcc_attendance successor ON successor.id = predecessor.superseded_by
         WHERE predecessor.dcc_event_id = ${eventId}
      `.execute(db);

      expect(chain.rows).toHaveLength(1);
      expect(chain.rows[0].overlaps).toBe(false);

      // Exactly contiguous rather than merely non-overlapping: the successor begins at
      // the instant the predecessor ended, because it is read from that row in SQL.
      expect(chain.rows[0].contiguous).toBe(true);
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

    it('does not conflict on a stale version where the value already agrees', async () => {
      // A covering upline holds a stale roster and submits what is already stored. The
      // line writes nothing, so there is nothing to overwrite — and a conflict here
      // would carry two identical values, which section 22 says cannot satisfy section
      // 14: "both values… so that a person can choose between them".
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      const response = await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      expect(response.body.unchanged).toBe(1);
      expect(response.body.corrected).toBe(0);

      const rows = await liveRows(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].version).toBe(1);
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

      // Manuel is Mark's own leader, so this correction is not on behalf.
      expect((entries[0].after as { on_behalf: boolean }).on_behalf).toBe(false);
    });

    it('marks a correction made on somebody else’s behalf', async () => {
      // Section 21 lists both actions, and an upline correcting a downline's record
      // performs one of them — a correction — for somebody else. Carried on that entry
      // rather than written as a second: a reader filtering
      // `dcc_attendance.submitted_on_behalf` for what an upline did to other people's
      // records would otherwise miss every correction.
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: true, version: null },
      ]).expect(201);
      await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: false, version: 1 },
      ]).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'dcc_attendance.corrected')
        .execute();

      expect(entries).toHaveLength(1);
      expect((entries[0].after as { on_behalf: boolean }).on_behalf).toBe(true);
      expect((entries[0].after as { responsible_leader_id: string }).responsible_leader_id).toBe(
        mark.id,
      );
    });

    it('answers one refusal for somebody out of scope, whatever is stored', async () => {
      // **Section 8 withholds "DCC attendance, DCC history, or DCC classification" for
      // a person outside the viewer's pastoral scope**, and section 8 publishes every
      // Person's identifier church-wide — so there is a space to sweep.
      //
      // An earlier version chose the refusal's capability from the line's outcome,
      // which is derived from the stored `present` value. Two requests then read the
      // record out of the refusal: `dcc.correct_subtree` back meant a record exists and
      // disagrees, `dcc.take_attendance` meant there is none. This asserts the refusal
      // is the same either way.
      const eventId = await createEvent(await recentSunday());

      const stranger = await createPerson(db, { firstName: 'Salome', network: 'WOMENS' });
      await assignTo(db, stranger.id, null);

      // Admin records the stranger, so a record exists and says `true`.
      await submit(admin, eventId, [
        { person_id: stranger.id, present: true, version: null },
      ]).expect(201);

      // Manuel has no scope over her. The two probes differ only in the value they
      // send, which is what would make one a correction and the other unchanged.
      const disagreeing = await submit(manuelAccount, eventId, [
        { person_id: stranger.id, present: false, version: null },
      ]).expect(403);
      const agreeing = await submit(manuelAccount, eventId, [
        { person_id: stranger.id, present: true, version: null },
      ]).expect(403);

      expect(disagreeing.body.error.code).toBe('SCOPE_DENIED');
      expect(agreeing.body.error.code).toBe('SCOPE_DENIED');
      expect(disagreeing.body.error.details.capability).toBe('dcc.take_attendance');
      expect(agreeing.body.error.details.capability).toBe(
        disagreeing.body.error.details.capability,
      );
      expect(agreeing.body.error.message).toBe(disagreeing.body.error.message);
    });

    it('discloses no lifecycle or pastoral state for somebody out of scope', async () => {
      // The same oracle one step over. `assertRecordable` names archival, the surviving
      // record of a merge, and whether the person had a pastoral leader on the date —
      // none of which is among the five fields section 8 publishes church-wide. It runs
      // after the scope check, so an out-of-scope actor never reaches it.
      const eventId = await createEvent(await recentSunday());

      const archivedStranger = await createPerson(db, {
        firstName: 'Soledad',
        network: 'WOMENS',
        archived: true,
      });
      await assignTo(db, archivedStranger.id, null);

      const unplaced = await createPerson(db, { firstName: 'Serafina', network: 'WOMENS' });

      for (const personId of [archivedStranger.id, unplaced.id]) {
        const response = await submit(manuelAccount, eventId, [
          { person_id: personId, present: true, version: null },
        ]).expect(403);

        // A scope refusal, not "this person is archived" and not "this person has no
        // pastoral leader" — either of which would answer 409 and disclose the state.
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(JSON.stringify(response.body)).not.toMatch(/archiv|merged|pastoral leader/i);
      }
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

    it('names the frozen responsible leader on a correction, not the current one', async () => {
      // **The case the first on-behalf test cannot make.** That one moves no
      // assignment, so the frozen and the re-resolved leader are the same value and it
      // passes against an entry built from either.
      //
      // Section 9 freezes the responsible leader and section 14 lists it among what a
      // correction preserves, so the entry must name what the row names. Built from a
      // re-resolved assignment it named the current leader and got `on_behalf`
      // backwards in both directions.
      const sunday = await recentSunday();
      const eventId = await createEvent(sunday);

      await submit(manuelAccount, eventId, [
        { person_id: quentin.id, present: true, version: null },
      ]).expect(201);

      // Backdated behind the event, which section 5 permits an Admin to do. Quentin's
      // record stays Paul's; the assignment in force at the event instant is now
      // Manuel's.
      const backdatedTo = startOfManilaDay(shift(sunday, -2));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: backdatedTo })
        .where('person_id', '=', quentin.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, quentin.id, manuel.id, backdatedTo);

      await submit(manuelAccount, eventId, [
        { person_id: quentin.id, present: false, version: 1 },
      ]).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'dcc_attendance.corrected')
        .execute();

      expect(entries).toHaveLength(1);

      const after = entries[0].after as { responsible_leader_id: string; on_behalf: boolean };

      // Paul, whom the row names — not Manuel, whom the assignment now resolves to.
      expect(after.responsible_leader_id).toBe(paul.id);

      // And Manuel is therefore correcting somebody else's record, which is what the
      // re-resolved value would have denied.
      expect(after.on_behalf).toBe(true);

      const live = await liveRows(eventId);
      expect(live[0].responsible_leader_id).toBe(paul.id);
    });

    it('answers the same refusal for an off-checklist person whatever is stored', async () => {
      // **The residual oracle inside `assertMayRecord`.** `dcc.submit_on_behalf`
      // depends on nothing stored; the `dcc.correct_subtree` branch is reached exactly
      // when a record exists *and disagrees with the value sent*. Checked in that order,
      // two probes read the stored value out of the refusal for anyone the actor may
      // reach — the oracle `assertInScope` closes one level up, left behind inside this
      // method by the batch that closed it.
      const eventId = await createEvent(await recentSunday());

      // Timothy is in Manuel's subtree — so `dcc.take_attendance` covers him — but he
      // is Mark's to record, and Manuel holds neither of the other two capabilities.
      await submit(admin, eventId, [
        { person_id: timothy.id, present: true, version: null },
      ]).expect(201);

      await db
        .updateTable('account_roles')
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

      const disagreeing = await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: false, version: 1 },
      ]).expect(403);
      const agreeing = await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: true, version: 1 },
      ]).expect(403);

      // One capability, one message, whatever is stored.
      expect(disagreeing.body.error.details.capability).toBe('dcc.submit_on_behalf');
      expect(agreeing.body.error.details.capability).toBe('dcc.submit_on_behalf');
      expect(agreeing.body.error.message).toBe(disagreeing.body.error.message);
    });

    it('answers the same refusal whether or not the person has a record at all', async () => {
      // **The other half of that oracle, and it sat one refusal further forward**
      // (section 7, decision 0193). `assertMayRecord` was reached only after a `CREATE`
      // carrying a `correction_reason` had already been refused as having nothing to
      // correct — and that refusal fires exactly when no live record exists. So the same
      // actor, sending the same body, learned whether a record existed: `409` where it
      // did not and `403` where it did.
      //
      // Two people rather than two events, deliberately: a second event a week earlier
      // can fall in a month whose window shut on the 7th, which would refuse for an
      // unrelated reason and pin nothing.
      const eventId = await createEvent(await recentSunday());

      // Silas is Mark's to record, exactly as Timothy is — inside Manuel's subtree and
      // off his checklist — and has no record for this event.
      const silas = await createPerson(db, { firstName: 'Silas', network: 'MENS' });
      await assignTo(db, silas.id, mark.id);

      await submit(admin, eventId, [
        { person_id: timothy.id, present: true, version: null },
      ]).expect(201);

      await db
        .updateTable('account_roles')
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

      const correcting = { correction_reason: 'Checked with the leader afterwards.' };

      // Identical bodies but for the person: one has a stored record, one has none.
      const hasRecord = await submit(manuelAccount, eventId, [
        { person_id: timothy.id, present: true, version: null, ...correcting },
      ]).expect(403);
      const hasNone = await submit(manuelAccount, eventId, [
        { person_id: silas.id, present: true, version: null, ...correcting },
      ]).expect(403);

      // One capability, one message, whatever exists.
      expect(hasRecord.body.error.details.capability).toBe('dcc.submit_on_behalf');
      expect(hasNone.body.error.details.capability).toBe('dcc.submit_on_behalf');
      expect(hasNone.body.error.message).toBe(hasRecord.body.error.message);
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

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
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

    it('answers RESOURCE_BUSY when the winner recorded what the loser was carrying', async () => {
      // The third outcome, and the one that was a 500 until it was found. The loser
      // loses the race on `dcc_attendance_one_live`, and by the time it re-reads, the
      // committed state already says what it was going to write — so the line is
      // unchanged, takes no part in the version check, and there is no conflict to
      // present.
      //
      // Decision 0158's question settles it: could this same body, resubmitted
      // unchanged, succeed? It could — the retry finds the line unchanged and answers
      // 201 — so nothing was decided about the body, which is what `RESOURCE_BUSY`
      // means, and a 5xx releases the key the retry needs.
      const eventId = await createEvent(await recentSunday());

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query(
          `INSERT INTO dcc_attendance
             (dcc_event_id, person_id, present, responsible_leader_id, recorded_by, version)
           VALUES ($1, $2, true, $3, $4, 1)`,
          [eventId, mark.id, manuel.id, admin.id],
        );

        // The same value the holder is writing, so once the holder commits there is
        // nothing to disagree about.
        //
        // The key is held, because the retry below has to present **this** one: the
        // refusal says "retry with the same key", and decision 0158's question — could
        // this same body, resubmitted unchanged, succeed? — is the whole basis for a
        // 503 rather than a 409. A retry under a fresh key with a different body tests
        // neither.
        const key = randomUUID();
        const attempt = submit(
          manuelAccount,
          eventId,
          [{ person_id: mark.id, present: true, version: null }],
          key,
        );
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
          'the submission to block on dcc_attendance_one_live',
        );

        expect(waiters).toBeGreaterThan(0);
        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        // **The same key and the same body**, which is what the refusal advises and
        // what a 5xx makes possible: section 22 releases the claim on a 5xx rather than
        // storing it, so this re-executes rather than replaying the failure.
        const retry = await submit(
          manuelAccount,
          eventId,
          [{ person_id: mark.id, present: true, version: null }],
          key,
        ).expect(201);

        expect(retry.body.unchanged).toBe(1);
        expect(retry.body.created).toBe(0);
        expect(await liveRows(eventId)).toHaveLength(1);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('answers RESOURCE_BUSY when a correction loses the race and the winner agrees', async () => {
      // **The zero-row supersede**, which nothing else here reaches: the loser had a
      // predecessor to close, the winner closed it first, and the loser's `UPDATE`
      // matches nothing. Its insert then meets the index like any other lost race.
      //
      // This case was deleted for one commit on the argument that it was unreachable.
      // It was not: it raced, it lost, and what had changed was its *answer* — 409
      // became 503 when an unchanged line stopped taking part in the version check. The
      // deletion is why the branch below had no coverage at all.
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      const stored = (await liveRows(eventId))[0];
      const successorId = randomUUID();

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query(
          'UPDATE dcc_attendance SET superseded_at = clock_timestamp(), superseded_by = $2 WHERE id = $1',
          [stored.id, successorId],
        );
        await holder.query(
          // `recorded_at` from the predecessor's `superseded_at`, which is what the
          // service does and what `dcc_attendance_chain_contiguous` now requires. Left
          // to the column default it is `now()` — the transaction's start — so the
          // successor would begin before its predecessor ended, which is the defect
          // migration 0013 exists for, written into a fixture.
          `INSERT INTO dcc_attendance
             (id, dcc_event_id, person_id, present, responsible_leader_id, recorded_by,
              version, recorded_at)
           VALUES ($1, $2, $3, false, $4, $5, 2,
                   (SELECT superseded_at FROM dcc_attendance WHERE id = $6))`,
          [successorId, eventId, mark.id, manuel.id, admin.id, stored.id],
        );

        // Disagrees with the value standing *before* the race, so it is a correction and
        // takes the predecessor's row lock. It agrees with what the winner writes, so
        // once the winner commits there is nothing to choose between.
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
          'the correction to block on the predecessor row',
        );

        expect(waiters).toBeGreaterThan(0);
        await holder.query('COMMIT');

        const response = await attempt;

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        const rows = await liveRows(eventId);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(successorId);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('answers a conflict when the value has been flipped back under the loser', async () => {
      // **The case the deletion claimed could not exist.** The argument was that
      // `present` is a boolean, so a loser that disagreed with the pre-race value must
      // agree with what the winner wrote. That bounds the number of *values* and not
      // the number of *commits*: an even number of flips returns the stored value to
      // the one the loser disagrees with, and `conflictAfterLostRace` re-reads on the
      // pool, holding no lock, at an unbounded later moment.
      //
      // Two writes by one account are enough, and both are made inside the holder's
      // transaction so the interleaving is forced rather than hoped for.
      const eventId = await createEvent(await recentSunday());

      await submit(manuelAccount, eventId, [
        { person_id: mark.id, present: true, version: null },
      ]).expect(201);

      const first = (await liveRows(eventId))[0];
      const second = randomUUID();
      const third = randomUUID();

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');

        // true -> false
        await holder.query(
          'UPDATE dcc_attendance SET superseded_at = clock_timestamp(), superseded_by = $2 WHERE id = $1',
          [first.id, second],
        );
        await holder.query(
          // Contiguous with the row it replaces (migration 0013), as above.
          `INSERT INTO dcc_attendance
             (id, dcc_event_id, person_id, present, responsible_leader_id, recorded_by,
              version, recorded_at)
           VALUES ($1, $2, $3, false, $4, $5, 2,
                   (SELECT superseded_at FROM dcc_attendance WHERE id = $6))`,
          [second, eventId, mark.id, manuel.id, admin.id, first.id],
        );

        // and back, false -> true
        await holder.query(
          'UPDATE dcc_attendance SET superseded_at = clock_timestamp(), superseded_by = $2 WHERE id = $1',
          [second, third],
        );
        await holder.query(
          `INSERT INTO dcc_attendance
             (id, dcc_event_id, person_id, present, responsible_leader_id, recorded_by,
              version, recorded_at)
           VALUES ($1, $2, $3, true, $4, $5, 3,
                   (SELECT superseded_at FROM dcc_attendance WHERE id = $6))`,
          [third, eventId, mark.id, manuel.id, admin.id, second],
        );

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
          'the correction to block on the predecessor row',
        );

        expect(waiters).toBeGreaterThan(0);
        await holder.query('COMMIT');

        const response = await attempt;

        // Stored is `true` at version 3; the loser submitted `false` at version 1. Two
        // genuinely different values, which is a conflict on the ordinary terms.
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('VERSION_CONFLICT');
        expect(response.body.error.details.submitted_version).toBe(1);
        expect(response.body.error.details.current_version).toBe(3);
        expect(response.body.error.details.submitted.present).toBe(false);
        expect(response.body.error.details.current.present).toBe(true);
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

    it('stores the response it returned, and replays that', async () => {
      // **Named for what it checks.** It said "records its completion inside the
      // transaction that writes" and could not fail on that: delete `completeWithin`
      // from the handler and the interceptor writes the identical row, because its own
      // completion matches while the claim is `IN_FLIGHT`. The transactional property
      // is pinned generically by `idempotency.e2e.spec.ts`'s `rolls-back` probe, which
      // exists to break exactly that rule. What is asserted here is section 22's other
      // obligation: what is recorded is what is returned.
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
