import { authenticatedRequest } from './session';

/**
 * The DCC calendar as this client sees it (SKILL.md sections 9, 13, 15 and 19;
 * decisions 0224, 0227, 0228 and 0229).
 *
 * **A removed Sunday is shown in its place, never skipped.** Section 9 is
 * emphatic that a removal "always means a row that records a decision" while a
 * missing row "is never a decision", and it requires a removal to be visible on
 * any report covering the month "so that a month showing four events where the
 * calendar shows five is explained rather than merely odd". So the screen renders
 * the row and says why, rather than sliding past it.
 *
 * **A null coverage figure is the answer rather than a zero.** An event nobody
 * could yet have recorded — removed, or a Sunday whose Manila day has not begun —
 * owes nobody a record (decision 0229). `0 of 8` there would say eight leaders
 * failed to record a service that never happened, and `0 of 0` would say the
 * obligations were all discharged. Both are false, so the API sends `null` and
 * the screen says there is nothing owed yet.
 *
 * **Two figures, never divided** (section 13), exactly as for a Cell.
 */

export type NotRecordableReason = 'REMOVED' | 'NOT_YET_HELD' | 'MONTH_CLOSED';

/** Obligations met over obligations owed, summed where a month is asked for. */
export interface DccCoverage {
  met: number;
  owed: number;
}

export interface DccEvent {
  id: string;
  event_date: string;
  recordable: boolean;
  not_recordable_reason: NotRecordableReason | null;
  removed: boolean;
  removal_reason: string | null;
  /** `null` where nobody owes a record yet — not a zero (decision 0229). */
  coverage: DccCoverage | null;
}

export interface DccEventsMonth {
  reporting_month: string;
  /** Section 17: an open month's coverage figure is still changing. */
  open: boolean;
  data: DccEvent[];
}

/**
 * Why an event takes no record, in words a leader can act on.
 *
 * `MONTH_CLOSED` is deliberately different in kind from the other two: the
 * obligations were real and the window has shut on them, so its coverage figure
 * is the frozen historical record rather than an absence.
 */
export function notRecordableLabel(reason: NotRecordableReason): string {
  switch (reason) {
    case 'REMOVED':
      return 'No service was held';
    case 'NOT_YET_HELD':
      return 'Has not happened yet';
    case 'MONTH_CLOSED':
      return 'The month is closed for submission';
    default:
      return reason;
  }
}

/** The month's Sundays, each with the coverage over the actor's scope. */
export async function listDccEvents(month: string, signal?: AbortSignal): Promise<DccEventsMonth> {
  const query = new URLSearchParams({ month });

  return authenticatedRequest<DccEventsMonth>(`/api/v1/dcc/events?${query.toString()}`, {
    signal,
  });
}

/** One person on a leader's checklist, and the record standing against them. */
export interface DccRosterLine {
  person_id: string;
  member_id: string;
  full_name: string;
  responsible_leader_id: string;
  /**
   * The live record, or `null` for somebody nobody has recorded.
   *
   * The version is **per person**, because section 14 makes a DCC record's unit
   * `(event, person)`. A DCC event is church-wide, so two leaders recording
   * different people must never conflict — which is why this carries a version per
   * line where a Cell submission carries one for the whole meeting.
   */
  record: { present: boolean; version: number; recorded_at: string } | null;
}

export interface DccRoster {
  event: DccEvent;
  data: DccRosterLine[];
  next_cursor: string | null;
}

export interface DccRecordInput {
  person_id: string;
  present: boolean;
  /** The version read for this person, or `null` for their first record. */
  version: number | null;
  correction_reason?: string;
}

/** A leader's whole checklist for one event. */
export async function getDccRoster(
  eventId: string,
  signal?: AbortSignal,
): Promise<DccRoster> {
  return authenticatedRequest<DccRoster>(`/api/v1/dcc/events/${eventId}/roster`, { signal });
}

/**
 * Record or correct attendance for one event.
 *
 * **The idempotency key is the caller's**, for the reason the Cell submission
 * gives: a key belongs to a body rather than to an attempt (decision 0127), so it
 * has to survive a retry and change when the body does.
 */
export async function submitDccAttendance(
  eventId: string,
  records: DccRecordInput[],
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/dcc/events/${eventId}/submit`, {
    method: 'POST',
    body: { records },
    idempotencyKey,
  });
}

/** One leader who owes a record for an event and has not filed one (decision 0228). */
export interface CoverageGap {
  person_id: string;
  member_id: string;
  full_name: string;
}

export interface CoverageGaps {
  event: DccEvent;
  data: CoverageGap[];
  next_cursor: string | null;
}

/**
 * Who still owes a record for one event, within the actor's scope.
 *
 * **An attention list on section 15's terms, which is what makes naming leaders
 * defensible rather than a leaderboard**: filtered to the actor's own scope,
 * ordered by name, never by how far behind anybody is, and carrying no grade.
 * Section 19 is why it exists — "a dashboard of counts tells a leader nothing to
 * act on" — and section 14 is the act it enables, since an upline may record on
 * behalf of a downline leader within their subtree.
 *
 * Decision 0228 makes the **scope** the whole of the constraint: the same data
 * shown church-wide and ordered by how many records are missing is the leaderboard
 * section 13 exists to prevent.
 */
export async function getCoverageGaps(
  eventId: string,
  signal?: AbortSignal,
): Promise<CoverageGaps> {
  return authenticatedRequest<CoverageGaps>(`/api/v1/dcc/events/${eventId}/coverage-gaps`, {
    signal,
  });
}
