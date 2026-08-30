import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { CellsConfigurationService } from '../../src/cells/cells.configuration.service';
import { startOfManilaDay, startOfNextManilaMonth } from '../../src/common/time/manila';
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
 * A Cell's category and schedule (SKILL.md section 10, *Category changes* and
 * *Schedule changes*).
 *
 * Migration 0009 already refuses a second open row per Cell, a period ending before
 * it starts, and a schedule row starting anywhere but the first of a Manila month or
 * the Cell's `created_at`; those are pinned in `test/database/cells.spec.ts`. What is
 * here is the endpoint's half — who may change a Cell's configuration, the effective
 * dates, and the refusals that need a sentence rather than a trigger message.
 *
 * **The two effective dates are the point.** A category change takes effect the day
 * it is made; a schedule change takes effect at the start of the following month, so
 * a month holds exactly one schedule and a past month's coverage figure does not move
 * (section 3). Sharing a handler would put that difference behind a parameter.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('cell configuration (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let markAccount: TestAccount;
  let ben: TestPerson;
  let benCell: TestCell;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const adminPerson = await createPerson(db, { firstName: 'Admin', network: 'MENS' });
    await assignTo(db, adminPerson.id, root.id);
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    // A sibling branch: Ben is under the root rather than under Mark, so his Cell is
    // outside Mark's subtree and inside Admin's Whole Church scope.
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const changeCategory = (actor: TestAccount, cellUuid: string, category: string) =>
    request(app.getHttpServer())
      .put(`/api/v1/cells/${cellUuid}/category`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ category });

  const changeSchedule = (
    actor: TestAccount,
    cellUuid: string,
    dayOfWeek: number,
    timeOfDay: string,
  ) =>
    request(app.getHttpServer())
      .put(`/api/v1/cells/${cellUuid}/schedule`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ day_of_week: dayOfWeek, time_of_day: timeOfDay });

  const categoryRows = (cellUuid: string) =>
    db
      .selectFrom('cell_categories')
      .select(['category', 'started_at', 'ended_at', 'actor_id'])
      .where('cell_id', '=', cellUuid)
      // **`ended_at` is the tie-break, and it is load-bearing.** A section 5
      // correction leaves two rows sharing a `started_at` — the inert one it
      // closed and the live one it opened — so ordering by `started_at` alone
      // returns them in whatever order the table happens to hold, and a case
      // asserting on their positions passes or fails by luck.
      .orderBy('started_at', 'asc')
      .orderBy('ended_at', sql`asc nulls last`)
      // A third correction produces two inert rows sharing both timestamps. This
      // fallback makes the order **stable** — the same across repeated queries and
      // independent of physical row order — and it does **not** make it predictable,
      // because these ids are `gen_random_uuid()` defaults assigned through the API.
      // Slice 1's equivalent is predictable only because its case fixes the id it
      // wants to lose. A three-correction case asserting on positions would need the
      // same; nothing exercises that today.
      .orderBy('id', 'asc')
      .execute();

  const scheduleRows = (cellUuid: string) =>
    db
      .selectFrom('cell_schedules')
      .select(['day_of_week', 'time_of_day', 'started_at', 'ended_at', 'actor_id'])
      .where('cell_id', '=', cellUuid)
      // **`ended_at` is the tie-break, and it is load-bearing.** A section 5
      // correction leaves two rows sharing a `started_at` — the inert one it
      // closed and the live one it opened — so ordering by `started_at` alone
      // returns them in whatever order the table happens to hold, and a case
      // asserting on their positions passes or fails by luck.
      .orderBy('started_at', 'asc')
      .orderBy('ended_at', sql`asc nulls last`)
      // A third correction produces two inert rows sharing both timestamps. This
      // fallback makes the order **stable** — the same across repeated queries and
      // independent of physical row order — and it does **not** make it predictable,
      // because these ids are `gen_random_uuid()` defaults assigned through the API.
      // Slice 1's equivalent is predictable only because its case fixes the id it
      // wants to lose. A three-correction case asserting on positions would need the
      // same; nothing exercises that today.
      .orderBy('id', 'asc')
      .execute();

  describe('category (takes effect the day it is made)', () => {
    it('closes the open row and opens the new one at the same instant', async () => {
      const response = await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(200);

      expect(response.body).toMatchObject({
        cell_id: markCell.cellId,
        cell_uuid: markCell.id,
        category: 'YOUNG_PRO',
      });

      const rows = await categoryRows(markCell.id);
      expect(rows).toHaveLength(2);

      // Section 10 preserves category history with effective dates, and the two rows
      // must meet exactly: a gap would leave an instant at which the Cell had no
      // category, so an as-of query for it answers nothing.
      //
      // **Nothing else pins that.** An earlier version of this comment credited
      // `assert_active_cell_is_configured`, which only checks that a row with a null
      // `ended_at` exists — close at `t` and open at `t + 1ms` and it passes with a
      // one-millisecond hole. This assertion is the only contiguity check on either
      // configuration table, which is worth knowing before somebody deletes it as
      // redundant.
      expect(rows[0].ended_at?.toISOString()).toBe(rows[1].started_at.toISOString());
      expect(rows[1].category).toBe('YOUNG_PRO');
      expect(rows[1].ended_at).toBeNull();
    });

    it('takes effect now, not at the start of next month', async () => {
      // **The distinguishing assertion against the schedule rule, and it was missing.**
      // Section 10: "Unlike a schedule change, a category change takes effect on the
      // date it is made" — because nothing derives a meeting count from a category, so
      // there is no figure a mid-month change would rewrite.
      //
      // Replacing this rule's `at` with the schedule's next-month instant left all
      // eighteen cases green: `period_ordered` is `>=`, `one_open` is satisfied, and
      // migration 0009 says in terms that this table "carries no equivalent of the
      // schedule trigger". Decision 1's entire justification had nothing able to fail
      // on it.
      const before = Date.now();
      const response = await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(200);

      const effective = new Date(response.body.effective_at).getTime();
      expect(effective).toBeGreaterThanOrEqual(before - 1000);
      expect(effective).toBeLessThanOrEqual(Date.now() + 1000);

      // The Manila day, returned beside the instant on this route too (section 22).
      // Pinned here because deleting it from the category response left the suite
      // green — the schedule half was asserted and this one was not.
      expect(response.body.effective_date).toBe(
        new Date(response.body.effective_at).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Manila',
        }),
      );

      const rows = await categoryRows(markCell.id);
      // **Bounded from both sides, with the same 1000ms the two assertions above take.**
      // `started_at` is `clock_timestamp()` — the *database's* clock — and `Date.now()`
      // is this process's, so the two ends of this comparison came from different
      // clocks, which `test/setup/fixtures.ts` names as a hazard. With no slack at all a
      // forward difference of a single millisecond fails a correct run, and it did: this
      // case failed once in a full-suite run here and passed on the next.
      //
      // **1000ms is copied from its neighbours, not derived.** Nothing in this
      // repository bounds host-to-database skew — that is on CLAUDE.md's open list — so
      // this is a tolerance wide enough to absorb it rather than a limit anything
      // guarantees. It costs the assertion nothing, because what the case discriminates
      // against is the schedule rule's instant, and the first of next month is weeks
      // away in both directions.
      //
      // The lower bound is the half that was missing: with only an upper one, a row
      // stamped in the *past* passed, and the rule is that the change takes effect now.
      expect(rows[1].started_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(rows[1].started_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('records the actor on the row it opens', async () => {
      // Section 10 gives `cell_categories` an `actor_id`, and migration 0009's header
      // says a null there is for a system action. An endpoint has an authenticated
      // actor in hand, so leaving it null would be recording one thing as another —
      // the defect slice 2 shipped and had to correct.
      await changeCategory(admin, markCell.id, 'COUPLE').expect(200);

      const rows = await categoryRows(markCell.id);
      expect(rows[1].actor_id).toBe(admin.id);
    });

    it('refuses a change to the category the Cell already has', async () => {
      const response = await changeCategory(admin, markCell.id, markCell.category).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // Nothing was written: the refusal exists to keep a boundary out of the
      // history where nothing happened, so a second row would defeat it.
      expect(await categoryRows(markCell.id)).toHaveLength(1);
    });

    it('refuses a closed Cell, for being closed', async () => {
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_DISPERSED' });

      const response = await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // **The message, not only the code**, and a mutation is what forced it.
      // `closeCellDirectly` ends the category row too, so deleting the closed-Cell
      // refusal entirely leaves this passing through the "no open category row"
      // branch — the same code for a different reason. Two branches, one assertion,
      // neither pinned.
      expect(response.body.error.message).toMatch(/closed/i);
    });

    it('writes one audit entry naming the Cell', async () => {
      await changeCategory(admin, markCell.id, 'YOUNG_PRO').expect(200);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'cell_category.changed')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].target_type).toBe('cell');
      expect(entries[0].target_id).toBe(markCell.id);
      expect(entries[0].before).toMatchObject({ category: markCell.category });
      expect(entries[0].after).toMatchObject({ category: 'YOUNG_PRO' });
    });
  });

  describe('schedule (takes effect at the start of the following month)', () => {
    it('opens the new row at Manila midnight on the first of next month', async () => {
      const response = await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      // The expected instant is computed the same way the service computes it, which
      // would make this vacuous on its own — so the assertions below check the
      // *properties* section 10 states rather than only the equality: the instant is
      // a Manila month boundary, and it is in the future.
      const expected = startOfManilaDay(startOfNextManilaMonth(new Date()));
      expect(response.body.effective_at).toBe(expected.toISOString());

      // **The Manila day, which is the point of returning both.** The instant is
      // 16:00 UTC on the last day of the previous month, so a client rendering a date
      // from it alone shows the wrong month -- section 22's "the conversion is where
      // months silently shift".
      expect(response.body.effective_date).toMatch(/-01$/);
      expect(response.body.effective_date).not.toBe(expected.toISOString().slice(0, 10));

      // Manila is UTC+8 with no daylight saving, so a Manila month boundary is 16:00
      // UTC on the last day of the previous month, which is what
      // `cell_schedules_start_is_legal` accepts.
      //
      // **It is not what would catch a UTC-derived month**, and an earlier version of
      // this comment said it was. `expected` is computed with the same helper the
      // service uses, so a defect there moves both and every equality here still
      // passes; and the composition would still yield a legal month start, so the
      // trigger passes too and the row files against the wrong month silently. The
      // unit case in `manila.spec.ts` is what fails.
      expect(expected.getUTCHours()).toBe(16);
      expect(expected.getUTCMinutes()).toBe(0);
      expect(expected.getTime()).toBeGreaterThan(Date.now());

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(2);
      expect(rows[0].ended_at?.toISOString()).toBe(expected.toISOString());
      expect(rows[1].started_at.toISOString()).toBe(expected.toISOString());
      expect(rows[1].day_of_week).toBe(7);
      expect(rows[1].ended_at).toBeNull();
    });

    it('does not take effect immediately, which is the whole of the rule', async () => {
      // The distinguishing assertion against the category rule. If a schedule change
      // took effect now, the outgoing row would end in the past and the month would
      // hold two schedules — which is what section 10 says silently rewrites every
      // earlier coverage figure.
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows[1].started_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('permits a second change in one month, correcting the pending one', async () => {
      // **Ruled on 2026-08-29, after an earlier version refused this.** Both changes
      // resolve to the same instant, so the second closes the pending row at its own
      // `started_at` — the zero-length row section 5 makes inert. The refusal claimed
      // the Cell's current schedule would vanish; it does not. The row that goes inert
      // is the *pending* one, which was never in force.
      //
      // Refusing stranded a leader who queued the wrong day: they could not fix it
      // until it took effect, and a change made then lands a month later again, so one
      // mistake cost a whole month meeting on a day nobody had agreed to.
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);
      await changeSchedule(admin, markCell.id, 1, '20:00').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(3);

      // The row governing today is untouched, which is the whole point.
      expect(rows[0].day_of_week).toBe(markCell.dayOfWeek);
      expect(rows[0].ended_at).not.toBeNull();

      // The superseded pending row is inert: it starts and ends at the same instant,
      // so no as-of query can ever select it (section 5).
      expect(rows[1].day_of_week).toBe(7);
      expect(rows[1].started_at.toISOString()).toBe(rows[1].ended_at?.toISOString());

      // And the correction is what takes effect next month.
      expect(rows[2].day_of_week).toBe(1);
      expect(rows[2].ended_at).toBeNull();
      expect(rows[2].started_at.toISOString()).toBe(rows[1].started_at.toISOString());
    });

    it('permits reverting to the day the Cell actually meets on', async () => {
      // **This is the worked example section 10 and the Decisions entry both use, and
      // nothing pinned it.** Mutating the no-op comparison to read the row *in force*
      // rather than the row currently open left the whole suite green — against the
      // exact mutation section 10's closing argument rules out, because every other
      // case submits a day that differs from both rows.
      //
      // Section 10: "It follows that a Cell's refusal to record a change that changes
      // nothing is a check against the row currently open, which after a first change
      // is the pending one."
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      // Saturday is what the Cell meets on today, and what the pending row moved it
      // away from. Read against the row in force this is a no-op and is refused; read
      // against the open row it is the revert, and permitted.
      await changeSchedule(admin, markCell.id, markCell.dayOfWeek, markCell.timeOfDay).expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(3);

      // The boundary section 10 accepts in writing: the Cell meets Saturday before the
      // month boundary and Saturday after it, with a boundary in between across which
      // the schedule did not change. Every as-of query still answers correctly.
      expect(rows[0].day_of_week).toBe(markCell.dayOfWeek);
      expect(rows[1].day_of_week).toBe(7);
      expect(rows[1].started_at.toISOString()).toBe(rows[1].ended_at?.toISOString());
      expect(rows[2].day_of_week).toBe(markCell.dayOfWeek);
      expect(rows[2].ended_at).toBeNull();
    });

    it('refuses a change to the day and time the Cell already has', async () => {
      const response = await changeSchedule(
        admin,
        markCell.id,
        markCell.dayOfWeek,
        markCell.timeOfDay,
      ).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await scheduleRows(markCell.id)).toHaveLength(1);
    });

    it('accepts a change to the time alone', async () => {
      // The no-op refusal compares both fields, so a change to one of them is a real
      // change. Pinned because a refusal keyed on the day alone would look correct
      // and would block a Cell moving from 16:00 to 19:00.
      await changeSchedule(admin, markCell.id, markCell.dayOfWeek, '19:30').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows).toHaveLength(2);
      expect(rows[1].day_of_week).toBe(markCell.dayOfWeek);
      expect(rows[1].time_of_day).toMatch(/^19:30/);
    });

    it('refuses a closed Cell, for being closed', async () => {
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_DISPERSED' });

      const response = await changeSchedule(admin, markCell.id, 7, '16:00').expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/closed/i);
    });

    it('records the actor and one audit entry carrying the effective date', async () => {
      // Section 21 names this action "with effective date", and section 10 gives
      // `cell_schedules` an `actor_id` whose null is reserved for a system action.
      // The category half was pinned and this half was not: deleting either the audit
      // write or the `actor_id` left every case green.
      await changeSchedule(admin, markCell.id, 7, '16:00').expect(200);

      const rows = await scheduleRows(markCell.id);
      expect(rows[1].actor_id).toBe(admin.id);

      const entries = await db
        .selectFrom('audit_log')
        .select(['target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'cell_schedule.changed')
        .execute();

      expect(entries).toHaveLength(1);
      expect(entries[0].target_type).toBe('cell');
      expect(entries[0].target_id).toBe(markCell.id);
      expect(entries[0].before).toMatchObject({ day_of_week: markCell.dayOfWeek });
      expect(entries[0].after).toMatchObject({
        day_of_week: 7,
        started_at: rows[1].started_at.toISOString(),
      });
    });

    it('refuses a day outside the ISO range as VALIDATION_FAILED', async () => {
      // Section 20's day numbering is 1..7. The database refuses it too; this is here
      // so a bad value is an answer rather than a constraint violation.
      const response = await changeSchedule(admin, markCell.id, 0, '16:00').expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('scope (section 7 resolves a Cell through its leader)', () => {
    it('lets a leader configure their own Cell', async () => {
      // `cell.manage_configuration` is own/subtree for a LEADER, and a Cell resolves
      // through its leader — so Mark reaches his own Cell without section 10's list
      // of holders being restated anywhere in the service.
      await changeCategory(markAccount, markCell.id, 'YOUNG_PRO').expect(200);
    });

    it("refuses a leader on a sibling branch's Cell", async () => {
      // Ben is under the root rather than under Mark, so his Cell is outside Mark's
      // subtree. Without this, `cell.manage_configuration` at own/subtree would reach
      // every Cell in the church.
      const response = await changeCategory(markAccount, benCell.id, 'YOUNG_PRO').expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('refuses in the transaction too, not only at the guard', async () => {
      // **Every case above passes if *either* the guard or the in-transaction
      // re-check is present**, so together they pin the disjunction and neither
      // member. Deleting `assertStillInScopeWithin` left all seventeen green, which
      // is the fault this repository keeps recording — a check with nothing able to
      // fail on it.
      //
      // The re-check exists for a window no request can stage: a handover committing
      // between the guard's answer on the pool and the transaction opening. So it is
      // called directly, bypassing the guard, which is what the 2026-08-23 identifier
      // ruling prescribes for exactly this shape.
      const service = app.get(CellsConfigurationService);

      await expect(
        service.changeCategory(
          benCell.id,
          'YOUNG_PRO',
          { accountId: markAccount.id, personId: mark.id },
          { accountId: markAccount.id, key: randomUUID(), claimId: randomUUID() },
        ),
      ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

      // And nothing was written by the attempt.
      expect(await categoryRows(benCell.id)).toHaveLength(1);
    });

    it('answers SCOPE_DENIED rather than NOT_FOUND for a Cell that does not exist', async () => {
      // Section 22, as amended on 2026-08-29: an actor whose scope does not cover a
      // Cell cannot distinguish an absent one from one they may not see. Both answer
      // `SCOPE_DENIED`, in one message with one details payload.
      const absent = await changeCategory(markAccount, randomUUID(), 'YOUNG_PRO').expect(403);
      const outOfScope = await changeCategory(markAccount, benCell.id, 'YOUNG_PRO').expect(403);

      expect(absent.body.error.code).toBe('SCOPE_DENIED');
      expect(absent.body.error.message).toBe(outOfScope.body.error.message);
      expect(absent.body.error.details).toEqual(outOfScope.body.error.details);
    });

    it('answers NOT_FOUND for an absent Cell where the scope would have covered it', async () => {
      // Admin holds Whole Church, so absence is genuinely absence for them — which is
      // the other half of section 22's rule, and the half that keeps the answer
      // truthful for the actor who can see everything.
      const response = await changeCategory(admin, randomUUID(), 'YOUNG_PRO').expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('concurrency (section 5)', () => {
    // **Both of this slice's live fixes were unpinned**, and a review found that
    // rather than a test. Reverting `.forNoKeyUpdate()` to `.forShare()`, or deleting the
    // `lock_timeout` bound, left all twenty cases green — in the batch whose own
    // headline was that three rules had nothing able to fail on them.

    it('waits for a Cell row held by another transaction', async () => {
      // **The blocker holds `FOR SHARE`, and that is what discriminates.** A shared
      // lock does not conflict with another shared lock, so a service still using
      // `.forShare()` sails past and answers immediately. Only a lock that conflicts with `FOR SHARE` waits.
      //
      // That is the defect this pins: shared, two configuration changes both read the
      // open row, and the loser's `UPDATE` re-matches the row the winner just closed
      // and overwrites its `ended_at` — an in-place rewrite of a closed row, which
      // section 5 and Principle 12 forbid — then opens a second live row and meets
      // `23505`, which nothing classifies. A 500.
      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();

      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM cells WHERE id = $1 FOR SHARE', [markCell.id]);
        const { rows } = await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

        // Dispatched, not held. A supertest object is lazy, and an unawaited one is
        // never sent — the fault CLAUDE.md records at `19dfe3c` and which slice 3 hit
        // again. `.then` sends it; the poll is what makes the contention real.
        // `.catch` is attached immediately, not for tidiness: if the poll below throws,
        // nothing has handled this promise yet, and Node 22 treats an unhandled
        // rejection as fatal — turning a clean assertion failure into a worker crash.
        const pending = changeCategory(admin, markCell.id, 'YOUNG_PRO').then(
          (r) => ({ ok: true, response: r }) as const,
          (error: unknown) => ({ ok: false, error }) as const,
        );

        await waitForBlockedBy(rows[0].pid);

        await blocker.query('COMMIT');
        const settled = await pending;

        if (!settled.ok) {
          throw settled.error;
        }
        expect(settled.response.status).toBe(200);
      } finally {
        await blocker.end();
      }
    }, 20000);

    it('gives up with RESOURCE_BUSY rather than waiting for ever', async () => {
      // Section 5 bounds every wait, and requires an operation taking row locks and no
      // advisory locks to set the bound itself — `lockPersonsWithin` returns before
      // setting it when the person list is empty, which this service's always is.
      // Without `boundLockWaitsWithin` this request waits until the blocker's
      // connection closes, so what this case pins is that the answer arrives at all.
      const blocker = new Client({ connectionString: process.env.DATABASE_URL });
      await blocker.connect();

      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM cells WHERE id = $1 FOR UPDATE', [markCell.id]);

        // **Raced against a timer, because the failure this pins is a wait that never
        // ends.** Without the bound the request blocks until the blocker's connection
        // closes, so a bare `await` would hang the suite until the job timeout rather
        // than failing — a defect that costs CI ten minutes and says nothing is worse
        // than one that costs it eight seconds and names itself.
        let timer: NodeJS.Timeout | undefined;
        const response = await Promise.race([
          changeCategory(admin, markCell.id, 'YOUNG_PRO'),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('The request was still waiting after 8s: no lock_timeout.')),
              8000,
            );
          }),
          // Cleared on both paths: left armed, it keeps the event loop alive for five
          // seconds after a successful run settles at about three.
        ]).finally(() => clearTimeout(timer));

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
      } finally {
        // Nested, so a `ROLLBACK` that rejects — a backend already gone, most likely —
        // cannot skip `end()` and leave the connection open.
        try {
          await blocker.query('ROLLBACK');
        } finally {
          await blocker.end();
        }
      }
    }, 30000);
  });

  describe('idempotency (section 22)', () => {
    it('replays the stored response rather than changing the category twice', async () => {
      const key = randomUUID();
      const send = () =>
        request(app.getHttpServer())
          .put(`/api/v1/cells/${markCell.id}/category`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', key)
          .send({ category: 'YOUNG_PRO' });

      const first = await send().expect(200);
      const replay = await send().expect(200);

      expect(replay.body).toEqual(first.body);

      // The replay must not have opened a third row. Without `completeWithin` inside
      // the transaction the second request would run the write again and leave the
      // history with a boundary nobody asked for.
      expect(await categoryRows(markCell.id)).toHaveLength(2);
    });
  });
});

/**
 * Wait until some backend is blocked **by this blocker**.
 *
 * Keyed on the blocker's own backend pid, which this test created and therefore
 * knows. `pg_blocking_pids` answers "who is holding what this backend wants", so
 * asking whether any backend is blocked by *my* pid names exactly the wait this
 * test set up.
 *
 * A bare `pg_stat_activity` predicate was rejected, and slice 3 recorded why: it is
 * cluster-wide, this machine also carries `dfc_dev`, and in CI the test role is a
 * superuser — so "some backend is blocked" matches waits this test knows nothing
 * about and would pass without the lock under test existing. The waiter's own pid is
 * genuinely unknown, being a pooled connection inside the application; the blocker's
 * is not.
 */
async function waitForBlockedBy(blockerPid: number): Promise<void> {
  const probe = createTestDb();

  try {
    // 100 x 20ms = 2s, deliberately **under** the service's 3s `lock_timeout`. A wider
    // budget lets a slow-but-correct run time out here and report the same message a
    // genuine `.forShare()` regression produces, which is a diagnostic that lies.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await sql<{ count: string }>`
        SELECT count(*) AS count
          FROM pg_stat_activity
         WHERE ${blockerPid}::int = ANY (pg_blocking_pids(pid))
      `.execute(probe);

      if (Number(waiting.rows[0].count) > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Nothing ever blocked on backend ${blockerPid}.`);
  } finally {
    await probe.destroy();
  }
}
