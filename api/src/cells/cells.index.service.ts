import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuthorizationService,
  type Actor,
  type ScopeMembership,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { canonicalId } from '../common/identifiers';
import { assertReportingPeriodHasBegun } from '../common/time/reporting-period';
import { databaseNow, reportingMonthOf, windowClosesAt } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

import { decodeCellIndexCursor, encodeCellIndexCursor } from './cell-index-cursor';
import { CellsReadService } from './cells.read.service';
import { RECORDED_MEETINGS_PORT, type RecordedMeetingsPort } from './recorded-meetings.port';

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

/**
 * `GET /api/v1/cells` — the Cells of the actor's scope (SKILL.md sections 10, 12, 19 and
 * 22; decision 0226).
 *
 * **It exists because every other route under this prefix takes an identifier nothing
 * handed the caller.** `GET /cells/{id}/members`, `GET /cells/{id}/meetings`, the meeting
 * roster and both submit routes were unreachable from a screen, and the coverage ledger
 * could not see it: that check asks whether every route has a screen and never whether
 * every screen has its routes.
 *
 * **One route serving two of section 19's dashboards, and `?led_by=me` is the filter
 * between them.** The Cell-leader dashboard leads with "the user's own Cells" and the
 * upline dashboard with "Cells needing attention within their scope"; a route serving
 * only the first cannot serve the second, and two routes would put one scope rule in two
 * places.
 *
 * **The filter narrows an authorized set and never widens one**, which is the security
 * property of this file. `?led_by=me` is applied as an *intersection* with what
 * `scopeMembership` returned rather than as a replacement for it, so an actor whose grant
 * does not reach themselves — `SUBTREE_EXCL_SELF` is the scope value that does not — sees
 * nothing rather than seeing their own Cells by asking for them. Decision 0226 makes the
 * filter "the narrower of two readings of one scope, not a second authorization", and
 * replacing the set is precisely how that sentence would stop being true.
 *
 * **`cell.view_subtree` and no new capability** (decision 0226). It is a Read capability,
 * it is grantable `read_only`, and decision 0204 already moved `GET /cells/{id}/members`
 * onto it on the same reasoning: roster visibility guarded by a management capability
 * could not be granted at all, because a management capability granted `read_only` is
 * refused at creation. A list of Cells is the same kind of read as the roster of one.
 *
 * **Never ordered by coverage, and no row carries a grade** (sections 13, 17 and 19). The
 * order is `cell_id`, which section 10 makes meaningless by design, so the list ranks
 * nobody. A list of Cells ordered worst-first is a leaderboard whatever it is called, and
 * it is the ordering a reader reaches for first — which is why the order is decided in
 * `cellsInScope` rather than left to a caller's `sort`.
 */
@Injectable()
export class CellsIndexService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly cells: CellsReadService,
    private readonly people: PeopleReadService,
    private readonly authorization: AuthorizationService,
    /**
     * The coverage numerator, from the module owning `cell_meetings` (section 2).
     *
     * `@Optional()` on the ruling of 2026-09-01: an inversion port is optional so that a
     * missing binding costs one operation rather than the whole application, and the
     * operation then **refuses** rather than skipping what the port answered. Section 2
     * requires both halves, and the second is the one that matters here — skipping would
     * publish `0 of 5 meetings recorded` for every Cell in the church, which reads as an
     * accusation rather than as a wiring fault.
     */
    @Optional()
    @Inject(RECORDED_MEETINGS_PORT)
    private readonly recorded?: RecordedMeetingsPort,
  ) {}

  async list(
    actor: Actor,
    query: { month: string; ledBy?: 'me'; limit?: number; cursor?: string },
  ): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(query.month);

    // **A period that has not begun is refused rather than answered** (section 20, decision
    // 0216). A first version of this route answered `200` with a null coverage line, which
    // is a third answer to a question section 20 already settles — and it left the response
    // saying `open: true` about a month that had not started, which section 20 names as the
    // state its own flag cannot correct.
    //
    // *Whether this route is a "report" in section 20's sense is the part nobody has ruled
    // on, and it is recorded as a Stop Condition in `CLAUDE.md`: section 15 states two
    // figures per row with no alternative, section 20 refuses the request outright, and
    // this list sits between them. The refusal is the conservative arm — it publishes
    // nothing rather than publishing a figure no rule authorises.*
    //
    // The DCC events index deliberately does **not** do this: section 9 runs its calendar
    // thirteen months ahead and wants a future Sunday visible, so that route lists the
    // event and gives it no coverage. The figures differ in kind — a Cell's denominator is
    // a schedule count, which section 17 licenses moving within an open month, and a DCC
    // one is a count of obligations, which do not exist until the service has happened.
    await assertReportingPeriodHasBegun(this.db, reportingMonth);
    const limit = query.limit ?? DEFAULT_PAGE;
    const after = decodeCellIndexCursor(query.cursor);

    const membership = await this.authorization.scopeMembership(actor, Capability.CellViewSubtree);
    const leaderIds = leadersToList(membership, actor, query.ledBy === 'me');

    // One instant for the whole page, read from the database rather than from this host
    // (decision 0160): the category and schedule joins and the window decision below are
    // one question about one moment, and two clock readings a few microseconds apart can
    // straddle a month boundary.
    const now = await databaseNow(this.db);

    // One more than asked for, so whether another page exists is answered by the read
    // rather than by a second count, and the extra row is dropped before it is returned.
    const rows =
      leaderIds !== null && leaderIds.length === 0
        ? []
        : await this.cells.cellsInScope(this.db, leaderIds, now, {
            limit: limit + 1,
            after: after?.cellId ?? null,
          });

    const visible = rows.slice(0, limit);
    const cellIds = visible.map((row) => row.id);

    // The two halves of section 12's coverage line, arrived at two different ways: the
    // denominator derived from the schedule against the calendar, the numerator counted
    // from rows a leader wrote. That difference is the property section 13 depends on —
    // recording less makes coverage worse and never better — and it is why they are two
    // reads rather than one join.
    const [scheduled, recorded, leaders] = await Promise.all([
      this.cells.scheduledCountsIn(this.db, cellIds, reportingMonth),
      this.recordedCounts(cellIds, reportingMonth),
      this.people.namesOf(visible.map((row) => row.leaderId)),
    ]);

    const open = now.getTime() < windowClosesAt(reportingMonth).getTime();

    const last = visible.at(-1);

    return {
      reporting_month: reportingMonth,
      // Section 17: a report must say whether the period it shows is open, "because an
      // open month's coverage figure is still changing". Every row here carries one.
      open,
      data: visible.map((row) => {
        const leader = leaders.get(row.leaderId);

        return {
          id: row.id,
          cell_id: row.cellId,
          category: row.category,
          schedule: { day_of_week: row.dayOfWeek, time_of_day: row.timeOfDay },
          leader: {
            person_id: row.leaderId,
            member_id: leader?.memberId ?? '',
            full_name: leader?.fullName ?? '',
          },
          // Two figures, never divided (section 12, section 13). A Cell that scheduled
          // nothing reads `0 of 0`, is shown, and is not dropped (decision 0225).
          coverage: {
            recorded: recorded.get(row.id) ?? 0,
            scheduled: scheduled.get(row.id) ?? 0,
          },
        };
      }),
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeCellIndexCursor({ cellId: last.cellId })
          : null,
    };
  }

  /**
   * The numerator, or a refusal where the port is unbound.
   *
   * The refusal is a plain `Error` and therefore an `INTERNAL_ERROR`, which is what an
   * unbound provider is: a deployment fault rather than anything the caller did. It
   * names the token so the fault is diagnosable from one log line, on the precedent
   * `NetworksService` sets for the same situation.
   *
   * **Falsy rather than `=== undefined`, and the difference is what makes the branch
   * testable.** The only way to reach an unbound port from a test is to override the
   * provider, and `useValue(undefined)` does not override — Nest reads an undefined value
   * as no value and falls through to the real provider, which is how the first version of
   * `network-change-port-unbound.e2e.spec.ts` got a `200` and read as a failed
   * precondition. `useValue(null)` overrides, so the check has to admit `null` as well.
   */
  private async recordedCounts(
    cellIds: readonly string[],
    reportingMonth: string,
  ): Promise<Map<string, number>> {
    if (!this.recorded) {
      throw new Error(
        'Cannot list Cells: RECORDED_MEETINGS_PORT is not bound, so the SKILL.md section ' +
          '12 coverage line has no numerator. This is a deployment fault.',
      );
    }

    // Asked even for an empty page, so the unbound refusal does not depend on the page
    // having rows — a wiring fault that surfaced only on a non-empty result would hide
    // behind every empty scope.
    return this.recorded.recordedCountsIn(cellIds, reportingMonth);
  }
}

/**
 * Which leaders' Cells this request may list: `null` for no narrowing at all, or the
 * exact set.
 *
 * **`null` and `[]` are different arguments and the difference is the whole of the
 * authorization here.** `null` is a Whole Church grant, which narrows nothing; `[]` is a
 * caller in scope for nobody, which must list nothing. A single nullable field that
 * conflated them would publish the church on the empty case.
 *
 * **`led_by=me` intersects rather than replaces** (decision 0226). Returning
 * `[actor.personId]` unconditionally is the shorter code and is the mistake: it would make
 * the filter a second authorization, answering a question the actor's grants had not
 * been asked. The intersection makes it what decision 0226 says it is — "the narrower of
 * two readings of one scope, not a second authorization" — so the filter can only ever
 * remove rows the unfiltered list would already have shown.
 *
 * **The empty arm is unreachable through this route today, and is written anyway.** The
 * guard's target is `{ kind: 'actor' }`, so a caller reaching the service holds some
 * grant covering themselves — and every scope value that covers the actor also puts them
 * in this set: `OWN_SUBTREE` walks a subtree including its root, a `NETWORK` grant
 * covering the actor enumerates a membership containing them, and Whole Church returns
 * above. The one scope that excludes the actor, `SUBTREE_EXCL_SELF`, fails the guard
 * before this runs. It is written because the guard's target and this narrowing are two
 * separate decisions that happen to agree, and the agreement is not something this
 * function can check — a widened target or a second caller reaches it, and the honest
 * description is that nothing exercises it rather than that nothing can.
 */
function leadersToList(
  membership: ScopeMembership,
  actor: Actor,
  ledByMe: boolean,
): string[] | null {
  if (membership.kind === 'WHOLE_CHURCH') {
    return ledByMe ? [actor.personId] : null;
  }

  if (!ledByMe) {
    return [...membership.personIds];
  }

  return membership.personIds.has(canonicalId(actor.personId)) ? [actor.personId] : [];
}
