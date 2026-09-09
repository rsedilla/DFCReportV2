import { authenticatedRequest } from './session';

/**
 * The `cells` API as this client sees it (SKILL.md sections 10, 12, 13, 15 and 19).
 *
 * **Coverage is two figures and stays two figures.** Section 13 forbids dividing
 * them into a percentage or any composite score, so nothing here returns a ratio
 * and no screen computes one. `3 of 4 meetings recorded` is the figure; `75%` is
 * a leader's grade, which is the thing the prohibition exists to prevent.
 *
 * **Nothing here sorts.** Decision 0226 makes the index's order `cell_id`, which
 * section 10 makes meaningless by design, precisely so the list ranks nobody. A
 * client-side sort by coverage would rebuild the leaderboard the API declines to
 * serve, which is why these functions return the API's order untouched and no
 * screen is given a comparator.
 */

export type CellCategory = 'YOUTH' | 'YOUNG_PRO' | 'COUPLE';

export type CellMeetingStatus = 'HELD' | 'NOT_HELD' | 'RESCHEDULED';

/** Section 12's coverage line, as two figures that are never divided. */
export interface CellCoverage {
  recorded: number;
  scheduled: number;
}

export interface CellSchedule {
  day_of_week: number;
  time_of_day: string;
}

export interface CellSummary {
  id: string;
  cell_id: string;
  category: CellCategory;
  schedule: CellSchedule;
  leader: { person_id: string; member_id: string; full_name: string };
  coverage: CellCoverage;
}

export interface CellIndexPage {
  reporting_month: string;
  /** Section 17: whether the month is still open, because the figures still move. */
  open: boolean;
  data: CellSummary[];
  next_cursor: string | null;
}

/** A recorded meeting. Absent — `meeting: null` — means awaiting a record. */
export interface RecordedMeeting {
  id: string;
  status: CellMeetingStatus;
  scheduled_date: string;
  scheduled_time: string;
  actual_date: string | null;
  actual_time: string | null;
  not_held_reason: string | null;
  not_held_note: string | null;
  facilitated_by: string | null;
  responsible_leader_id: string;
  submitted_by: string | null;
  submitted_at: string | null;
  version: number;
}

export interface ScheduledMeeting {
  scheduled_date: string;
  scheduled_time: string;
  week_starting: string;
  reporting_month: string;
  /**
   * `null` is "awaiting a record", which sections 13 and 19 make an outstanding
   * task rather than a fourth status. A screen must not render it as a status
   * beside `HELD`, `NOT_HELD` and `RESCHEDULED`: those are things a leader
   * reported, and this is the absence of a report.
   */
  meeting: RecordedMeeting | null;
}

export interface CellMeetings {
  cell_id: string;
  reporting_month: string;
  scheduled_count: number;
  recorded_count: number;
  meetings: ScheduledMeeting[];
}

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** ISO 8601 weekday, 1 Monday through 7 Sunday (section 20). */
export function dayOfWeekLabel(day: number): string {
  return DAY_NAMES[day - 1] ?? 'Unknown';
}

export function categoryLabel(category: CellCategory): string {
  switch (category) {
    case 'YOUTH':
      return 'Youth';
    case 'YOUNG_PRO':
      return 'Young Pro';
    case 'COUPLE':
      return 'Couple';
    default:
      return category;
  }
}

/**
 * How a meeting's state reads, including the state that is not a status.
 *
 * Words rather than a colour, on section 13's terms and section 23's: colour is
 * never the only carrier of meaning here, and none of these is an error.
 */
export function meetingStateLabel(meeting: RecordedMeeting | null): string {
  if (meeting === null) {
    return 'Awaiting a record';
  }

  switch (meeting.status) {
    case 'HELD':
      return 'Held';
    case 'NOT_HELD':
      return 'Not held';
    case 'RESCHEDULED':
      return 'Rescheduled';
    default:
      return meeting.status;
  }
}

/**
 * The Cells of the actor's scope for one month (decision 0226).
 *
 * `ledBy` is the narrower of two readings of one scope rather than a second
 * authorization: it can only ever remove rows the unfiltered list would already
 * have shown, which is what makes the dashboard's "your own Cells" and the
 * upline's "Cells in your scope" one route.
 */
export async function listCells(
  params: { month: string; ledBy?: 'me'; cursor?: string | null },
  signal?: AbortSignal,
): Promise<CellIndexPage> {
  const query = new URLSearchParams({ month: params.month });
  if (params.ledBy) {
    query.set('led_by', params.ledBy);
  }
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }

  return authenticatedRequest<CellIndexPage>(`/api/v1/cells?${query.toString()}`, { signal });
}

/**
 * One Cell's scheduled and recorded meetings for a month.
 *
 * Not paginated, and no screen offers paging over it: a month holds four or five
 * scheduled meetings, so the size is arithmetic rather than a function of the
 * data.
 */
export async function listCellMeetings(
  cellId: string,
  month: string,
  signal?: AbortSignal,
): Promise<CellMeetings> {
  const query = new URLSearchParams({ month });

  return authenticatedRequest<CellMeetings>(
    `/api/v1/cells/${cellId}/meetings?${query.toString()}`,
    { signal },
  );
}

/** One member as the meeting roster returns them (decision 0223). */
export interface RosterMember {
  person_id: string;
  member_id: string;
  first_name: string;
  last_name: string;
  /**
   * The live mark, or `null` for a member nobody has marked.
   *
   * **Null is not `false`.** A missing row and a row marked absent contribute
   * identically to every figure, but they are different declarations: section 13
   * has a roster declared by its leader, and a screen that rendered an unmarked
   * member as absent would manufacture a declaration nobody made. So a correction
   * screen shows "not recorded" and makes the leader choose.
   */
  record: { present: boolean } | null;
}

export interface MeetingRoster {
  cell_id: string;
  meeting_id: string;
  scheduled_date: string;
  scheduled_time: string;
  week_starting: string;
  reporting_month: string;
  /** The date the roster was read at — the actual date where the meeting moved. */
  roster_date: string;
  responsible_leader_id: string;
  meeting: RecordedMeeting | null;
  members: RosterMember[];
}

export interface CellSubmission {
  status: CellMeetingStatus;
  /**
   * The meeting's version, or absent on a first submission (section 14).
   *
   * **The unit is the meeting, not the person.** A Cell submission is one leader's
   * account of one meeting, so one version covers the whole roster — which is the
   * opposite of the DCC side, where a church-wide event means two leaders recording
   * different people must never conflict.
   */
  submitted_version?: number;
  attendance?: { person_id: string; present: boolean }[];
  correction_reason?: string;
  not_held_reason?: string;
  not_held_note?: string;
}

/** The roster a submission must name in full, and the marks already standing. */
export async function getMeetingRoster(
  cellId: string,
  meetingId: string,
  signal?: AbortSignal,
): Promise<MeetingRoster> {
  return authenticatedRequest<MeetingRoster>(
    `/api/v1/cells/${cellId}/meetings/${meetingId}/roster`,
    { signal },
  );
}

/**
 * Record or correct one meeting.
 *
 * **The idempotency key is the caller's**, because a key belongs to a body rather
 * than to an attempt (decision 0127). A leader on a slow connection who presses
 * Save twice must produce one record, and a retry of the same submission must
 * replay rather than write again — which only holds if the key survives the retry
 * and changes when the body does.
 */
export async function submitMeeting(
  cellId: string,
  meetingId: string,
  submission: CellSubmission,
  idempotencyKey: string,
): Promise<RecordedMeeting> {
  return authenticatedRequest<RecordedMeeting>(
    `/api/v1/cells/${cellId}/meetings/${meetingId}/submit`,
    { method: 'POST', body: submission, idempotencyKey },
  );
}
