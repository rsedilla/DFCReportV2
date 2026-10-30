import { authenticatedRequest } from './session';

/**
 * The DCC calendar as this client sees it (SKILL.md sections 9, 13, 15 and 19;
 * decisions 0224, 0227 and 0229).
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
  /** When it is due, null before the weekly rule, and when its week closes (decision 0335). */
  due_at?: string | null;
  closes_at?: string;
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
      return 'The week is closed for submission';
    default:
      return reason;
  }
}

/**
 * The month's Sundays, each with the coverage over the actor's scope, or with `coverage`
 * false, without it: each line's coverage is then `null` (checklist row perf-person-page).
 */
export async function listDccEvents(
  month: string,
  signal?: AbortSignal,
  options: { coverage?: boolean } = {},
): Promise<DccEventsMonth> {
  const query = new URLSearchParams({ month });
  if (options.coverage === false) {
    query.set('coverage', 'false');
  }

  return authenticatedRequest<DccEventsMonth>(`/api/v1/dcc/events?${query.toString()}`, {
    signal,
  });
}

/** One person on a leader's checklist, and the record standing against them. */
export interface DccRosterLine {
  person_id: string;
  member_id: string;
  full_name: string;
  /** The order key's two names (decision 0359); `full_name` carries a title and is not compared. */
  first_name: string;
  last_name: string;
  /** The person's direct pastoral leader; null for a Network root, who has none (section 9). */
  responsible_leader_id: string | null;
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

/**
 * A leader's checklist for one event, up to 200 people: the API's most, so a checklist of
 * up to 200 shows and saves whole (checklist row decision-dcc-record-over-50).
 */
export async function getDccRoster(
  eventId: string,
  signal?: AbortSignal,
): Promise<DccRoster> {
  return authenticatedRequest<DccRoster>(`/api/v1/dcc/events/${encodeURIComponent(eventId)}/roster?limit=200`, {
    signal,
  });
}

/** Another leader's checklist for one Sunday, to record on their behalf (decision 0313). */
export interface LeaderDccRoster extends DccRoster {
  leader: {
    person_id: string;
    full_name: string;
    holds_account: boolean;
    account_active: boolean;
  };
}

/** That leader's checklist for one event, up to 200 people, as {@link getDccRoster}. */
export async function getLeaderDccRoster(
  eventId: string,
  leaderId: string,
  signal?: AbortSignal,
): Promise<LeaderDccRoster> {
  return authenticatedRequest<LeaderDccRoster>(
    `/api/v1/dcc/events/${encodeURIComponent(eventId)}/leaders/${encodeURIComponent(leaderId)}/roster?limit=200`,
    { signal },
  );
}

/**
 * Every line of a leader's checklist, following `next_cursor` to the end (section 9: unbounded).
 *
 * 200 at a time, the API's most: every page builds the whole checklist on the server, so a
 * page of 200 costs what a page of 50 does (checklist row perf-dcc-checklist).
 */
export async function getWholeDccRoster(
  eventId: string,
  signal?: AbortSignal,
): Promise<DccRosterLine[]> {
  const lines: DccRosterLine[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) {
      params.set('cursor', cursor);
    }
    const query = `?${params.toString()}`;
    const page: DccRoster = await authenticatedRequest<DccRoster>(
      `/api/v1/dcc/events/${encodeURIComponent(eventId)}/roster${query}`,
      { signal },
    );
    lines.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor !== null);

  return lines;
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
  /** An Admin's amendment of a closed week, with why (section 9, decision 0411). */
  amendment?: { reason: string },
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/dcc/events/${encodeURIComponent(eventId)}/submit`, {
    method: 'POST',
    body: amendment ? { records, amendment } : { records },
    idempotencyKey,
  });
}

/** One DCC record still owed in the reader's branch: a Sunday and its leader (decision 0301). */
export interface DccOwed {
  event_id: string;
  event_date: string;
  /** When it is due, null before the weekly rule, and when its week closes (decision 0335). */
  due_at?: string | null;
  closes_at?: string;
  leader: {
    person_id: string;
    member_id: string;
    full_name: string;
    /** What the branch view sorts by (decision 0311). */
    last_name: string;
    first_name: string;
    is_actor: boolean;
    /** The reader files this leader's records: the leader has no account (section 9). */
    recorded_by_you: boolean;
  };
  /**
   * The leader whose Sunday screen Record opens: this one, or for a leader without an
   * account the nearest above who has one, as of the Sunday (decision 0313). Null where
   * `may_record` is false.
   */
  record_for: string | null;
  /** Whether the reader may record there, decided by the API per row (decision 0313). */
  may_record: boolean;
}

/** The Record page's Leaders Under Me view for DCC: one request for the month. */
export async function getDccOwed(
  month: string,
  signal?: AbortSignal,
): Promise<{ reporting_month: string; open: boolean; data: DccOwed[] }> {
  return authenticatedRequest(`/api/v1/dcc/owed?${new URLSearchParams({ month }).toString()}`, {
    signal,
  });
}

/** One leader on Record's Pending DCC Records, with each Sunday still open (decision 0336). */
export interface PendingDccLeader {
  leader: {
    person_id: string;
    member_id: string;
    full_name: string;
    last_name: string;
    first_name: string;
    is_actor: boolean;
    /** False shows "Has no account" (decision 0336), or "No account on these Sundays" (decision 0403). */
    has_account: boolean;
    /** Holds an account now: a row of Sundays before it reads "No account on these Sundays" (decision 0403, 3c). */
    holds_account_now: boolean;
  };
  /** Who records it, named only where the reader's scope covers them. */
  recorded_by: { person_id: string; full_name: string } | null;
  recorded_by_you: boolean;
  /** Oldest first; the recorder, Record and See checklist follow the first. */
  sundays: { event_id: string; event_date: string; due_at: string | null; closes_at: string }[];
  record_for: string | null;
  may_record: boolean;
}

export async function getPendingDccLeaders(
  options: {
    cursor?: string | null;
    q?: string;
    network?: 'MENS' | 'WOMENS' | null;
    /** Only the Sundays past their deadline, and the leaders who owe one (decision 0368). */
    late?: boolean;
    /** Only this leader's branch now (decision 0370). */
    leaderId?: string | null;
  },
  signal?: AbortSignal,
): Promise<{ data: PendingDccLeader[]; next_cursor: string | null }> {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.q) query.set('q', options.q);
  if (options.network) query.set('network', options.network);
  if (options.late) query.set('late', 'true');
  if (options.leaderId) query.set('leader_id', options.leaderId);
  const text = query.toString();

  return authenticatedRequest(`/api/v1/dcc/pending-leaders${text ? `?${text}` : ''}`, { signal });
}

/** A leader's DCC checklist across a month, read only (decision 0301). */
export interface LeaderChecklist {
  reporting_month: string;
  leader: { person_id: string; full_name: string };
  events: { id: string; event_date: string }[];
  /** A Sunday is in `marks` only where the person was on the list that Sunday. */
  data: {
    person_id: string;
    member_id: string;
    full_name: string;
    marks: Record<string, boolean | null>;
  }[];
}

export async function getLeaderChecklist(
  leaderId: string,
  month: string,
  signal?: AbortSignal,
): Promise<LeaderChecklist> {
  return authenticatedRequest(
    `/api/v1/dcc/leaders/${encodeURIComponent(leaderId)}/checklist?${new URLSearchParams({ month }).toString()}`,
    { signal },
  );
}

/** Section 9's classification, as the API names it. */
export type DccClassification = 'VIP' | '2ND_TIMER' | '3RD_TIMER' | '4TH_TIMER' | 'REGULAR';

/** The names section 9's classification view prints. */
export function classificationLabel(classification: DccClassification): string {
  switch (classification) {
    case 'VIP':
      return 'VIP';
    case '2ND_TIMER':
      return '2nd Timer';
    case '3RD_TIMER':
      return '3rd Timer';
    case '4TH_TIMER':
      return '4th Timer';
    case 'REGULAR':
      return 'Regular';
    default:
      return classification;
  }
}

/** One of a person's DCC records (decision 0247). */
export interface PersonDccRecord {
  event_id: string;
  event_date: string;
  present: boolean;
  /** A record on a Sunday later removed: listed, and not counted (section 9). */
  removed: boolean;
  /**
   * Whose checklist the line is on that Sunday, told to the Admin alone (decision 0411);
   * absent for everyone else, and null where it is nobody's or a Network root's own.
   */
  checklist_of?: string | null;
}

export interface PersonDccAttendance {
  person_id: string;
  /** `null` for somebody with no counted attendance, who has no classification. */
  classification: DccClassification | null;
  /** The count the classification is made from, not a total of the list. */
  attended: number;
  data: PersonDccRecord[];
  next_cursor: string | null;
}

/**
 * One person's DCC records, newest first, and the classification they give
 * (decision 0247).
 *
 * Nothing here changes a classification. One that looks wrong is corrected by
 * correcting the Sunday behind it (section 9).
 */
export async function getPersonDccAttendance(
  personId: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<PersonDccAttendance> {
  const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';

  return authenticatedRequest<PersonDccAttendance>(
    `/api/v1/dcc/people/${encodeURIComponent(personId)}/attendance${query}`,
    { signal },
  );
}
