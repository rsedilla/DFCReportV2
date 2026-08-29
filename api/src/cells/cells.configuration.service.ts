import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import {
  InvariantViolationError,
  NotFoundError,
  ScopeDeniedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { manilaDayOf, startOfManilaDay, startOfNextManilaMonth } from '../common/time/manila';
import { DATABASE, type Db } from '../database/database.module';
import { boundLockWaitsWithin } from '../database/person-lock';

import { CellsReadService } from './cells.read.service';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { CellCategory, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * A Cell's category and its schedule (SKILL.md section 10, *Category changes* and
 * *Schedule changes*).
 *
 * Both are effective-dated edits governed by one capability,
 * `cell.manage_configuration`. Section 7 gives the reason for one rather than two:
 * "both are effective-dated edits to how a Cell is configured, both are audited the
 * same way, and an administrator granting one and withholding the other would be
 * expressing a distinction no rule makes."
 *
 * **They are two methods rather than one, because their effective dates differ and
 * the difference is the whole of section 10's argument.** A category change takes
 * effect on the day it is made, because "nothing derives a count of scheduled
 * meetings from a category, so there is no figure a mid-month change would silently
 * rewrite". A schedule change takes effect at the start of the following month, so
 * that a month holds exactly one schedule and a past month's coverage figure does
 * not move (section 3). Sharing a handler would mean a parameter deciding which
 * rule applies, which is the shape that gets passed wrongly.
 *
 * **What the database already refuses**, and what is therefore not re-checked here:
 * a second open row per Cell on either table (`cell_categories_one_open`,
 * `cell_schedules_one_open`), a period ending before it starts, a schedule row
 * starting anywhere but the first of a Manila month or the Cell's `created_at`
 * (`cell_schedules_start_is_legal`), and an ACTIVE Cell left without one open row of
 * each (`cells_are_configured`). Migration 0009 carries all of them.
 *
 * What this service owns is the authorization, the effective dates, the refusals
 * that need a sentence rather than a trigger message, and the audit entries section
 * 10 requires.
 */
@Injectable()
export class CellsConfigurationService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly cells: CellsReadService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Change a Cell's category, effective today.
   *
   * Section 10: "Cell category is editable over time, e.g. Youth -> Young Pro. Keep
   * the same Cell ID. Preserve category history with effective dates."
   */
  async changeCategory(
    cellId: string,
    category: CellCategory,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    // Read on the pool, before the transaction opens. `authorize` reads
    // `account_roles`, `capability_grants` and, for a subtree scope, the tree — so
    // calling it inside a transaction asks a bounded pool for a second connection
    // while holding one, which is the liveness hazard section 24 names.
    const authority = await this.authorization.authorityFor(actor.accountId);

    return this.db.transaction().execute(async (trx) => {
      const cell = await this.lockAndReadCellWithin(trx, cellId);
      await this.assertStillInScopeWithin(trx, actor, authority, cellId);

      const current = await trx
        .selectFrom('cell_categories')
        .select(['id', 'category'])
        .where('cell_id', '=', cellId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (!current) {
        // Unreachable through any operation section 10 defines: an ACTIVE Cell is
        // required to hold one, and `cells_are_configured` enforces it. Refused with
        // an answer rather than left to fail as a null dereference.
        throw new InvariantViolationError(
          'That Cell has no open category row, which an ACTIVE Cell must have ' +
            '(SKILL.md section 10, Creating a Cell).',
          { cell_id: cell.cell_id },
        );
      }

      if (current.category === category) {
        // Section 4 refuses a sex correction that changes nothing and section 5 a
        // reassignment to the leader a person already has, both because an audited
        // operation whose before and after are identical misleads whoever reads the
        // log. Here it would also put a boundary in the category history where
        // nothing happened, so "how long was this a Youth Cell" answers wrongly ever
        // after.
        throw new InvariantViolationError(
          `That Cell is already ${category}. A change that changes nothing is refused, ` +
            'because it would record a category boundary where nothing happened ' +
            '(SKILL.md section 10, Category changes).',
          { cell_id: cell.cell_id, category },
        );
      }

      // Section 10: a category change "takes effect on the date it is made".
      // `clock_timestamp()` rather than `now()`, which is transaction start and
      // therefore precedes the lock wait — the defect slice 3 recorded, where a
      // queued request stamped its rows with the instant it arrived.
      const at = await this.nowWithin(trx);

      await trx
        .updateTable('cell_categories')
        .set({ ended_at: at })
        .where('id', '=', current.id)
        .execute();

      await trx
        .insertInto('cell_categories')
        .values({
          cell_id: cellId,
          category,
          actor_id: actor.accountId,
          started_at: at,
        })
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_category.changed',
        targetType: 'cell',
        targetId: cellId,
        before: { category: current.category },
        after: { category, started_at: at.toISOString() },
      });

      const response = {
        cell_id: cell.cell_id,
        cell_uuid: cellId,
        category,
        // Both renderings, as `PUT /people/{id}/sex` and `/pastoral-leader` already
        // return them (section 22, one concept one field name). `effective_at` is the
        // instant the rows carry, in UTC because that is unambiguous; `effective_date`
        // is the Asia/Manila day, which is what a client displays.
        //
        // **The pair is not decoration here, it is the defect it prevents.** A
        // schedule change effective 1 September carries the instant
        // `2026-08-31T16:00:00Z`, so a client rendering a date from the instant alone
        // shows 31 August — section 22 in one line: "Never send a date-only field as a
        // timestamp; the conversion is where months silently shift."
        effective_at: at.toISOString(),
        effective_date: manilaDayOf(at),
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * Change a Cell's day and time, effective at the start of the following month.
   *
   * Section 10 states the rule and its reason: "A Cell moving from Saturday to
   * Sunday, decided in August, runs on Sunday from 1 September. A month therefore
   * has exactly one schedule throughout." Without it, moving a Cell in June
   * "silently rewrites the coverage figure for every earlier month, because March
   * has five Sundays and four Saturdays" — which breaks section 3's guarantee that a
   * past period's figures do not move.
   *
   * A Cell needing to move a **single** meeting does not use this. That is a
   * `RESCHEDULED` meeting (section 13), and section 10 keeps the two mechanisms
   * deliberately apart.
   */
  async changeSchedule(
    cellId: string,
    dayOfWeek: number,
    timeOfDay: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const authority = await this.authorization.authorityFor(actor.accountId);

    return this.db.transaction().execute(async (trx) => {
      const cell = await this.lockAndReadCellWithin(trx, cellId);
      await this.assertStillInScopeWithin(trx, actor, authority, cellId);

      const current = await trx
        .selectFrom('cell_schedules')
        .select(['id', 'day_of_week', 'time_of_day', 'started_at'])
        .where('cell_id', '=', cellId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (!current) {
        throw new InvariantViolationError(
          'That Cell has no open schedule row, which an ACTIVE Cell must have ' +
            '(SKILL.md section 10, Creating a Cell).',
          { cell_id: cell.cell_id },
        );
      }

      if (current.day_of_week === dayOfWeek && sameTimeOfDay(current.time_of_day, timeOfDay)) {
        throw new InvariantViolationError(
          'That Cell is already scheduled for then. A change that changes nothing is refused, ' +
            'because it would record a schedule boundary where nothing happened ' +
            '(SKILL.md section 10, Schedule changes).',
          { cell_id: cell.cell_id, day_of_week: dayOfWeek, time_of_day: timeOfDay },
        );
      }

      const at = await this.nowWithin(trx);

      // Section 10, and the reason the zone is not optional: "first day of a month"
      // is a calendar-day test, so the row starts at Manila 00:00 on the 1st, stored
      // as 16:00 UTC on the last day of the previous month. Computing the month in
      // UTC picks the wrong one only on the **first of a Manila month**, through that
      // day's first eight hours — 00:00 to 07:59, which is UTC 16:00 to 23:59 of the
      // day before. Eight hours a month, not eight hours a day.
      //
      // **And no constraint would catch it**, which an earlier version of this
      // comment claimed. `startOfManilaDay` still yields a legal Manila month start,
      // so `cell_schedules_start_is_legal` passes and the row is filed against the
      // wrong month — section 10's own warning that "the defect hides in exactly the
      // rows the rule is not about". The unit case in `manila.spec.ts` is the only
      // thing that fails.
      const effectiveFrom = startOfManilaDay(startOfNextManilaMonth(at));

      // **A second change inside one month is permitted, and an earlier version of
      // this refused it.** Both resolve to the same instant, so the second closes the
      // pending row at its own `started_at` — the zero-length row section 5 makes
      // inert. The reason given for refusing was that the Cell's current schedule
      // would vanish, and that is false: the row that goes inert is the *pending*
      // one, which was never in force. The row actually governing today is untouched.
      //
      // What it is instead is exactly the correction section 5 prescribes — "a row
      // entered in error is corrected by closing it and opening the right one" — and
      // is why `cell_schedules_period_ordered` is `>=`. The 2026-08-22 ruling settled
      // that shape for effective-dated tables generally; 0009 created this constraint
      // already carrying it, so nothing was relaxed here.
      // Refusing it stranded a leader who queued the wrong day: they could not fix it
      // until it took effect, and a change made then lands a month later again, so
      // one mistake cost a whole month meeting on a day the Cell had not agreed to.
      //
      // Equality is the only case this could ever have caught. `effectiveFrom` is
      // always the next Manila month boundary, and an open row's `started_at` is
      // either in the past or that same boundary, so there is no third case the
      // check was protecting. The no-op refusal above is what covers "you changed
      // nothing".

      await trx
        .updateTable('cell_schedules')
        .set({ ended_at: effectiveFrom })
        .where('id', '=', current.id)
        .execute();

      await trx
        .insertInto('cell_schedules')
        .values({
          cell_id: cellId,
          day_of_week: dayOfWeek,
          time_of_day: timeOfDay,
          actor_id: actor.accountId,
          started_at: effectiveFrom,
        })
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'cell_schedule.changed',
        targetType: 'cell',
        targetId: cellId,
        before: { day_of_week: current.day_of_week, time_of_day: current.time_of_day },
        after: {
          day_of_week: dayOfWeek,
          time_of_day: timeOfDay,
          started_at: effectiveFrom.toISOString(),
        },
      });

      const response = {
        cell_id: cell.cell_id,
        cell_uuid: cellId,
        day_of_week: dayOfWeek,
        time_of_day: timeOfDay,
        effective_at: effectiveFrom.toISOString(),
        effective_date: manilaDayOf(effectiveFrom),
      };

      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });

      return response;
    });
  }

  /**
   * Re-decide scope inside the transaction, once the Cell row is held.
   *
   * The guard answers on the pool before the transaction opens, and a Cell resolves
   * through its leader (section 7) — so a handover committing in between leaves the
   * guard's answer describing authority the actor no longer holds, and the write
   * would land on a Cell in somebody else's branch. That is the staleness section 24
   * records for an intermediate ancestor, reached through the Cell rather than
   * through the tree.
   *
   * **Re-derived rather than copied from the membership service** (section 25 rule
   * 19). There it guards a *second* object, the source Cell, which the guard never
   * resolved at all; here the guard did resolve this Cell, and what this adds is
   * freshness rather than reach. The check is the same shape because both ask
   * `coversWith` through the transaction; the reason it exists is not.
   *
   * The guard keeps the early, cheap refusal. This is what the write rests on.
   *
   * **Section 7's forward-dated clause is unfalsifiable here, and that is said rather
   * than left to be discovered.** A schedule change is the one write in the system
   * whose effective date is in the future, so it is the clause's only subject — and
   * mutating this to `leaderAsOfWithin(effectiveFrom)` cannot change any answer,
   * because no leadership row exists at a future instant that the currently open row
   * does not already cover. The rule is right and no test can hold it; it acquires one
   * the day a leadership row can be opened ahead of time.
   */
  private async assertStillInScopeWithin(
    trx: Transaction<Database>,
    actor: Actor,
    authority: ActorAuthority,
    cellId: string,
  ): Promise<void> {
    const leaderId = await this.cells.leaderForScopeWithin(trx, cellId);

    if (leaderId === null) {
      throw new InvariantViolationError(
        'That Cell cannot be resolved to a leader, so there is no authority to check ' +
          'against (SKILL.md section 11).',
      );
    }

    if (
      !(await this.authorization.coversWith(
        trx,
        actor,
        authority,
        Capability.CellManageConfiguration,
        { kind: 'person', personId: leaderId },
      ))
    ) {
      throw new ScopeDeniedError(
        'That Cell moved outside your authorized scope while this change was being made.',
      );
    }
  }

  /**
   * Bound this transaction's waits, take the Cell exclusively, and refuse a closed one.
   *
   * **`FOR NO KEY UPDATE`, and both weaker and stronger were tried and were wrong.**
   *
   * It was `FOR UPDATE` until section 5 gained the Cell-lock rule with the closure
   * endpoint, and that rule refuses it: an operation takes the weakest strength that
   * does the job for each row, and `FOR UPDATE` additionally conflicts with the
   * `FOR KEY SHARE` a `cell_memberships` insert takes through its foreign key — so a
   * configuration change blocked every concurrent add into that Cell mid-statement,
   * a cost with nothing to buy it. This service writes no `cells` row, but it needs
   * mutual exclusion against a second configuration writer, and `FOR NO KEY UPDATE`
   * conflicts with itself while `FOR SHARE` does not. That is the strength the
   * operation needs.
   *
   * Below is why a shared lock was wrong, which is unchanged and is the reason the
   * exclusion is needed at all. Two
   * configuration changes on one Cell — its leader and their upline, at the same
   * moment — both read the open row, and a shared lock lets both proceed. T1 closes
   * that row and opens its replacement; T2's blocked `UPDATE` re-evaluates under
   * `READ COMMITTED`, still matches the row T1 just closed, and **overwrites its
   * `ended_at`** — rewriting a closed row in place, which section 5 and Principle 12
   * forbid — then opens a second live row and meets `23505`, which
   * `postgres-errors.ts` does not classify, so it renders `INTERNAL_ERROR`. That is
   * the same shape slice 3 closed for memberships, reintroduced by choosing a lock
   * strength that permitted the concurrency.
   *
   * Excluding, the loser waits and then re-reads: it sees the row T1 opened and
   * closes *that*, so the history chains correctly. Two configuration changes on one
   * Cell genuinely conflict, and they are rare enough that serializing them costs
   * nothing worth having.
   *
   * **It costs the membership path something, which section 5 requires naming.** That
   * path's deferred state check takes `FOR SHARE` on this row at commit; a shared
   * lock did not conflict with it and this one does, so an ordinary add or move on
   * this Cell now blocks behind a configuration change, and can be answered
   * `RESOURCE_BUSY` if the wait runs past the bound. That is correct and transient
   * rather than free: section 5 says the order is already fixed by an existing writer
   * and anything added later is established against it, and this is that.
   *
   * It also orders this against a concurrent closure, which was the original reason
   * for a lock here: `assert_active_cell_is_configured` reads `cells` without one, so
   * nothing else would stop a change committing beside a closure and leaving an open
   * schedule row on a CLOSED Cell — the state section 10 now forbids. Unreachable
   * today, since no operation closes a Cell yet.
   *
   * **It takes one row lock and no advisory locks**, so it raises none of the
   * cross-class ordering question section 5 records as open — that section puts the
   * demonstration burden on an operation needing both classes.
   *
   * **Two earlier versions of this argument were over-broad and both are recorded.**
   * The first was "it takes its first lock while holding nothing", which is true of
   * both parties to every deadlock ever recorded. The second was that every lock
   * taken afterwards is held only by transactions that also took this row first —
   * false, because `completeWithin` takes the idempotency key's row lock, which
   * section 5 names in as many words and which any other write endpoint can hold
   * without ever touching `cells`.
   *
   * The argument that holds is per-lock rather than general. This transaction takes
   * three: the `cells` row, which it takes first while holding nothing; the
   * configuration rows, reachable only through the Cell it already holds; and the
   * idempotency key, last. A holder of that key row is at its own final statement —
   * section 22 requires the completion to be the last statement in the transaction —
   * so it wants nothing further and cannot be waiting on this one. A membership write
   * holds an advisory lock on a person and waits for `FOR SHARE` on this Cell at
   * commit, and this service never wants a person lock, so those two wait rather than
   * cycle. Adding a statement above the `cells` lock that takes a lock ends the first
   * clause and the argument with it. The bound comes
   * first because section 5 requires an operation taking row locks and no advisory
   * locks to set it itself; `SET LOCAL` takes no locks, so it cannot be what waits.
   */
  private async lockAndReadCellWithin(
    trx: Transaction<Database>,
    cellId: string,
  ): Promise<{ cell_id: string }> {
    await boundLockWaitsWithin(trx);

    const cell = await trx
      .selectFrom('cells')
      .select(['cell_id', 'state'])
      .where('id', '=', cellId)
      .forNoKeyUpdate()
      .executeTakeFirst();

    if (!cell) {
      // Reached only by an actor whose scope would have covered the Cell: the guard
      // refuses everyone else with `SCOPE_DENIED` before this runs, and cannot tell
      // an absent Cell from one out of scope. Section 22 carries the reasoning.
      throw new NotFoundError('No such Cell.');
    }

    if (cell.state === 'CLOSED') {
      throw new InvariantViolationError(
        'That Cell is closed. A closure ends its category and schedule rows on the ' +
          'closure effective date, and a closure is never reversed (SKILL.md section 10).',
        { cell_id: cell.cell_id },
      );
    }

    return { cell_id: cell.cell_id };
  }

  /**
   * The instant to stamp, read from the database server after the lock.
   *
   * `clock_timestamp()` rather than `now()`, which is transaction start and therefore
   * precedes the wait for the row lock: a request that queued behind another writer
   * would stamp its rows with the instant it arrived, and could close a row that
   * committed while it waited at a timestamp before that row began.
   */
  private async nowWithin(trx: Transaction<Database>): Promise<Date> {
    const row = await trx
      .selectNoFrom((eb) => eb.fn<Date>('clock_timestamp', []).as('at'))
      .executeTakeFirstOrThrow();

    return row.at;
  }
}

/**
 * Whether two wall-clock times are the same time.
 *
 * **Not `===`, and a test is what found that.** PostgreSQL renders `time` as
 * `HH:MM:SS` while section 22's DTO accepts `HH:MM` or `HH:MM:SS`, so a leader
 * resubmitting the time their Cell already meets at, written the shorter way, gets
 * `19:00` compared against a stored `19:00:00` and slips past the refusal above.
 * What that records is a schedule boundary where nothing happened — the exact thing
 * the refusal exists to prevent, reached through a formatting difference.
 *
 * Seconds default to zero rather than being required, because the column has second
 * precision and the DTO makes them optional: `19:00` and `19:00:00` are one time, and
 * a comparison that says otherwise is comparing spellings.
 */
function sameTimeOfDay(stored: string, submitted: string): boolean {
  const normalize = (value: string): string => {
    const [hours, minutes, seconds = '00'] = value.split(':');
    return `${hours}:${minutes}:${seconds}`;
  };

  return normalize(stored) === normalize(submitted);
}
