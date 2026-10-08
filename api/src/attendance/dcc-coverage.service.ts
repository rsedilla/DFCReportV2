import { Inject, Injectable } from '@nestjs/common';

import { AccountsRepository } from '../auth/accounts.repository';
import {
  AuthorizationService,
  type Actor,
  type ScopeMembership,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { NotFoundError } from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { decodeRosterCursor, encodeRosterCursor, type RosterCursor } from '../common/roster-cursor';
import { startOfManilaDay } from '../common/time/manila';
import { assertReportingMonth } from '../common/time/reporting-period';
import { databaseNow, reportingMonthOf, windowClosesAt } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import type { NetworkName } from '../database/schema';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';
import { PeopleReadService } from '../people/people.read.service';

import { type NotRecordable } from './dcc-attendance.service';
import { recordingInstant } from './recording-instant';

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

interface EventRow {
  id: string;
  eventDate: string;
  removedAt: Date | null;
  removalReason: string | null;
  at: Date;
  notRecordable: NotRecordable | null;
}

/** One event's coverage, as the two figures section 13 forbids dividing. */
interface Coverage {
  met: number;
  owed: number;
}

/**
 * Which population a monthly coverage figure is measured over (section 20).
 *
 * **Deliberately not `DccReportScope`.** That type is `reporting`'s and carries the wire
 * spelling of a selector; this one names what the denominator is narrowed by, and the two
 * differ where it matters — a report's `LEADER` is a *selector* resolved for
 * authorization at the period's end, while this one is a subtree walked at each event
 * date. Sharing a type would make the two look like one decision.
 */
export type DccCoverageScope =
  | { kind: 'WHOLE_CHURCH' }
  | { kind: 'NETWORK'; network: NetworkName }
  | { kind: 'LEADER'; personId: string };

/**
 * The DCC calendar as a leader reads it, and the gap behind each coverage figure
 * (SKILL.md sections 9, 15, 19 and 22; decisions 0227 and 0228).
 *
 * **Two routes, one rule, and that is why they are one service.** The index states how
 * many responsible leaders in the actor's scope have a record for each event; the
 * drill-down names the ones who do not. A denominator computed by one set of rules and a
 * list computed by another would disagree, and a leader would meet the disagreement as a
 * figure of `7 of 8` beside a list of two names.
 *
 * **`dcc.view_subtree` guards both, and not `dcc.take_attendance`** (decision 0227). The
 * roster is guarded by the recording capability on section 7's argument that reaching an
 * attendance surface must not require a management capability; copying that here is wrong
 * for a reason that argument does not reach. Each row carries a **scoped** figure, and a
 * recording capability names no subtree to measure one over. `dcc.view_subtree` does, it
 * is a Read capability, and it is grantable `read_only` — which a figure somebody may
 * read without recording anything should be.
 *
 * **What an obligation is.** Section 20 attributes coverage "by the obligation rather
 * than by the record", and decision 0224 makes that arithmetic: a leader owes one record
 * for each event they were the responsible leader at. So the denominator is the leaders
 * holding at least one pastoral edge at the event's instant, and the numerator is those
 * of them carrying at least one live `dcc_attendance` row for the event. Section 9 fixes
 * the reading of "at least one": coverage "measures whether the record exists, never who
 * entered it", so a submission made on behalf completes that leader's coverage.
 *
 * **A root owes records and is never owed one.** A root's own attendance carries no
 * responsible leader, so it belongs to nobody's obligation; a root with disciples owes
 * records for them like any other leader. Both fall out of `edgesAsOf` answering about
 * edges — section 9's "roots are excluded from coverage denominators" needs no filter.
 *
 * **A figure this publishes is period-based, so nothing here reads a current state.**
 * Section 3 forbids it in terms: a period's total must not move when somebody is archived
 * today, and period-based figures are "never filtered by current lifecycle state". That
 * is why an archived disciple's edge still counts as an obligation, and why whether it
 * *should* — the argument being that such a leader can record nothing — is recorded as
 * open in `CLAUDE.md` rather than settled in this file.
 *
 * **Nothing here is ranked, ordered by coverage, or colour-graded** (sections 13, 17 and
 * 19). The events are ordered by date, which is what a calendar is; the gap list is
 * ordered by name, which section 15 permits and which says nothing about who is furthest
 * behind. Decision 0228 makes the scope the whole of the constraint: the same data shown
 * church-wide and ordered by how many records are missing is the leaderboard section 13
 * exists to prevent.
 */
@Injectable()
export class DccCoverageService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
    private readonly networks: NetworksService,
    private readonly authorization: AuthorizationService,
    private readonly accounts: AccountsRepository,
  ) {}

  /**
   * `GET /api/v1/dcc/events?month=YYYY-MM-01` — the month's events (decision 0227).
   *
   * **A month rather than a rolling window**, because a month is the unit section 9
   * already uses for the submission window, for coverage and for the reporting routes —
   * and because the deciding case is a removed Sunday. Section 9 is emphatic that a
   * removal "always means a row that records a decision" while a missing row "is never a
   * decision", and a month view shows the removal in its place where a window would slide
   * past a gap without naming it.
   *
   * **Not paginated, and that is a property of the calendar rather than a choice.** A
   * month holds four or five Sundays. Section 22 asks a collection to page because its
   * size is a function of the data; this one's size is arithmetic, exactly as
   * `GET /api/v1/cells/{id}/meetings` argues for the same shape one domain over.
   */
  async eventsIn(
    actor: Actor,
    month: string,
    withCoverage = true,
  ): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(month);
    assertReportingMonth(reportingMonth);

    const now = await databaseNow(this.db);
    const rows = await this.db
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', reportingMonth)
      .where('event_date', '<', nextMonth(reportingMonth))
      .orderBy('event_date')
      .execute();

    const events = rows.map((row) => this.describe(String(row.event_date), row, now));
    // Asked for no coverage, nothing reads the reader's branch: each line answers `null`.
    const membership = withCoverage
      ? await this.authorization.scopeMembership(actor, Capability.DccViewSubtree)
      : null;

    const rendered = await Promise.all(
      events.map(async (event) => ({
        event,
        // **An event nobody could yet have recorded carries no coverage, and the null is
        // the answer rather than a zero.** Decision 0227 gives that reading for a removed
        // Sunday — nobody owes a record for a service that was not held, and `0 of 0`
        // would say the obligations were all discharged. A Sunday whose Manila day has
        // not begun is the same sentence with the more damaging falsehood on the other
        // side: `0 of 8` says eight leaders have failed to record a service that has not
        // happened, and section 9 defines the gap only for "an event that did take
        // place".
        //
        // **A closed month is not in this branch and must not be.** Its coverage is the
        // frozen historical figure sections 13 and 20 require a report to keep showing;
        // withholding it would hide the month the window closed on.
        coverage:
          membership !== null && coverable(event)
            ? await this.coverageOf(this.db, event, leadersOf(membership))
            : null,
      })),
    );

    return {
      reporting_month: reportingMonth,
      // Section 17: a view must say whether the period it shows is open, because an open
      // month's coverage figure is still changing.
      open: now.getTime() < windowClosesAt(reportingMonth).getTime(),
      data: rendered.map(({ event, coverage }) => ({
        id: event.id,
        event_date: event.eventDate,
        recordable: event.notRecordable === null,
        not_recordable_reason: event.notRecordable,
        removed: event.removedAt !== null,
        removal_reason: event.removalReason,
        // Two figures, never divided (section 9, section 13).
        coverage: coverage === null ? null : { met: coverage.met, owed: coverage.owed },
      })),
    };
  }

  /**
   * `GET /api/v1/dcc/events/{id}/coverage-gaps` — who owes a record (decision 0228).
   *
   * **An attention list on section 15's terms**, which is what makes naming leaders
   * defensible rather than a leaderboard: filtered to the actor's own scope, ordered by
   * name, never by how far behind anybody is, and carrying no grade. Section 19 is the
   * reason it exists at all — "a dashboard of counts tells a leader nothing to act on" —
   * and section 14 is the act it enables, since an upline may record on behalf of a
   * downline leader within their pastoral subtree.
   *
   * **Nothing new is disclosed.** Every roster line already carries
   * `responsible_leader_id`, and decision 0194 settles that the DCC roster publishes
   * per-person figures by design. This is the same fact one level up, over people the
   * actor may already see.
   *
   * **An event nobody could have recorded yet has no gaps rather than every leader in
   * it**, on the same predicate the index uses: a removed Sunday and one whose Manila day
   * has not begun both owe nothing. *This named the removed case alone for one commit,
   * including the commit that added the second.*
   */
  async coverageGaps(
    eventId: string,
    actor: Actor,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<Record<string, unknown>> {
    const now = await databaseNow(this.db);
    const row = await this.db
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('id', '=', eventId)
      .executeTakeFirst();

    if (row === undefined) {
      throw new NotFoundError('No such DCC event.', { event_id: eventId });
    }

    const event = this.describe(String(row.event_date), row, now);
    const membership = await this.authorization.scopeMembership(actor, Capability.DccViewSubtree);

    // The same rule the index applies to the figure: an event nobody could have recorded
    // yet owes nobody, and naming leaders for one would put an entry on a section 15
    // attention list that no act can resolve.
    const owing = coverable(event)
      ? (await this.obligations(this.db, event, leadersOf(membership))).owing
      : new Set<string>();

    // Names, so a leader recognises who they are being asked about — and the ordering
    // key, which is section 8's directory order and the key three other collections in
    // this API already page by.
    const identities = await this.people.forDecisionsWithin(this.db, [...owing]);
    const lines = [...owing]
      .map((personId) => {
        const identity = identities.get(personId);

        return {
          personId,
          memberId: identity?.memberId ?? '',
          fullName: identity?.fullName ?? '',
          lastName: identity?.lastName ?? '',
          firstName: identity?.firstName ?? '',
        };
      })
      .sort((left, right) => compareKeys(keyOf(left), keyOf(right)));

    const after = decodeRosterCursor(page.cursor);
    const limit = page.limit ?? DEFAULT_PAGE;

    // `-1` means the cursor is past every line, which is the last page rather than the
    // first: slicing from it would restart the collection, which is the silent behaviour
    // section 22 refuses a cursor over. The same arithmetic the roster route uses, for
    // the same reason — this list is assembled in application code and has no single
    // query to key.
    const beyond =
      after === null ? 0 : lines.findIndex((line) => compareKeys(keyOf(line), after) > 0);
    const start = beyond === -1 ? lines.length : beyond;

    const window = lines.slice(start, start + limit);
    const more = start + limit < lines.length;

    return {
      event: {
        id: event.id,
        event_date: event.eventDate,
        recordable: event.notRecordable === null,
        not_recordable_reason: event.notRecordable,
        removed: event.removedAt !== null,
        removal_reason: event.removalReason,
      },
      data: window.map((line) => ({
        person_id: line.personId,
        member_id: line.memberId,
        full_name: line.fullName,
      })),
      next_cursor: more ? encodeRosterCursor(keyOf(window[window.length - 1])) : null,
    };
  }

  /**
   * One event's coverage over the actor's scope, as two figures.
   *
   * Both terms come from {@link obligations}, so the index's denominator and the
   * drill-down's list are the same set by construction rather than by two queries
   * agreeing.
   */
  private async coverageOf(
    executor: Db,
    event: EventRow,
    leaderIds: readonly string[] | null,
  ): Promise<Coverage> {
    const { owed, owing } = await this.obligations(executor, event, leaderIds);

    return { met: owed.size - owing.size, owed: owed.size };
  }

  /**
   * `GET /api/v1/reports/dcc/monthly`'s coverage line — the month's obligations met over
   * the month's obligations owed (SKILL.md sections 9 and 20; decisions 0224 and 0230).
   *
   * **Summed across the month's events, and never divided** (section 13). Decision 0224
   * settles that a month's figure is the number of leader-events with a record over the
   * number owed, rather than the mean of the per-event ratios — which would weight a
   * holiday Sunday involving two leaders as heavily as a full one, making the line a
   * property of the calendar's shape rather than of what was recorded.
   *
   * **The narrowing is resolved per event, at that event's own instant**, which is what
   * makes a mid-month arrival correct without a rule of its own: section 20 fixes
   * coverage's instant as the event date and decision 0221 declined to move it, so a
   * leader assigned in the third week is absent from the first two weeks' denominators
   * and nothing has to subtract them. It is deliberately **not**
   * `HierarchyService.reportingSubtree`, which is section 20's placement graph collapsed
   * over the period and is what the person key and the responsible-leader key use. Two
   * different walks in one response is what section 20 requires in terms: "a monthly
   * report resolves the tree at more than one instant".
   *
   * **A `NETWORK` scope resolves membership at the event date too** (decision 0230), for
   * the same reason and by the same instant. `peopleInNetworkAsOf` is the population
   * reading rather than `networkAsOf`'s latest-row one, which is what decision 0219 makes
   * a Network's population mean.
   *
   * **An event nobody could have recorded contributes to neither term**, on the same
   * predicate the index applies to a per-event figure: a removed Sunday and one whose
   * Manila day has not begun owe nobody, so they add zero to both. A closed month is not
   * in that class and its obligations are real.
   *
   * **`0 of 0` is an answer rather than an absence** (decision 0224). A scope with nobody
   * responsible for anybody has nothing to report and says so, and the caller renders the
   * line rather than suppressing it.
   *
   * Sequentially rather than with `Promise.all`, because the caller hands this the
   * report's own transaction (decision 0210) and a transaction is one connection.
   */
  async monthCoverage(
    reportingMonth: string,
    scope: DccCoverageScope,
    options: { executor?: Db } = {},
  ): Promise<Coverage> {
    let met = 0;
    let owed = 0;

    // The line is the sum of the per-leader rows, so the two cannot disagree (decision 0254).
    for (const line of (
      await this.monthCoverageByLeader(reportingMonth, scope, options)
    ).values()) {
      met += line.met;
      owed += line.owed;
    }

    return { met, owed };
  }

  /**
   * The same month's coverage, one line per responsible leader (decision 0254).
   *
   * **Each line counts that leader's own obligations and no one else's**: one per event
   * they held a pastoral edge at, met where a live record names them. An obligation has
   * one owner, so the lines sum to {@link monthCoverage} — which is computed from them.
   */
  async monthCoverageByLeader(
    reportingMonth: string,
    scope: DccCoverageScope,
    options: { executor?: Db } = {},
  ): Promise<Map<string, Coverage>> {
    assertReportingMonth(reportingMonth);

    return this.coverageByLeaderBetween(reportingMonth, nextMonth(reportingMonth), scope, options);
  }

  /**
   * Coverage over the Sundays between two calendar dates, both included (decision 0294): the
   * month's rule on another length, summed over the range's events exactly as a month sums
   * over its own. A range that is exactly a month answers what {@link monthCoverage} answers.
   */
  async rangeCoverage(
    from: string,
    to: string,
    scope: DccCoverageScope,
    options: { executor?: Db } = {},
  ): Promise<Coverage> {
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);

    let met = 0;
    let owed = 0;
    for (const line of (
      await this.coverageByLeaderBetween(from, next.toISOString().slice(0, 10), scope, options)
    ).values()) {
      met += line.met;
      owed += line.owed;
    }

    return { met, owed };
  }

  /** Coverage by leader over events dated from `from` up to, not including, `before`. */
  private async coverageByLeaderBetween(
    from: string,
    before: string,
    scope: DccCoverageScope,
    options: { executor?: Db },
  ): Promise<Map<string, Coverage>> {
    const executor = options.executor ?? this.db;
    const now = await databaseNow(executor);

    const rows = await executor
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', from)
      .where('event_date', '<', before)
      .orderBy('event_date')
      .execute();

    const lines = new Map<string, Coverage>();
    const events = rows
      .map((row) => this.describe(String(row.event_date), row, now))
      .filter((event) => coverable(event));

    if (events.length === 0) {
      return lines;
    }

    // `obligations` at each event, from one read of the edges, one of the records and, for a
    // leader, one of the branch (checklist row perf-year-view): one query per Sunday cost a
    // large upline leader's year view about 1.4 s on `seed:perf`'s church.
    const instants = events.map((event) => event.at);
    const narrowing = await this.leadersAtEach(executor, scope, instants);
    const edgesAt = await this.hierarchy.edgesAsOfEach(executor, instants);
    const recorded = await this.recordedLeadersOf(
      executor,
      events.map((event) => event.id),
    );

    events.forEach((event, index) => {
      const leaders = narrowing[index];
      const owed = new Set(
        edgesAt[index]
          .filter((edge) => leaders === null || leaders.has(canonicalId(edge.leaderId)))
          .map((edge) => canonicalId(edge.leaderId)),
      );
      const met = recorded.get(canonicalId(event.id)) ?? new Set<string>();

      for (const key of owed) {
        const line = lines.get(key) ?? { met: 0, owed: 0 };
        line.owed += 1;
        if (met.has(key)) {
          line.met += 1;
        }
        lines.set(key, line);
      }
    });

    return lines;
  }

  /**
   * The leaders a coverage denominator is narrowed to at each instant, or `null` for no
   * narrowing at all; a leader's branch is walked from one read.
   *
   * `null` and an empty set are different answers, exactly as they are on the Cells index:
   * `null` is Whole Church and narrows nothing, while an empty set is a scope holding
   * nobody and must measure nothing.
   */
  private async leadersAtEach(
    executor: Db,
    scope: DccCoverageScope,
    instants: readonly Date[],
  ): Promise<(ReadonlySet<string> | null)[]> {
    switch (scope.kind) {
      case 'WHOLE_CHURCH':
        return instants.map(() => null);
      case 'LEADER':
        return this.hierarchy.subtreesAsOf(executor, scope.personId, instants);
      case 'NETWORK': {
        const sets: ReadonlySet<string>[] = [];
        for (const at of instants) {
          sets.push(
            new Set(
              (await this.networks.peopleInNetworkAsOf(executor, scope.network, at)).map((id) =>
                canonicalId(id),
              ),
            ),
          );
        }
        return sets;
      }
      default: {
        const unreached: never = scope;

        return unreached;
      }
    }
  }

  /** `obligations`' numerator for each event: the leaders a live record names. */
  private async recordedLeadersOf(
    executor: Db,
    eventIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const rows = await executor
      .selectFrom('dcc_attendance')
      .select(['dcc_event_id', 'responsible_leader_id'])
      .where('dcc_event_id', 'in', eventIds)
      .where('superseded_at', 'is', null)
      .where('responsible_leader_id', 'is not', null)
      .distinct()
      .execute();

    const byEvent = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = canonicalId(row.dcc_event_id);
      const leaders = byEvent.get(key) ?? new Set<string>();
      leaders.add(canonicalId(row.responsible_leader_id as string));
      byEvent.set(key, leaders);
    }

    return byEvent;
  }

  /**
   * How many of the month's obligations each of these leaders has left unmet — the
   * Network screen's *DCC records behind* (decision 0252).
   *
   * **Each leader's own obligations and nobody else's**, in exactly the unit decision
   * 0224 counts and decision 0254's rows count: one per event a leader held a pastoral
   * edge at, left unmet where no live record names them as responsible leader. So a
   * branch's figure is a plain sum over the leaders in it, with nothing counted twice.
   *
   * **Events nobody could yet have recorded owe nothing** (decision 0229), on the same
   * `coverable` predicate the index uses. The leaders are the caller's — the Network
   * screen passes a branch as it stands now — and each is measured at every event's own
   * instant, which is what makes a leader assigned mid-month owe from that date.
   */
  async unmetByLeaderIn(
    reportingMonth: string,
    leaderIds: readonly string[],
  ): Promise<Map<string, number>> {
    assertReportingMonth(reportingMonth);

    const counts = new Map<string, number>();

    if (leaderIds.length === 0) {
      return counts;
    }

    const now = await databaseNow(this.db);
    const rows = await this.db
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', reportingMonth)
      .where('event_date', '<', nextMonth(reportingMonth))
      .orderBy('event_date')
      .execute();

    for (const row of rows) {
      const event = this.describe(String(row.event_date), row, now);

      if (!coverable(event)) {
        continue;
      }

      const { owing } = await this.obligations(this.db, event, leaderIds);

      for (const leaderId of owing) {
        const key = canonicalId(leaderId);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return counts;
  }

  /**
   * `GET /api/v1/dcc/owed?month=` — the Record page's *People I oversee* view for DCC
   * (decision 0301): each Sunday of the month that takes a record now, and each leader in
   * the actor's branch who still owes one for it, the actor included.
   *
   * **The branch is the pastoral tree beneath the actor as it stands now**, as for Cell
   * meetings (decision 0258), narrowed to the leaders `dcc.view_subtree` covers. A Whole
   * Church grant does not widen it to the church.
   *
   * **"Owes" is coverage's unit** (decision 0224): a leader with no live record naming them
   * for that Sunday. The same unit as the Network screen's DCC figure, so a leader partly
   * through their checklist is not listed here while their own checklist still shows who is
   * unmarked.
   *
   * **One request for the month, walking the branch once.** Not paginated, on the argument
   * the Cell queue's branch view makes: a month holds four or five Sundays, and the leaders
   * are bounded by the G12 shape rather than by arithmetic.
   */
  async owedInBranch(actor: Actor, month: string): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(month);
    assertReportingMonth(reportingMonth);

    const now = await databaseNow(this.db);
    const rows = await this.db
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', reportingMonth)
      .where('event_date', '<', nextMonth(reportingMonth))
      .orderBy('event_date')
      .execute();

    const membership = await this.authorization.scopeMembership(actor, Capability.DccViewSubtree);
    const covered =
      membership.kind === 'WHOLE_CHURCH'
        ? null
        : new Set([...membership.personIds].map((id) => canonicalId(id)));
    const branch = (await this.hierarchy.subtreeOf(this.db, actor.personId)).filter(
      (id) => covered === null || covered.has(canonicalId(id)),
    );

    const owed: {
      event: EventRow;
      leaderId: string;
      submitterId: string | null;
    }[] = [];

    for (const row of rows) {
      const event = this.describe(String(row.event_date), row, now);

      // Only a Sunday that takes a record now: the view is a queue of work that can still
      // be done, and a closed or removed Sunday or one not yet held owes nothing today.
      if (event.notRecordable !== null) {
        continue;
      }

      const { owing } = await this.obligations(this.db, event, branch);
      const submitters = await this.submittersOf(event, [...owing]);

      for (const leaderId of owing) {
        owed.push({ event, leaderId, submitterId: submitters.get(canonicalId(leaderId)) ?? null });
      }
    }

    // **Whether each row carries Record is decided here, per row** (decision 0313), as the
    // Cell queue decides it: the reader may record for the leader whose checklist holds the
    // row's people, found as of the Sunday, holding `dcc.take_attendance` and
    // `dcc.submit_on_behalf` over them now — or that leader is the reader.
    // **For a Leader account, a row is listed by its submitter's depth** (decision 0324):
    // the submitter as of the Sunday must sit within one or two levels of the reader now,
    // the reader included. A row with no submitter, or one outside the branch, is not
    // listed; it still counts in every figure. Filtered on the internal submitter, since
    // `record_for` is null on every row a Leader may not record.
    const depth = await this.authorization.overseeDepthFor(actor.accountId);
    if (depth !== null) {
      const near = new Set(
        (await this.hierarchy.subtreeOf(this.db, actor.personId, depth)).map((id) =>
          canonicalId(id),
        ),
      );
      owed.splice(
        0,
        owed.length,
        ...owed.filter((entry) => entry.submitterId !== null && near.has(entry.submitterId)),
      );
    }

    const recordable = await this.recordableBy(actor, [
      ...new Set(owed.map((entry) => entry.submitterId).filter((id): id is string => id !== null)),
    ]);

    const identities = await this.people.forDecisionsWithin(this.db, [
      ...new Set(owed.map((entry) => entry.leaderId)),
    ]);
    const me = canonicalId(actor.personId);

    const lines = owed.map(({ event, leaderId, submitterId }) => {
      const identity = identities.get(leaderId);
      const byActor = submitterId !== null && submitterId === me;

      return {
        event,
        leaderId,
        byActor,
        submitterId,
        mayRecord: submitterId !== null && (byActor || recordable.has(submitterId)),
        memberId: identity?.memberId ?? '',
        fullName: identity?.fullName ?? '',
        lastName: identity?.lastName ?? '',
        firstName: identity?.firstName ?? '',
      };
    });

    // Date first, then section 8's directory order: never by how far behind anybody is.
    lines.sort(
      (left, right) =>
        left.event.eventDate.localeCompare(right.event.eventDate) ||
        compareKeys(
          { lastName: left.lastName, firstName: left.firstName, memberId: left.memberId },
          { lastName: right.lastName, firstName: right.firstName, memberId: right.memberId },
        ),
    );

    return {
      reporting_month: reportingMonth,
      open: now.getTime() < windowClosesAt(reportingMonth).getTime(),
      data: lines.map((line) => ({
        event_id: line.event.id,
        event_date: line.event.eventDate,
        leader: {
          person_id: line.leaderId,
          member_id: line.memberId,
          full_name: line.fullName,
          // What the branch view sorts by (decision 0311), as the order above is.
          last_name: line.lastName,
          first_name: line.firstName,
          is_actor: canonicalId(line.leaderId) === me,
          // The reader files this leader's records themselves (section 9): the leader holds
          // no account and the reader is the nearest upline who does, so the leader's
          // people are on the reader's own checklist for the Sunday.
          recorded_by_you: line.byActor,
        },
        // The leader whose Sunday screen Record opens, and whether this row offers it
        // (decision 0313). Null where nobody's checklist holds these people, and where the
        // row offers no Record, so it never names a leader the reader cannot reach.
        record_for: line.mayRecord ? line.submitterId : null,
        may_record: line.mayRecord,
      })),
    };
  }

  /**
   * For the Senior Pastors' *Recording status* (decision 0325, point 2): each leader who owed
   * a DCC record in the run of days, with how many of its Sundays they owed and how many of
   * those have none.
   *
   * **The leader is section 9's submitter as of each Sunday**, whose checklist holds the
   * lines of every leader they record for. They owe a Sunday that has begun and is not
   * removed where they submit at least one line, and have recorded it where any line on that
   * checklist has a live record, whoever entered it. A Sunday whose month has closed still
   * counts, as a closed period's figure.
   */
  async recordingBySubmitterBetween(
    executor: Db,
    from: string,
    to: string,
  ): Promise<Map<string, { owed: number; unrecorded: number }>> {
    const now = await databaseNow(executor);
    const rows = await executor
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', from)
      .where('event_date', '<=', to)
      .orderBy('event_date')
      .execute();

    const result = new Map<string, { owed: number; unrecorded: number }>();

    for (const row of rows) {
      const event = this.describe(String(row.event_date), row, now);
      if (event.notRecordable === 'REMOVED' || event.notRecordable === 'NOT_YET_HELD') {
        continue;
      }

      const { owed, owing } = await this.obligations(executor, event, null);
      // Accounts as they stood on the Sunday, so a later account moves no past period
      // (decision 0325, owner 2026-10-08).
      const submitters = await this.submittersOf(event, [...owed], executor, true);
      const recordedBy = new Map<string, boolean>();

      for (const leaderId of owed) {
        const submitter = submitters.get(canonicalId(leaderId));
        if (submitter === undefined) {
          continue;
        }
        const met = !owing.has(leaderId);
        recordedBy.set(submitter, (recordedBy.get(submitter) ?? false) || met);
      }

      for (const [submitter, recorded] of recordedBy) {
        const entry = result.get(submitter) ?? { owed: 0, unrecorded: 0 };
        entry.owed += 1;
        entry.unrecorded += recorded ? 0 : 1;
        result.set(submitter, entry);
      }
    }

    return result;
  }

  /**
   * Of these leaders, those the reader may record for now: holding both
   * `dcc.take_attendance` and `dcc.submit_on_behalf` over them (decision 0313).
   */
  private async recordableBy(actor: Actor, leaderIds: readonly string[]): Promise<Set<string>> {
    if (leaderIds.length === 0) {
      return new Set();
    }

    const [take, onBehalf] = await Promise.all([
      this.authorization.scopeMembership(actor, Capability.DccTakeAttendance),
      this.authorization.scopeMembership(actor, Capability.DccSubmitOnBehalf),
    ]);
    const holds = (membership: typeof take, id: string) =>
      membership.kind === 'WHOLE_CHURCH' || membership.personIds.has(id);

    return new Set(leaderIds.filter((id) => holds(take, id) && holds(onBehalf, id)));
  }

  /**
   * Whose checklist holds each leader's people at this event (section 9): the leader
   * themself where they hold an account, otherwise the nearest leader above them who
   * does, walking the tree as of the Sunday. Canonical identifiers both sides; a leader
   * whose walk reaches the top without an account holder maps to nothing.
   */
  private async submittersOf(
    event: EventRow,
    leaderIds: readonly string[],
    executor: Db = this.db,
    /** Read who holds an account as of the event rather than now (decision 0325). */
    accountsAsOfEvent = false,
  ): Promise<Map<string, string>> {
    const accountsAt = accountsAsOfEvent ? event.at : undefined;
    const result = new Map<string, string>();
    const holders = new Set(
      [...(await this.accounts.personsHoldingAccounts(executor, leaderIds, accountsAt))].map((id) =>
        canonicalId(id),
      ),
    );

    // Each leader still being walked, and the person whose leader is asked next.
    let pending = new Map<string, string>();
    for (const leaderId of leaderIds) {
      const key = canonicalId(leaderId);
      if (holders.has(key)) {
        result.set(key, key);
      } else {
        pending.set(key, key);
      }
    }

    // Bounded, as every walk here is, so a cycle in the data cannot hang the request.
    for (let depth = 0; pending.size > 0 && depth < 64; depth += 1) {
      const nodes = [...new Set(pending.values())];
      const assignments = await this.hierarchy.assignmentsAsOf(executor, nodes, event.at);
      const parentOf = new Map(
        [...assignments].map(([personId, row]) => [
          canonicalId(personId),
          row.leaderId === null ? null : canonicalId(row.leaderId),
        ]),
      );
      const parents = [
        ...new Set([...parentOf.values()].filter((id): id is string => id !== null)),
      ];
      const parentHolders = new Set(
        [...(await this.accounts.personsHoldingAccounts(executor, parents, accountsAt))].map((id) =>
          canonicalId(id),
        ),
      );

      const next = new Map<string, string>();
      for (const [leader, node] of pending) {
        const parent = parentOf.get(node) ?? null;
        if (parent === null) {
          continue;
        }
        if (parentHolders.has(parent)) {
          result.set(leader, parent);
        } else {
          next.set(leader, parent);
        }
      }
      pending = next;
    }

    return result;
  }

  /**
   * `GET /api/v1/dcc/leaders/{id}/checklist?month=` — one leader's DCC checklist across a
   * month, read only (decision 0301).
   *
   * **The people whose record this leader owes**: their direct disciples at each Sunday's
   * instant. Not the leader's recording roster, which also carries people rolled up from
   * leaders without an account; those appear on their own leader's checklist.
   *
   * **Only people the reader may see now** (`dcc.view_subtree`, sections 7 and 8). A
   * disciple since moved out of the reader's scope is left off, as their own record page
   * would refuse the reader; whether a past month may show them is recorded as open.
   *
   * **Archived and merged people are left off**, as the roster leaves them off, because
   * nobody is asked to mark them.
   *
   * **Each mark is the person's live record for that Sunday, whoever filed it**, the same
   * fact the roster and the person page already show (decisions 0194 and 0247).
   */
  async leaderChecklist(
    actor: Actor,
    leaderId: string,
    month: string,
  ): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(month);
    assertReportingMonth(reportingMonth);

    const leader = await this.people.forDecision(leaderId);

    if (!leader) {
      throw new NotFoundError('No such person.');
    }

    const now = await databaseNow(this.db);
    const rows = await this.db
      .selectFrom('dcc_events')
      .select(['id', 'event_date', 'removed_at', 'removal_reason'])
      .where('event_date', '>=', reportingMonth)
      .where('event_date', '<', nextMonth(reportingMonth))
      .orderBy('event_date')
      .execute();

    // A removed Sunday and one not yet held have nobody on anybody's checklist.
    const events = rows
      .map((row) => this.describe(String(row.event_date), row, now))
      .filter((event) => coverable(event));

    const disciplesByEvent = new Map<string, string[]>();

    for (const event of events) {
      disciplesByEvent.set(
        event.id,
        await this.hierarchy.directChildrenOfManyAsOf(this.db, [leaderId], event.at),
      );
    }

    const everyone = [...new Set([...disciplesByEvent.values()].flat())];
    const identities = await this.people.forDecisionsWithin(this.db, everyone);
    const membership = await this.authorization.scopeMembership(actor, Capability.DccViewSubtree);
    const visible =
      membership.kind === 'WHOLE_CHURCH'
        ? null
        : new Set([...membership.personIds].map((id) => canonicalId(id)));
    const listed = everyone.filter((personId) => {
      const identity = identities.get(personId);
      return (
        identity !== undefined &&
        !identity.isArchived &&
        identity.mergedIntoId === null &&
        (visible === null || visible.has(canonicalId(personId)))
      );
    });

    const records =
      listed.length === 0 || events.length === 0
        ? []
        : await this.db
            .selectFrom('dcc_attendance')
            .select(['dcc_event_id', 'person_id', 'present'])
            .where(
              'dcc_event_id',
              'in',
              events.map((event) => event.id),
            )
            .where('person_id', 'in', listed)
            .where('superseded_at', 'is', null)
            .execute();

    const present = new Map(
      records.map((record) => [
        `${record.dcc_event_id}|${canonicalId(record.person_id)}`,
        record.present,
      ]),
    );

    const lines = listed
      .map((personId) => {
        const identity = identities.get(personId);
        const marks: Record<string, boolean | null> = {};

        for (const event of events) {
          const onList = (disciplesByEvent.get(event.id) ?? []).some(
            (id) => canonicalId(id) === canonicalId(personId),
          );

          if (onList) {
            marks[event.id] = present.get(`${event.id}|${canonicalId(personId)}`) ?? null;
          }
        }

        return {
          personId,
          memberId: identity?.memberId ?? '',
          fullName: identity?.fullName ?? '',
          lastName: identity?.lastName ?? '',
          firstName: identity?.firstName ?? '',
          marks,
        };
      })
      .sort((left, right) => compareKeys(keyOf(left), keyOf(right)));

    return {
      reporting_month: reportingMonth,
      leader: { person_id: leader.id, full_name: leader.fullName },
      events: events.map((event) => ({ id: event.id, event_date: event.eventDate })),
      // `marks` holds a Sunday only where the person was on the list that Sunday: `true`
      // present, `false` absent, `null` not recorded yet.
      data: lines.map((line) => ({
        person_id: line.personId,
        member_id: line.memberId,
        full_name: line.fullName,
        marks: line.marks,
      })),
    };
  }

  /**
   * Who owes a record for this event within the actor's scope, and which of them have
   * not filed one.
   *
   * **The denominator is the leaders holding a pastoral edge at the event's instant**,
   * and nothing else narrows it. That instant is `recordingInstant`, the same one the
   * roster and the submission resolve a responsible leader at — so a leader who appears
   * here is a leader some roster names, and the two cannot disagree about who was
   * responsible.
   *
   * **No lifecycle filter, and section 9 states both halves of why that is unsatisfying.**
   * A first version dropped an edge whose disciple was archived or merged. What removed it
   * is section 3, which that filter broke outright: it read the **current** lifecycle row
   * through `forDecisionsWithin` against a dated edge set, so archiving one disciple today
   * moved a past Sunday's figure from `1 of 1` to `0 of 0`, where section 3 says archiving
   * "must never change the total shown for a period before their archive date".
   *
   * **What is left is not a clean reading of section 9, and saying so is the point.**
   * Section 9 names exactly one exclusion from a coverage denominator, the Network roots,
   * which this now follows. Section 9 *also* promises of this very route that "each entry
   * offers the action that resolves it" — and a leader whose only disciple was archived is
   * in `owed`, can never enter `met` because the roster omits that disciple and the
   * submission refuses a line naming them, and therefore sits on the gap list with nothing
   * that resolves it. The code follows one sentence and breaks the other; which sentence
   * section 9 should keep is the Stop Condition recorded in `CLAUDE.md`.
   *
   * *Section 5 bears on it and is cited there rather than argued here: it describes an
   * archived Person as one "whose assignment has ended", which would make most of this
   * class unreachable once archival is built and may be why section 9 never addressed it.*
   *
   * **The numerator is a live row naming them**, `superseded_at IS NULL`, because a
   * correction supersedes rather than overwrites (section 14) and a superseded row is not
   * the record. `present` is deliberately not read: section 9 measures whether the record
   * exists, and a leader who recorded every disciple absent has discharged the obligation
   * exactly as one who recorded them present.
   */
  private async obligations(
    executor: Db,
    event: EventRow,
    leaderIds: readonly string[] | null,
  ): Promise<{ owed: Set<string>; owing: Set<string> }> {
    const edges = await this.hierarchy.edgesAsOf(executor, event.at, leaderIds);

    const owed = new Set(edges.map((edge) => edge.leaderId));

    const recorded = await executor
      .selectFrom('dcc_attendance')
      .select('responsible_leader_id')
      .where('dcc_event_id', '=', event.id)
      .where('superseded_at', 'is', null)
      .where('responsible_leader_id', 'is not', null)
      .distinct()
      .execute();

    const met = new Set(recorded.map((line) => canonicalId(line.responsible_leader_id as string)));

    return {
      owed,
      owing: new Set([...owed].filter((leaderId) => !met.has(canonicalId(leaderId)))),
    };
  }

  /**
   * An event row as both routes read it, including why it takes no record.
   *
   * **The same three reasons `DccAttendanceService.recordability` gives, in the same
   * order and against the same `now`.** They are two implementations of one rule, which
   * is the shape this repository records against itself — kept apart because that method
   * is private to a service in a different dependency position, and named here so the
   * duplication is visible rather than discovered. A change to what makes an event
   * recordable is a change to both.
   */
  private describe(
    eventDate: string,
    row: { id: string; removed_at: Date | null; removal_reason: string | null },
    now: Date,
  ): EventRow {
    return {
      id: row.id,
      eventDate,
      removedAt: row.removed_at,
      removalReason: row.removal_reason,
      at: recordingInstant(eventDate, now),
      notRecordable:
        row.removed_at !== null
          ? 'REMOVED'
          : now.getTime() < startOfManilaDay(eventDate).getTime()
            ? 'NOT_YET_HELD'
            : now.getTime() >= windowClosesAt(reportingMonthOf(eventDate)).getTime()
              ? 'MONTH_CLOSED'
              : null,
    };
  }
}

/**
 * Whether this event has a coverage figure at all.
 *
 * Two of the three `NotRecordable` reasons mean nobody owes a record: the service was not
 * held, or its day has not begun. The third, `MONTH_CLOSED`, is the opposite — the
 * obligations were real, the window has shut on them, and the figure is the frozen record
 * of what was and was not filed.
 *
 * **An exhaustive switch rather than a boolean expression, so a fourth reason cannot be
 * added without deciding this.** A first version was written as
 * `notRecordable === null || notRecordable === 'MONTH_CLOSED'` and claimed exactly this
 * safeguard while delivering none: a new member of the union would have silently answered
 * `false`, which is how `NOT_YET_HELD` came to be answered `0 of N` in the first place.
 * The `never` binding is what makes the compiler refuse a fourth.
 *
 * **It guards the union `DccAttendanceService` declares, which is now the only one.**
 * This file carried a second copy of `NotRecordable`, so a member added to the first would
 * never have reached this switch — a `never` binding over a local copy of a type is a
 * safeguard against nobody. The type is imported rather than restated; the `describe`
 * method above is still a second implementation of the *rule*, which is named where it
 * sits.
 */
function coverable(event: EventRow): boolean {
  switch (event.notRecordable) {
    case null:
    case 'MONTH_CLOSED':
      return true;
    case 'REMOVED':
    case 'NOT_YET_HELD':
      return false;
    default: {
      const unreached: never = event.notRecordable;

      return unreached;
    }
  }
}

/**
 * A capability grant's membership as a leader narrowing.
 *
 * The two route methods narrow by what the actor may *see*, and the report narrows by the
 * scope it was asked for — so the narrowing is a parameter and this is the routes' half of
 * it. `null` is Whole Church and narrows nothing; an empty set is a caller in scope for
 * nobody, which measures nothing. The distinction is the same one `leadersToList` draws on
 * the Cells index, for the same reason.
 */
function leadersOf(membership: ScopeMembership): readonly string[] | null {
  return membership.kind === 'WHOLE_CHURCH' ? null : [...membership.personIds];
}

/** The first of the month after this one, as a `YYYY-MM-01` Manila date. */
function nextMonth(reportingMonth: string): string {
  const [year, month] = reportingMonth.split('-').map(Number);

  return month === 12
    ? `${String(year + 1).padStart(4, '0')}-01-01`
    : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

interface GapLine {
  personId: string;
  memberId: string;
  fullName: string;
  lastName: string;
  firstName: string;
}

function keyOf(line: GapLine): RosterCursor {
  return { lastName: line.lastName, firstName: line.firstName, memberId: line.memberId };
}

/**
 * Lexicographic over the three keys, in order — `localeCompare`, matching how the lines
 * are sorted. A comparison ordering differently from the sort would put the page boundary
 * somewhere the sort never placed it, and rows either side of it would be skipped or
 * repeated.
 */
function compareKeys(left: RosterCursor, right: RosterCursor): number {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.memberId.localeCompare(right.memberId)
  );
}
