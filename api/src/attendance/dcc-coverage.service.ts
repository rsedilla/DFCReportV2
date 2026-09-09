import { Inject, Injectable } from '@nestjs/common';

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
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';

import { recordingInstant } from './recording-instant';

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

/** Why an event takes no record, in the vocabulary the roster route already answers in. */
type NotRecordable = 'REMOVED' | 'NOT_YET_HELD' | 'MONTH_CLOSED';

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
 * **A disciple who cannot be recorded is not an obligation.** The roster drops an
 * archived and a merged Person, and the submission refuses both, so counting them would
 * leave a leader whose only disciples are archived permanently in the denominator with no
 * act available that could move them out of it — which is the one thing section 15 says
 * an attention list must never be, a list whose entries cannot be resolved. The
 * lifecycle read is the current one, matching the roster's, so the figure and what a
 * leader can actually do agree.
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
    private readonly authorization: AuthorizationService,
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
  async eventsIn(actor: Actor, month: string): Promise<Record<string, unknown>> {
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
    const membership = await this.authorization.scopeMembership(actor, Capability.DccViewSubtree);

    const rendered = await Promise.all(
      events.map(async (event) => ({
        event,
        // **A removed event carries no coverage, and the null is the answer rather than a
        // zero** (decision 0227): nobody owes a record for a service that was not held,
        // and `0 of 0` would say the obligations were all discharged.
        coverage: event.removedAt === null ? await this.coverageOf(event, membership) : null,
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
   * **A removed event has no gaps rather than every leader in it**, on the same reading
   * the index takes: nobody owes a record for a service that was not held.
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

    const owing =
      event.removedAt === null
        ? (await this.obligations(event, membership)).owing
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
  private async coverageOf(event: EventRow, membership: ScopeMembership): Promise<Coverage> {
    const { owed, owing } = await this.obligations(event, membership);

    return { met: owed.size - owing.size, owed: owed.size };
  }

  /**
   * Who owes a record for this event within the actor's scope, and which of them have
   * not filed one.
   *
   * **The denominator is the leaders holding a recordable disciple at the event's
   * instant.** That instant is `recordingInstant`, the same one the roster and the
   * submission resolve a responsible leader at — so a leader who appears here is a leader
   * some roster names, and the two cannot disagree about who was responsible.
   *
   * **The numerator is a live row naming them**, `superseded_at IS NULL`, because a
   * correction supersedes rather than overwrites (section 14) and a superseded row is not
   * the record. `present` is deliberately not read: section 9 measures whether the record
   * exists, and a leader who recorded every disciple absent has discharged the obligation
   * exactly as one who recorded them present.
   */
  private async obligations(
    event: EventRow,
    membership: ScopeMembership,
  ): Promise<{ owed: Set<string>; owing: Set<string> }> {
    const leaderIds = membership.kind === 'WHOLE_CHURCH' ? null : [...membership.personIds];
    const edges = await this.hierarchy.edgesAsOf(this.db, event.at, leaderIds);

    // The disciples decide which edges are obligations, so their lifecycle is read once
    // for the whole event rather than per leader.
    const identities = await this.people.forDecisionsWithin(this.db, [
      ...new Set(edges.map((edge) => edge.personId)),
    ]);

    const owed = new Set<string>();
    for (const edge of edges) {
      const identity = identities.get(edge.personId);
      if (identity !== undefined && !identity.isArchived && identity.mergedIntoId === null) {
        owed.add(edge.leaderId);
      }
    }

    const recorded = await this.db
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
