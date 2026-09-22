import { ApiRequestError } from './api-client';
import { describeFailure, type Failure } from './messages';
import { dayLabel } from './reporting-month';
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
  /**
   * How many meetings whose day has begun have no record (decision 0267), counted by the
   * server date by date. Nothing keys on `scheduled`, which is the whole month (decision
   * 0239), and nothing here recomputes this from the other two.
   */
  behind: number;
}

/** How many meetings that have come still have no record (decision 0267). */
export function behindOf(coverage: CellCoverage): number {
  return coverage.behind;
}

export interface CellSchedule {
  day_of_week: number;
  time_of_day: string;
}

export interface CellSummary {
  id: string;
  cell_id: string;
  category: CellCategory;
  /** How many members it holds now (decision 0261). */
  member_count: number;
  /** The Running view only: the Cell's Network, which is its leader's today (section 10). */
  network?: 'MENS' | 'WOMENS' | null;
  schedule: CellSchedule;
  leader: { person_id: string; member_id: string; full_name: string };
  coverage: CellCoverage;
  /** `ACTIVE`, or `CLOSED` in the closed view (decision 0266). */
  state?: 'ACTIVE' | 'CLOSED';
  /** The closed view only: the Manila day it closed, and why (section 10). */
  closed_on?: string;
  closure_reason?: CellClosureReason;
  /** The closed view only: the Cell that resumed it, where one has (decision 0264). */
  restarted_as?: string | null;
  /**
   * The closed view only: whether this reader may ask for it to restart. The server's
   * answer, never derived here (section 7).
   */
  may_restart?: boolean;
}

export type CellClosureReason =
  | 'MERGED_INTO_ANOTHER_CELL'
  | 'LEADER_STEPPED_DOWN'
  | 'MEMBERS_DISPERSED'
  | 'CREATED_IN_ERROR'
  | 'OTHER';

export function closureReasonLabel(reason: CellClosureReason): string {
  switch (reason) {
    case 'MERGED_INTO_ANOTHER_CELL':
      return 'Merged into another Cell';
    case 'LEADER_STEPPED_DOWN':
      return 'Leader stepped down';
    case 'MEMBERS_DISPERSED':
      return 'Members dispersed';
    case 'CREATED_IN_ERROR':
      return 'Created in error';
    default:
      return 'Other';
  }
}

/** A `YYYY-MM-DD` day with its year, because a Cell may have closed years ago. */
export function closedOnLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Ask for a closed Cell to restart (decisions 0264 and 0265): a new-Cell request naming
 * the Cell it resumes and the leader who led it. Admin approves it like any other.
 */
export async function requestCellRestart(
  body: {
    restart_of_cell_id: string;
    prospective_leader_id: string;
    category: CellCategory;
    day_of_week: number;
    time_of_day: string;
  },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>('/api/v1/cells/leadership-requests', {
    method: 'POST',
    body: { kind: 'NEW_CELL', ...body },
    idempotencyKey,
  });
}

export interface CellIndexPage {
  reporting_month: string;
  /** Section 17: whether the month is still open, because the figures still move. */
  open: boolean;
  data: CellSummary[];
  next_cursor: string | null;
}

/**
 * One meeting the signed-in leader owes a record for (SKILL.md section 19).
 *
 * Carries the Cell's code, time and closure date rather than an identifier alone,
 * because this is the only list a **closed** Cell reaches: the Cells index is
 * `ACTIVE`-only, so a client that looked the rest up there would be back at the gap
 * this route was written to close.
 */
export interface AwaitingMeeting {
  cell_id: string;
  cell_code: string;
  scheduled_date: string;
  scheduled_time: string;
  /** ISO weekday of the schedule the meeting falls under, 1 = Monday. */
  day_of_week: number;
  reporting_month: string;
  /** Null while the Cell is `ACTIVE`; a Manila date once it has closed. */
  cell_closed_on: string | null;
  category: CellCategory | null;
  /** Members on the scheduled date, by the rule the meeting's roster uses. */
  member_count: number;
  /** The leader who files it (decision 0251), named for the branch view (decision 0258). */
  leader: { id: string; full_name: string | null; is_actor: boolean };
  /** Whether this actor may record it: their own, or on the leader's behalf (§14). */
  may_record: boolean;
}

export interface AwaitingMeetings {
  reporting_month: string;
  /**
   * Section 17: false once the month's window has shut, and then the list is empty.
   *
   * **Nothing on the Dashboard reads it, and that is the point of the empty list.** The
   * queue used to ask the Cells index whether last month was still open and then decide
   * whether to read its meetings; a shut month now answers nothing owed, so the screen
   * has no decision to make and cannot reach a different answer from the server's. The
   * "open until 7 Oct" tag is the client's own arithmetic over the month it is showing,
   * which is a label rather than a permission.
   *
   * It stays on the type because it is what the route returns and a client reading this
   * file should not have to guess at the body. What it is **not** is a second place the
   * window is decided.
   */
  open: boolean;
  whose: 'mine' | 'branch';
  meetings: AwaitingMeeting[];
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
  /** How the page names the Cell, as it stands today (owner's choice of 2026-09-19). */
  category: CellCategory | null;
  day_of_week: number | null;
  scheduled_time: string | null;
  leader: { id: string; full_name: string | null } | null;
  member_count: number;
  cell_closed_on: string | null;
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

/** `19:00` or `19:00:00` as `7:00 pm`, the way a meeting time is said aloud. */
export function timeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const hour = ((hours + 11) % 12) + 1;

  return `${hour}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'}`;
}

/**
 * "Young Pro · Fridays 7:30 pm", the owner's design's way of naming a Cell, as the Cell
 * stands today (each meeting row carries its own time); the Cell ID where there is no
 * category or schedule to name.
 */
export function cellName(
  data: Pick<CellMeetings, 'cell_id' | 'category' | 'day_of_week' | 'scheduled_time'>,
): string {
  if (data.category == null || data.day_of_week == null || data.scheduled_time == null) {
    return `Cell ${data.cell_id}`;
  }

  return `${categoryLabel(data.category)} · ${dayOfWeekLabel(data.day_of_week)}s ${timeLabel(
    data.scheduled_time,
  )}`;
}

/**
 * "CELL-000007 · led by Ana Reyes · 6 members", the line beneath a Cell's name on the
 * two screens that use it, its meetings and its members. The meeting form composes a
 * shorter line of its own. A closed Cell says when it closed in place of the count, because
 * closing a Cell ends every membership in it (section 10).
 */
export function cellSubtitle(
  data: Pick<CellMeetings, 'cell_id' | 'leader' | 'member_count' | 'cell_closed_on'>,
): string {
  const parts = [data.cell_id];

  if (data.leader?.full_name) {
    parts.push(`led by ${data.leader.full_name}`);
  }

  parts.push(
    data.cell_closed_on != null
      ? `closed on ${dayLabel(data.cell_closed_on)}`
      : data.member_count === 1
        ? '1 member'
        : `${data.member_count} members`,
  );

  return parts.join(' · ');
}

/** "Young Pro · Sat", how a list names a Cell (decision 0259, restated by 0261); the Cell ID with nothing to name. */
export function cellShortName(cell: {
  cell_id: string;
  category: CellCategory | null;
  day_of_week: number | null;
}): string {
  return cell.category != null && cell.day_of_week != null
    ? `${categoryLabel(cell.category)} · ${dayOfWeekLabel(cell.day_of_week).slice(0, 3)}`
    : cell.cell_id;
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
 * never the only carrier of meaning here, and none of these is an error. The three
 * status words are the ones section 13 fixes, so they read the same on every screen.
 */
export function meetingStateLabel(meeting: RecordedMeeting | null): string {
  if (meeting === null) {
    return 'Awaiting a record';
  }

  switch (meeting.status) {
    case 'HELD':
      return 'Met';
    case 'NOT_HELD':
      return 'Did not meet';
    case 'RESCHEDULED':
      return 'Moved';
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
/**
 * Section 15's people-without-a-Cell attention list (decision 0233).
 *
 * **It names no period**, unlike the Cells index beside it: it asks about now, so a
 * person placed in a Cell last week is already gone from it. A person leading an
 * ACTIVE Cell is excluded by the server, because a leader holds no membership row and
 * the literal reading would list every Cell Leader as needing a Cell.
 */
export async function peopleWithoutACell(
  params: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ data: PersonWithoutACell[]; next_cursor: string | null }> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const suffix = query.toString();

  return authenticatedRequest<{ data: PersonWithoutACell[]; next_cursor: string | null }>(
    `/api/v1/cells/people-without-a-cell${suffix === '' ? '' : `?${suffix}`}`,
    { signal },
  );
}

export async function listCells(
  params: {
    month: string;
    ledBy?: 'me';
    cursor?: string | null;
    q?: string;
    limit?: number;
    state?: 'ACTIVE' | 'CLOSED';
  },
  signal?: AbortSignal,
): Promise<CellIndexPage> {
  const query = new URLSearchParams({ month: params.month });
  if (params.ledBy) {
    query.set('led_by', params.ledBy);
  }
  if (params.state === 'CLOSED') {
    query.set('state', 'CLOSED');
  }
  if (params.cursor) {
    query.set('cursor', params.cursor);
  }
  // Narrows the whole scope, never the page on screen (decision 0261).
  if (params.q) {
    query.set('q', params.q);
  }
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }

  return authenticatedRequest<CellIndexPage>(`/api/v1/cells?${query.toString()}`, { signal });
}

/** A person in scope holding no active Cell membership (decision 0233). */
export interface PersonWithoutACell {
  id: string;
  member_id: string;
  full_name: string;
}

/**
 * Section 19's recording queue for one open month: what this leader owes a record for.
 *
 * One request per open month, where the Dashboard previously issued two index calls
 * and then one per Cell — and still could not reach a closed Cell's meetings at all.
 */
export async function listMeetingsAwaiting(
  month: string,
  signal?: AbortSignal,
  whose: 'mine' | 'branch' = 'mine',
): Promise<AwaitingMeetings> {
  const query = new URLSearchParams({ month, whose });

  return authenticatedRequest<AwaitingMeetings>(
    `/api/v1/cells/meetings/awaiting?${query.toString()}`,
    { signal },
  );
}

/** A Cell leadership request as its sender reads it back (decision 0269). */
export interface SentRequest {
  id: string;
  kind: 'NEW_CELL' | 'HANDOVER';
  state: 'PENDING' | 'APPROVED' | 'DECLINED';
  requested_at: string;
  decided_at: string | null;
  prospective_leader: { person_id: string; full_name: string };
  cell: { id: string; cell_id: string | null } | null;
  restart_of: { id: string; cell_id: string | null } | null;
  decline_reason:
    | 'LEADER_DEVELOPMENT_CONTINUING'
    | 'TIMING_DEFERRED'
    | 'DUPLICATE_REQUEST'
    | 'SUBMITTED_IN_ERROR'
    | 'OTHER'
    | null;
  note: string | null;
}

/**
 * The requests the signed-in account sent, pending or decided within 30 days, every
 * page. A sender has sent few, so the whole list is read rather than offered a pager.
 */
export async function listSentRequests(signal?: AbortSignal): Promise<SentRequest[]> {
  const requests: SentRequest[] = [];
  let cursor: string | null = null;

  do {
    const query = new URLSearchParams(cursor === null ? {} : { cursor });
    const page: { data: SentRequest[]; next_cursor: string | null } = await authenticatedRequest(
      `/api/v1/cells/leadership-requests/sent${query.size > 0 ? `?${query.toString()}` : ''}`,
      { signal },
    );
    requests.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor !== null);

  return requests;
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
  version?: number;
  attendance?: { person_id: string; present: boolean }[];
  correction_reason?: string;
  /** Who ran it, where that was not the leader (decision 0274). */
  facilitated_by?: string;
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

/** A current member of a Cell (SKILL.md section 10). */
export interface CellMember {
  person_id: string;
  member_id: string;
  full_name: string;
  /** When this membership began, which a report reads figures against. */
  started_at: string;
}

export interface CellMemberPage {
  data: CellMember[];
  next_cursor: string | null;
}

export async function listCellMembers(
  cellId: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<CellMemberPage> {
  const query = new URLSearchParams();
  if (cursor) {
    query.set('cursor', cursor);
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return authenticatedRequest<CellMemberPage>(`/api/v1/cells/${cellId}/members${suffix}`, {
    signal,
  });
}

/**
 * Add somebody to a Cell.
 *
 * **Who may be added is the server's question, not this client's.** Section 10
 * requires a member and the Cell's leader to share a Network, refuses somebody
 * archived or merged, and refuses somebody already in the Cell — and section 7
 * decides whether this actor may act on this Cell at all. A client that filtered
 * the directory to "eligible" people would be answering an authorization question
 * section 7 reserves to the API (principle 4), and would still be wrong about the
 * Network rule the moment a Cell changed hands.
 */
export async function addCellMember(
  cellId: string,
  personId: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/cells/${cellId}/members`, {
    method: 'POST',
    body: { person_id: personId },
    idempotencyKey,
  });
}

/**
 * End somebody's membership.
 *
 * It ends the membership rather than deleting it: section 5 forbids removing a row
 * of an effective-dated table, and section 12 reads a past month's figures against
 * the membership window. So somebody removed today still counts in the months they
 * were a member for, which is what makes a closed month reproducible.
 */
export async function removeCellMember(
  cellId: string,
  personId: string,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/cells/${cellId}/members/${personId}`, {
    method: 'DELETE',
    idempotencyKey,
  });
}

/**
 * Change a Cell's meeting day and time.
 *
 * **It takes effect at the start of the following month** (section 10, decision
 * 0057), never today. A month has exactly one schedule throughout, which is what
 * lets a coverage denominator be derived from the calendar at all — a mid-month
 * change would make the number of scheduled meetings depend on when the change was
 * filed. Every screen offering this has to say so, or a leader will expect this
 * week's meeting to move.
 */
export async function changeCellSchedule(
  cellId: string,
  schedule: { day_of_week: number; time_of_day: string },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/cells/${cellId}/schedule`, {
    method: 'PUT',
    body: schedule,
    idempotencyKey,
  });
}

/**
 * A person's current Cell, with its leader, and the Cells they lead (decision 0248).
 *
 * **The two halves are kept apart, and a screen keeps them apart too.** A Cell's
 * leader holds no membership row, so a screen reading membership alone would show
 * every Cell Leader as belonging to no Cell and offer to put them in one.
 */
export interface PersonCells {
  person_id: string;
  membership: {
    id: string;
    cell_id: string;
    /** How the People list names the Cell, as it stands today (decision 0259). */
    category: CellCategory | null;
    day_of_week: number | null;
    leader: { person_id: string; member_id: string; full_name: string } | null;
  } | null;
  leads: {
    id: string;
    cell_id: string;
    category: CellCategory | null;
    day_of_week: number | null;
  }[];
}

export async function getPersonCells(personId: string, signal?: AbortSignal): Promise<PersonCells> {
  return authenticatedRequest<PersonCells>(`/api/v1/cells/people/${personId}/membership`, {
    signal,
  });
}

/**
 * Every Cell of the actor's scope for a month, following the cursor to the end.
 *
 * For a picker, which has to offer the whole list rather than its first page. The
 * index pages by cursor and returns no total (section 22), so this asks until
 * `next_cursor` is null.
 */
export async function listAllCells(month: string, signal?: AbortSignal): Promise<CellSummary[]> {
  const cells: CellSummary[] = [];
  let cursor: string | null = null;

  do {
    const page: CellIndexPage = await listCells({ month, cursor }, signal);
    cells.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor !== null);

  return cells;
}

/**
 * What a refused membership says, in words a leader can act on (SKILL.md section 10).
 *
 * **The same-Network refusal names both Networks.** It arrives with `member_network` and
 * `cell_network` in `details`, so it is said plainly rather than in the server's wording,
 * which cites the specification. Every other refusal keeps the server's own message.
 */
export function membershipFailure(error: unknown, personName: string, cellHandle: string): Failure {
  if (error instanceof ApiRequestError && error.code === 'INVARIANT_VIOLATION') {
    const member = error.details.member_network;
    const cell = error.details.cell_network;

    if (isNetwork(member) && isNetwork(cell)) {
      return {
        message: `${personName} is in the ${networkWord(member)} Network and ${cellHandle} is in the ${networkWord(cell)}, so they can’t join it.`,
        aboutInput: false,
      };
    }
  }

  return describeFailure(error);
}

function isNetwork(value: unknown): value is 'MENS' | 'WOMENS' {
  return value === 'MENS' || value === 'WOMENS';
}

function networkWord(network: 'MENS' | 'WOMENS'): string {
  return network === 'MENS' ? 'Men’s' : 'Women’s';
}

/**
 * A Cell picker's options, with the person's pastoral leader's Cell lifted out (owner's
 * choice, 2026-09-21).
 *
 * **A grouping, not a ranking** (decision 0009). One group is lifted out under a heading
 * that says why — the Cell a disciple usually joins in G12 is their own leader's — and
 * every other Cell keeps the order the API gave, which is `cell_id` and meaningless by
 * design (section 10). Nothing is preselected: the leader still chooses.
 *
 * With no leader known, or none of theirs among the choices, there is one group and no
 * heading, which is the list exactly as it was.
 *
 * **Only the person's own Network's Cells, where their Network is known** (owner's choice,
 * 2026-09-21). Section 10 refuses the other Network's, so offering them offered a choice
 * that always failed. The add route still decides.
 */
export function pickerGroups(
  all: readonly CellSummary[],
  leaderId: string | null,
  network: 'MENS' | 'WOMENS' | null = null,
): { leaders: CellSummary[]; others: CellSummary[] } {
  const cells = network === null ? all : all.filter((cell) => cell.network === network);

  if (leaderId === null) {
    return { leaders: [], others: [...cells] };
  }

  const leaders = cells.filter((cell) => cell.leader.person_id === leaderId);
  const others = cells.filter((cell) => cell.leader.person_id !== leaderId);

  return { leaders, others };
}
