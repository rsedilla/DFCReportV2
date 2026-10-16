import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AuthorizationService,
  type Actor,
  type ScopeMembership,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { SettingsService } from '../admin/settings/settings.service';
import { canonicalId, sameId } from '../common/identifiers';
import { manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { assertReportingPeriodHasBegun } from '../common/time/reporting-period';
import {
  databaseNow,
  monthClosesAt,
  recordClosesAt,
  reportingMonthOf,
} from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { NetworksService } from '../networks/networks.service';
import { PeopleReadService } from '../people/people.read.service';

import { decodeCellIndexCursor, encodeCellIndexCursor } from './cell-index-cursor';
import { CellsReadService } from './cells.read.service';
import { RECORDED_MEETINGS_PORT, type RecordedMeetingsPort } from './recorded-meetings.port';
import { ValidationFailedError } from '../common/errors/api-error';
import { normalizeName } from '../people/duplicate-matching';

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

/** One month of a quiet Cell's window (decision 0355). */
interface QuietMonth {
  month: string;
  did_not_meet: number;
  not_recorded: number;
}

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
    private readonly networks: NetworksService,
    private readonly settings: SettingsService,
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

  /**
   * `GET /api/v1/cells/counts` (decision 0309): how many running Cells the list would show
   * now, for the reader's scope and for the Cells they lead. The same scope and the same
   * filter as {@link list}, counted rather than paged, so the Cells page's totals do not
   * read every Cell with its figures to count it.
   */
  async counts(actor: Actor): Promise<{ in_scope: number; led_by_me: number }> {
    const membership = await this.authorization.scopeMembership(actor, Capability.CellViewSubtree);
    const now = await databaseNow(this.db);

    const [inScope, ledByMe] = await Promise.all([
      this.cells.countCellsInScope(this.db, leadersToList(membership, actor, false), now),
      this.cells.countCellsInScope(this.db, leadersToList(membership, actor, true), now),
    ]);

    return { in_scope: inScope, led_by_me: ledByMe };
  }

  async list(
    actor: Actor,
    query: {
      month: string;
      ledBy?: 'me';
      limit?: number;
      cursor?: string;
      q?: string;
      state?: 'ACTIVE' | 'CLOSED';
      /** Section 15's *Fewer than 3 members* (decision 0353); running Cells only. */
      fewerThanThree?: boolean;
      /** Section 15's *No meeting in 3 months* (decision 0355); running Cells only. */
      noMeeting?: boolean;
    },
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
    // a schedule count, which sections 10 and 13 let move within an open month only by a
    // creation or a closure, and a DCC one is a count of obligations, which do not exist
    // until the service has happened. *An earlier version credited section 17 with
    // licensing the denominator; section 17 requires the open flag to be shown and says
    // nothing about a denominator, and section 10 is what fixes one — "a month therefore
    // has exactly one schedule throughout".*
    await assertReportingPeriodHasBegun(this.db, reportingMonth, {
      // This route's period field is `month` and the client sent an unnormalised day, so
      // the refusal names both rather than the helper's defaults (section 22).
      field: 'month',
      value: query.month,
    });
    const limit = query.limit ?? DEFAULT_PAGE;
    const after = decodeCellIndexCursor(query.cursor);

    // **The minimum is counted on the term as it is searched**, as the Person search counts
    // it (decision 0259): `a-`, ` a` and `  ` each pass the DTO's bound and would search for
    // one letter, or for nothing at all.
    if (query.q !== undefined && normalizeName(query.q).replace(/\s+/g, '').length < 2) {
      throw new ValidationFailedError('Enter at least two letters of a name or Cell ID.', {
        field: 'q',
      });
    }

    const membership = await this.authorization.scopeMembership(actor, Capability.CellViewSubtree);
    const leaderIds = leadersToList(membership, actor, query.ledBy === 'me');

    // One instant for the whole page, read from the database rather than from this host
    // (decision 0160): the category and schedule joins and the window decision below are
    // one question about one moment, and two clock readings a few microseconds apart can
    // straddle a month boundary.
    const now = await databaseNow(this.db);

    if (query.state === 'CLOSED') {
      if (query.fewerThanThree) {
        // Section 15's list is of running Cells (decision 0353); accepted and ignored here it
        // would answer closed Cells to a question about small ones (section 22).
        throw new ValidationFailedError(
          'fewer_than_three lists running Cells and cannot be asked of the closed view.',
          { field: 'fewer_than_three' },
        );
      }
      if (query.noMeeting) {
        throw new ValidationFailedError(
          'no_meeting lists running Cells and cannot be asked of the closed view.',
          { field: 'no_meeting' },
        );
      }
      return this.listClosed(actor, leaderIds, reportingMonth, now, limit, after, query.q);
    }

    // Closing needs `cell.manage_lifecycle` at Whole Church (decision 0355), so whether this
    // reader may close is one answer for every row, given by the server.
    const mayClose =
      (await this.authorization.scopeMembership(actor, Capability.CellManageLifecycle)).kind ===
      'WHOLE_CHURCH';

    let rows: Awaited<ReturnType<CellsReadService['cellsInScope']>>;
    let window: { months: string[]; quiet: Map<string, QuietMonth[]> } | null = null;

    if (query.noMeeting) {
      // **Read whole, then paged** (decision 0355): whether a Cell is quiet is answered from
      // another module's records and from each meeting's deadline, which no single query
      // here can filter on. A church holds some hundreds of Cells, so the scope is read once
      // and the page is cut from the Cells that qualify, in the same `cell_id` order.
      const months = await this.attentionWindow(now);
      const candidates =
        leaderIds !== null && leaderIds.length === 0
          ? []
          : await this.cells.cellsInScope(this.db, leaderIds, now, {
              limit: 100_000,
              search: query.q ?? null,
              fewerThanThree: query.fewerThanThree ?? false,
              createdBefore: startOfManilaDay(months[0]),
            });
      // Refused rather than cut short: a scope this large would list part of the church as
      // the whole of it. A church holds some hundreds of Cells.
      if (candidates.length >= 100_000) {
        throw new Error('Cannot list Cells with no meeting: the scope holds too many Cells.');
      }
      const quiet = await this.quietMonths(
        candidates.map((row) => row.id),
        months,
        now,
      );
      window = { months, quiet };
      rows = candidates
        .filter((row) => quiet.has(row.id))
        .filter((row) => after === null || after === undefined || row.cellId > after.cellId)
        .slice(0, limit + 1);
    } else {
      // One more than asked for, so whether another page exists is answered by the read
      // rather than by a second count, and the extra row is dropped before it is returned.
      rows =
        leaderIds !== null && leaderIds.length === 0
          ? []
          : await this.cells.cellsInScope(this.db, leaderIds, now, {
              limit: limit + 1,
              after: after?.cellId ?? null,
              search: query.q ?? null,
              fewerThanThree: query.fewerThanThree ?? false,
            });
    }

    const visible = rows.slice(0, limit);
    const cellIds = visible.map((row) => row.id);

    // The two halves of section 12's coverage line, arrived at two different ways: the
    // denominator derived from the schedule against the calendar, the numerator counted
    // from rows a leader wrote. That difference is the property section 13 depends on —
    // recording less makes coverage worse and never better — and it is why they are two
    // reads rather than one join.
    const [scheduled, dueDays, recorded, recordedDates, leaders, networks] = await Promise.all([
      this.cells.scheduledCountsIn(this.db, cellIds, reportingMonth),
      this.cells.dueDaysIn(this.db, cellIds, reportingMonth, manilaDayOf(now)),
      this.recordedCounts(cellIds, reportingMonth),
      this.recordedDates(cellIds, reportingMonth),
      this.people.namesOf(visible.map((row) => row.leaderId)),
      this.networks.networksOf(
        this.db,
        visible.map((row) => row.leaderId),
        now,
      ),
    ]);

    const open = now.getTime() < monthClosesAt(reportingMonth).getTime();

    const last = visible.at(-1);

    return {
      reporting_month: reportingMonth,
      // Section 17: a report must say whether the period it shows is open, "because an
      // open month's coverage figure is still changing". Every row here carries one.
      open,
      ...(window === null ? {} : { no_meeting_months: window.months }),
      data: visible.map((row) => {
        const leader = leaders.get(row.leaderId);

        return {
          id: row.id,
          cell_id: row.cellId,
          state: 'ACTIVE',
          category: row.category,
          schedule: { day_of_week: row.dayOfWeek, time_of_day: row.timeOfDay },
          member_count: row.memberCount,
          // The Cell's Network is its leader's (section 10), read now rather than as of the
          // month: it is what a membership added today is checked against. A picker narrows
          // on it; the add route still decides.
          network: networks.get(row.leaderId) ?? null,
          leader: {
            person_id: row.leaderId,
            member_id: leader?.memberId ?? '',
            full_name: leader?.fullName ?? '',
          },
          // Two figures, never divided (section 12, section 13). A Cell that scheduled
          // nothing reads `0 of 0`, is shown, and is not dropped (decision 0225). `behind`
          // is the meetings whose day has begun that have no record (decision 0267); nothing
          // keys on `scheduled`, which is the whole month (decision 0239).
          coverage: {
            recorded: recorded.get(row.id) ?? 0,
            scheduled: scheduled.get(row.id) ?? 0,
            behind: behindIn(dueDays, recordedDates, row.id, now),
          },
          may_close: mayClose,
          ...(window === null ? {} : { no_meeting: window.quiet.get(row.id) ?? [] }),
        };
      }),
      next_cursor:
        rows.length > limit && last !== undefined
          ? encodeCellIndexCursor({ cellId: last.cellId })
          : null,
    };
  }

  /**
   * The *No meeting* window (decision 0355): the last finished Manila months, as many as
   * the church-wide attention setting says (section 15), oldest first, as `YYYY-MM-01`.
   */
  private async attentionWindow(now: Date): Promise<string[]> {
    const count = await this.settings.cellAttentionMonthsWithin(this.db);
    const [year, month] = reportingMonthOf(manilaDayOf(now)).split('-').map(Number);

    return Array.from({ length: count }, (_, index) => {
      const first = new Date(Date.UTC(year, month - 1 - count + index, 1));
      return first.toISOString().slice(0, 10);
    });
  }

  /**
   * For each Cell, the window's months with how many meetings were recorded as not held and
   * how many have no record — present only where the Cell qualifies (decision 0355): no
   * meeting held in the window, and none with no record whose week is still open to
   * recording (decision 0335). A move still planned is neither held nor counted.
   */
  private async quietMonths(
    cellIds: readonly string[],
    months: readonly string[],
    now: Date,
  ): Promise<Map<string, QuietMonth[]>> {
    const today = manilaDayOf(now);
    const read = await Promise.all(
      months.map(async (month) => {
        const [year, monthNumber] = month.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
        const [due, statuses] = await Promise.all([
          this.cells.dueDaysIn(this.db, cellIds, month, lastDay),
          this.recordedStatuses(cellIds, month, today),
        ]);
        return { month, due, statuses };
      }),
    );

    const quiet = new Map<string, QuietMonth[]>();
    for (const cellId of cellIds) {
      let held = false;
      let stillInTime = false;
      const counts: QuietMonth[] = [];

      for (const { month, due, statuses } of read) {
        const recorded = statuses.get(cellId) ?? new Map<string, string>();
        let didNotMeet = 0;
        let notRecorded = 0;

        for (const outcome of recorded.values()) {
          if (outcome === 'held') {
            held = true;
          } else if (outcome === 'notHeld') {
            didNotMeet += 1;
          }
        }
        for (const day of due.get(cellId) ?? []) {
          if (recorded.has(day)) {
            continue;
          }
          if (now.getTime() < recordClosesAt(day).getTime()) {
            stillInTime = true;
          } else {
            notRecorded += 1;
          }
        }
        counts.push({ month, did_not_meet: didNotMeet, not_recorded: notRecorded });
      }

      if (!held && !stillInTime) {
        quiet.set(cellId, counts);
      }
    }
    return quiet;
  }

  /** The records with their outcome, or a refusal where the port is unbound (as {@link recordedCounts}). */
  private async recordedStatuses(
    cellIds: readonly string[],
    reportingMonth: string,
    today: string,
  ): Promise<Map<string, Map<string, 'held' | 'notHeld' | 'planned'>>> {
    if (!this.recorded) {
      throw new Error(
        'Cannot list Cells: RECORDED_MEETINGS_PORT is not bound, so which Cells held no ' +
          'meeting cannot be known. This is a deployment fault.',
      );
    }

    return this.recorded.recordedStatusesIn(cellIds, reportingMonth, today);
  }

  /**
   * The `CLOSED` view (decision 0266): the closed Cells whose last leader the actor's
   * `cell.view_subtree` reaches, each with what it closed on and why, and whether this
   * actor may request its restart (decision 0264).
   *
   * **`may_restart` is the server's answer and never a client's derivation** (section 7).
   * It is the scope half of what a restart request checks — `cell.request_leadership`
   * over the last leader, who must never be the actor, and `cell.manage_lifecycle` over the
   * same person (decision 0265) — with the Cell's own state: not closed as created in
   * error, and not already restarted. It does not replay the request's refusals about
   * the leader themselves; a submission refused for one of those answers in its own
   * words.
   */
  private async listClosed(
    actor: Actor,
    leaderIds: string[] | null,
    reportingMonth: string,
    now: Date,
    limit: number,
    after: ReturnType<typeof decodeCellIndexCursor>,
    q: string | undefined,
  ): Promise<Record<string, unknown>> {
    const rows =
      leaderIds !== null && leaderIds.length === 0
        ? []
        : await this.cells.closedCellsInScope(this.db, leaderIds, {
            limit: limit + 1,
            after: after?.cellId ?? null,
            search: q ?? null,
          });

    const visible = rows.slice(0, limit);
    const cellIds = visible.map((row) => row.id);

    const [scheduled, dueDays, recorded, recordedDates, leaders, mayRequest, mayManage] =
      await Promise.all([
        this.cells.scheduledCountsIn(this.db, cellIds, reportingMonth),
        this.cells.dueDaysIn(this.db, cellIds, reportingMonth, manilaDayOf(now)),
        this.recordedCounts(cellIds, reportingMonth),
        this.recordedDates(cellIds, reportingMonth),
        this.people.namesOf(visible.map((row) => row.leaderId)),
        this.authorization.scopeMembership(actor, Capability.CellRequestLeadership),
        this.authorization.scopeMembership(actor, Capability.CellManageLifecycle),
      ]);

    const last = visible.at(-1);

    return {
      reporting_month: reportingMonth,
      open: now.getTime() < monthClosesAt(reportingMonth).getTime(),
      data: visible.map((row) => {
        const leader = leaders.get(row.leaderId);

        return {
          id: row.id,
          cell_id: row.cellId,
          state: 'CLOSED',
          category: row.category,
          schedule: { day_of_week: row.dayOfWeek, time_of_day: row.timeOfDay },
          member_count: 0,
          leader: {
            person_id: row.leaderId,
            member_id: leader?.memberId ?? '',
            full_name: leader?.fullName ?? '',
          },
          coverage: {
            recorded: recorded.get(row.id) ?? 0,
            scheduled: scheduled.get(row.id) ?? 0,
            behind: behindIn(dueDays, recordedDates, row.id, now),
          },
          closed_on: manilaDayOf(row.closedAt),
          closure_reason: row.closureReason,
          // What the Senior Pastors read (decision 0355); none on a Cell closed before it.
          closure_explanation: row.closureNote,
          restarted_as: row.restartedAs,
          // The category and day that Cell opened with, to name it without its code (decisions 0306, 0347).
          restarted_as_category: row.restartedAsCategory,
          restarted_as_day_of_week: row.restartedAsDayOfWeek,
          may_restart:
            row.closureReason !== 'CREATED_IN_ERROR' &&
            row.restartedAs === null &&
            !sameId(row.leaderId, actor.personId) &&
            reaches(mayRequest, row.leaderId) &&
            reaches(mayManage, row.leaderId),
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
   * **Falsy rather than `=== undefined`, and it is the test that needs the width rather
   * than production.** Nest injects `undefined` for an unresolved `@Optional()` token, so
   * `undefined` is the only state a deployment produces. A test overriding the *token*
   * cannot reach it: `useValue(undefined)` does not override, because Nest reads an
   * undefined value as no value and falls through to the real provider, which is how the
   * first version of `network-change-port-unbound.e2e.spec.ts` got a `200` and read as a
   * failed precondition. `useValue(null)` overrides, so the check admits `null` too.
   *
   * *A `=== null` check — the defect `ADMIN_ACCOUNTS_PORT` shipped with — cannot be
   * written here: `recorded` is declared `?:`, so its type holds no `null` and the
   * comparison is a type error. That port's field is declared `| null`, which is what
   * made the dead check compile there.*
   *
   * *This paragraph claimed overriding the provider was "the only way to reach an unbound
   * port from a test". That is false. `TestingModuleBuilder.overrideModule` replaces the
   * binding module and reproduces the deployment fault exactly, and
   * `cells-index-port-unbound.e2e.spec.ts` now does both. What that second block catches,
   * verified by running the mutation, is the removal of `@Optional()` above: section 2
   * requires an unbound inversion port to cost one operation rather than the whole
   * application, and without it the application cannot be built at all — which the
   * `null`-only suite stayed green through.*
   */
  /** The records by date, or a refusal where the port is unbound (as {@link recordedCounts}). */
  private async recordedDates(
    cellIds: readonly string[],
    reportingMonth: string,
  ): Promise<Map<string, Set<string>>> {
    if (!this.recorded) {
      throw new Error(
        'Cannot list Cells: RECORDED_MEETINGS_PORT is not bound, so which meetings are ' +
          'behind cannot be known. This is a deployment fault.',
      );
    }

    return this.recorded.recordedDaysIn(cellIds, reportingMonth);
  }

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

function reaches(membership: ScopeMembership, personId: string): boolean {
  return membership.kind === 'WHOLE_CHURCH' || membership.personIds.has(canonicalId(personId));
}

/**
 * The due meetings of one Cell that have no record (decision 0267): matched date by date,
 * as `BranchFiguresService` matches, rather than one count subtracted from another. A
 * record whose date is no longer due — a meeting recorded before a closure was backdated
 * past it — offsets nothing.
 */
function behindIn(
  dueDays: Map<string, string[]>,
  recordedDates: Map<string, Set<string>>,
  cellId: string,
  now: Date,
): number {
  const recorded = recordedDates.get(cellId);
  // Only a meeting whose week is still open: one only an Admin can still record is behind
  // on no surface (owner, 2026-10-13, decision 0335).
  return (dueDays.get(cellId) ?? []).filter(
    (day) => !recorded?.has(day) && now.getTime() < recordClosesAt(day).getTime(),
  ).length;
}
