import { ApiRequestError } from './api-client';
import type { RangeKind } from './report-range';
import { authenticatedRequest } from './session';

/**
 * The aggregate reporting surface as this client sees it (SKILL.md sections 9, 12,
 * 13, 17 and 20; decisions 0202, 0216, 0224 and 0225).
 *
 * **Coverage leads an aggregate view, and it is two figures.** Decision 0202
 * settles that unique people, classification and coverage are the whole of an
 * aggregate view, and that coverage comes first — because its denominator is
 * derived from the schedule rather than self-reported, so recording less makes it
 * worse and never better. Section 13 forbids dividing the two into a percentage or
 * any composite score, so nothing here returns a ratio.
 *
 * **Buckets exist at Cell scope only** (section 12). `N` belongs to a Cell, so an
 * aggregate `Completed` would mean "attended everything their own Cell happened to
 * record" and would be inflated by exactly the Cells that recorded least. The API
 * expresses that in its response type — the aggregate arm carries no `n` and no
 * `buckets` at all rather than empty ones — and this client mirrors it, so a screen
 * cannot render a bucket where section 12 forbids one.
 *
 * **`completed` is carried, never derived from the calendar.** Section 9 is explicit
 * that `Completed` means every applicable event and is never a fixed number, and
 * section 12 says the same for a Cell: "Never label buckets from the calendar
 * count." So no screen here compares `times` against 4 or 5.
 */

/** The five buckets, in the order sections 9 and 12 list them. */
export interface Classification {
  vip: number;
  second_timer: number;
  third_timer: number;
  fourth_timer: number;
  regular: number;
}

export interface AttendanceBucket {
  times: number;
  people: number;
  /** Carried by the API, because `Completed` is not a fixed number. */
  completed: boolean;
}

/** Cell coverage: meetings recorded over meetings scheduled. Never divided. */
export interface CellCoverage {
  recorded: number;
  scheduled: number;
}

/** DCC coverage: obligations met over obligations owed (decision 0224). */
export interface DccCoverage {
  met: number;
  owed: number;
}

interface MonthlyCommon {
  period: string;
  /** Section 17: an open month's figures are still changing. */
  open: boolean;
  unique_people: number;
  classification: Classification;
}

/**
 * A Cell monthly report. The two arms are the API's own, and the difference is
 * section 12's structural rule rather than a rendering choice.
 */
export type CellMonthlyReport =
  | (MonthlyCommon & {
      scope: { kind: 'CELL'; cell_id: string };
      n: number;
      buckets: AttendanceBucket[];
      coverage: CellCoverage;
    })
  | (MonthlyCommon & {
      scope: { kind: 'LEADER'; person_id: string } | { kind: 'WHOLE_CHURCH' };
      coverage: CellCoverage;
    });

export interface DccMonthlyReport extends MonthlyCommon {
  scope: unknown;
  n: number;
  /** Sundays the calendar holds that carried no service (section 9). */
  removed_events: string[];
  buckets: AttendanceBucket[];
  coverage: DccCoverage;
}

/**
 * The scopes a report may be asked for (SKILL.md sections 7, 17 and 20).
 *
 * **`NETWORK` is offered by the DCC report and not by the Cell one**, which is the
 * API's own asymmetry rather than a choice made here: what a `NETWORK`-scoped *Cell*
 * figure narrows is unstated in section 20 and recorded as open in `CLAUDE.md`, so
 * that route refuses the scope. `getCellMonthlyReport` therefore takes a narrower
 * type than this union, and the compiler is what keeps a caller from asking.
 */
export type ReportScope =
  | { kind: 'WHOLE_CHURCH' }
  | { kind: 'NETWORK'; network: ReportNetwork }
  | { kind: 'LEADER'; person_id: string }
  | { kind: 'CELL'; cell_id: string };

/** Section 4: the two Networks, which are the only values the API accepts. */
export type ReportNetwork = 'MENS' | 'WOMENS';

function query(period: string, scope: ReportScope): string {
  const params = new URLSearchParams({ period, scope: scope.kind });
  if (scope.kind === 'LEADER') {
    params.set('leader_id', scope.person_id);
  }
  if (scope.kind === 'CELL') {
    params.set('cell_id', scope.cell_id);
  }
  // Required where the scope is `NETWORK` and refused under any other, which is the
  // API's rule rather than a convenience: a request naming both a Network and a
  // leader is asking for two different things.
  if (scope.kind === 'NETWORK') {
    params.set('network', scope.network);
  }

  return params.toString();
}

export async function getCellMonthlyReport(
  period: string,
  scope: Exclude<ReportScope, { kind: 'NETWORK' }>,
  signal?: AbortSignal,
): Promise<CellMonthlyReport> {
  return authenticatedRequest<CellMonthlyReport>(
    `/api/v1/reports/cells/monthly?${query(period, scope)}`,
    { signal },
  );
}

export async function getDccMonthlyReport(
  period: string,
  scope: Exclude<ReportScope, { kind: 'CELL' }>,
  signal?: AbortSignal,
): Promise<DccMonthlyReport> {
  return authenticatedRequest<DccMonthlyReport>(
    `/api/v1/reports/dcc/monthly?${query(period, scope)}`,
    { signal },
  );
}

/** One row of My 12: people, once each, and the stage each had reached (decision 0293). */
export interface TwelveFigure {
  unique_people: number;
  classification: Classification;
}

/** My 12 over one week, month, quarter or year (decision 0293). */
export interface CellTwelve {
  kind: RangeKind;
  start: string;
  end: string;
  open: boolean;
  /** Meetings due and recorded through `through`: the current month's end at most. */
  coverage: { recorded: number; scheduled: number; through: string };
  /**
   * In first-name order, or Network order where `network` is set. `leader` is null for a row the reader may not open. `network` is set
   * on a whole-church reader's rows, the Network roots, which are labelled by it.
   */
  rows: (TwelveFigure & {
    leader: { id: string; member_id: string; full_name: string } | null;
    network?: 'MENS' | 'WOMENS' | null;
    /** On the Senior Pastors' tables, the root a row's leader sits under (decision 0326). */
    root_id?: string | null;
  })[];
  /** On the Senior Pastors' tables, the two roots, Men's first, each named with their title. */
  roots?: { id: string; full_name: string | null; network: 'MENS' | 'WOMENS' | null }[];
  /** The subject's own Cell groups; null for Whole Church. */
  own: (TwelveFigure & { cells: number }) | null;
  /** Counts beyond a person's first, for somebody in more than one row. */
  overlap: number;
  /** People in the total and in no row. */
  elsewhere: number;
  total: TwelveFigure;
  /** The DCC calendar's first Sunday, or null before it has one (decision 0310). */
  calendar_start: string | null;
}

/**
 * DCC's My 12 over one period (decision 0294): the Cell table's shape, with `own` the reader
 * alone, the period's services as `n`, and buckets for a month only.
 */
export interface DccTwelve extends Omit<CellTwelve, 'coverage' | 'own'> {
  coverage: DccCoverage;
  n: number;
  removed_events: string[];
  own: TwelveFigure | null;
  buckets: AttendanceBucket[] | null;
}

/** `GET /reports/dcc/twelve`, retried once with the guard month the API names, as below. */
export async function getDccTwelve(
  kind: RangeKind,
  start: string,
  guardMonth: string,
  subject:
    | { kind: 'LEADER'; person_id: string }
    | { kind: 'WHOLE_CHURCH' }
    | { kind: 'NETWORK'; network: ReportNetwork }
    | { kind: 'ROOT_LEADERS' },
  signal?: AbortSignal,
): Promise<DccTwelve> {
  const params = twelveParams(kind, start, guardMonth, subject);
  try {
    return await authenticatedRequest<DccTwelve>(`/api/v1/reports/dcc/twelve?${params.toString()}`, {
      signal,
    });
  } catch (error) {
    const expected = error instanceof ApiRequestError ? error.details.expected : undefined;
    if (typeof expected !== 'string' || expected === guardMonth) {
      throw error;
    }
    params.set('period', expected);

    return authenticatedRequest<DccTwelve>(`/api/v1/reports/dcc/twelve?${params.toString()}`, {
      signal,
    });
  }
}

/** `GET /reports/cells/twelve`: a leader's, or Whole Church for a whole-church reader. */
export async function getCellTwelve(
  kind: RangeKind,
  start: string,
  guardMonth: string,
  subject: { kind: 'LEADER'; person_id: string } | { kind: 'WHOLE_CHURCH' } | { kind: 'ROOT_LEADERS' },
  signal?: AbortSignal,
): Promise<CellTwelve> {
  const params = twelveParams(kind, start, guardMonth, subject);

  try {
    return await authenticatedRequest<CellTwelve>(
      `/api/v1/reports/cells/twelve?${params.toString()}`,
      { signal },
    );
  } catch (error) {
    // Across a Manila midnight at a month's end, this device's clock and the database's can
    // disagree about the month the guard reads. The refusal names the month it expects, so
    // the request is made once more with it; any other refusal is the caller's to show.
    const expected = error instanceof ApiRequestError ? error.details.expected : undefined;
    if (typeof expected !== 'string' || expected === guardMonth) {
      throw error;
    }
    params.set('period', expected);

    return authenticatedRequest<CellTwelve>(
      `/api/v1/reports/cells/twelve?${params.toString()}`,
      { signal },
    );
  }
}

/** One column of *Recording Progress*: X of Y leaders (decision 0325). */
export interface RecordingColumn {
  recorded: number;
  owed: number;
  /** Of `recorded`, those who recorded all of it but some after its deadline (decision 0335). */
  late?: number;
}

export type RecordingRowStatus =
  | { kind: 'COMPLETED' }
  | { kind: 'STILL_TO_RECORD'; leaders: number }
  | { kind: 'NOTHING_OWED' };

export interface RecordingRow {
  leader: { id: string; member_id: string | null; full_name: string | null };
  cell: RecordingColumn;
  dcc: RecordingColumn;
  status: RecordingRowStatus;
  /**
   * Whether the row's leader is under the reader now for each Pending list, so its figure may
   * link there (decision 0370). A leader moved since the period is named and not linked.
   */
  opens_pending: { cell: boolean; dcc: boolean };
}

/** `GET /reports/recording-status` (decision 0325). The percentages are the server's. */
export interface RecordingStatus {
  kind: 'WEEK' | 'MONTH';
  start: string;
  end: string;
  open: boolean;
  /** Whether the period has a deadline in it, so counts are on time (decision 0335). */
  deadline?: boolean;
  whole_church: {
    cell: RecordingColumn & { percent: number | null };
    dcc: RecordingColumn & { percent: number | null };
  };
  previous: {
    start: string;
    end: string;
    open: boolean;
    deadline?: boolean;
    cell: RecordingColumn;
    dcc: RecordingColumn;
  };
  /** Null where the placement graph is refused (section 20); the boxes stand. */
  tables:
    | {
        root: { id: string; member_id: string | null; full_name: string | null };
        network: 'MENS' | 'WOMENS' | null;
        rows: RecordingRow[];
      }[]
    | null;
  others: Omit<RecordingRow, 'leader'> | null;
}

/** A Full view leader's *Recording Progress* (decision 0334): their branch and their 12. */
export interface LeaderRecordingStatus {
  kind: 'WEEK' | 'MONTH';
  start: string;
  end: string;
  open: boolean;
  deadline?: boolean;
  /** Null where the placement graph is refused (section 20), and so are the rows. */
  branch: {
    cell: RecordingColumn & { percent: number | null };
    dcc: RecordingColumn & { percent: number | null };
  } | null;
  previous: {
    start: string;
    end: string;
    open: boolean;
    deadline?: boolean;
    cell: RecordingColumn | null;
    dcc: RecordingColumn | null;
  };
  rows: RecordingRow[] | null;
  others: Omit<RecordingRow, 'leader'> | null;
}

/** `GET /reports/recording-status/leader`, retried once with the guard month the API names. */
export async function getLeaderRecordingStatus(
  leaderId: string,
  kind: 'WEEK' | 'MONTH',
  start: string,
  guardMonth: string,
  signal?: AbortSignal,
): Promise<LeaderRecordingStatus> {
  const params = new URLSearchParams({
    scope: 'LEADER',
    leader_id: leaderId,
    kind,
    start,
    period: guardMonth,
  });
  const path = () => `/api/v1/reports/recording-status/leader?${params.toString()}`;

  try {
    return await authenticatedRequest<LeaderRecordingStatus>(path(), { signal });
  } catch (error) {
    const expected = error instanceof ApiRequestError ? error.details.expected : undefined;
    if (typeof expected !== 'string' || expected === guardMonth) {
      throw error;
    }
    params.set('period', expected);

    return authenticatedRequest<LeaderRecordingStatus>(path(), { signal });
  }
}

/** `GET /reports/recording-status`, retried once with the guard month the API names. */
export async function getRecordingStatus(
  kind: 'WEEK' | 'MONTH',
  start: string,
  guardMonth: string,
  signal?: AbortSignal,
): Promise<RecordingStatus> {
  const params = new URLSearchParams({ kind, start, period: guardMonth });

  try {
    return await authenticatedRequest<RecordingStatus>(
      `/api/v1/reports/recording-status?${params.toString()}`,
      { signal },
    );
  } catch (error) {
    const expected = error instanceof ApiRequestError ? error.details.expected : undefined;
    if (typeof expected !== 'string' || expected === guardMonth) {
      throw error;
    }
    params.set('period', expected);

    return authenticatedRequest<RecordingStatus>(
      `/api/v1/reports/recording-status?${params.toString()}`,
      { signal },
    );
  }
}
/**
 * A My 12 request's query. The Senior Pastors' tables (decision 0326) are Whole Church's
 * figures with each root's direct leaders as the rows, asked for as `rows=ROOT_LEADERS`.
 */
function twelveParams(
  kind: RangeKind,
  start: string,
  guardMonth: string,
  subject:
    | { kind: 'LEADER'; person_id: string }
    | { kind: 'WHOLE_CHURCH' }
    | { kind: 'NETWORK'; network: ReportNetwork }
    | { kind: 'ROOT_LEADERS' },
): URLSearchParams {
  const params = new URLSearchParams({
    kind,
    start,
    period: guardMonth,
    scope: subject.kind === 'ROOT_LEADERS' ? 'WHOLE_CHURCH' : subject.kind,
  });
  if (subject.kind === 'LEADER') {
    params.set('leader_id', subject.person_id);
  }
  if (subject.kind === 'NETWORK') {
    params.set('network', subject.network);
  }
  if (subject.kind === 'ROOT_LEADERS') {
    params.set('rows', 'ROOT_LEADERS');
  }
  return params;
}

/** One scope's *Number of Cells* and *Number of people* (decision 0326). */
export interface ChurchCountFigures {
  cell_groups: number;
  youth: number;
  young_pro: number;
  couple: number;
  cell_leaders: number;
  people: number;
}

/** `GET /reports/church-counts`: a month's counts, the current one *so far* (decision 0326). */
export interface ChurchCounts {
  period: string;
  current: boolean;
  at: string;
  whole_church: ChurchCountFigures;
  /** Null where the placement graph is refused (section 20); the whole church stands. */
  tables:
    | {
        root: { id: string; member_id: string | null; full_name: string | null };
        network: 'MENS' | 'WOMENS' | null;
        rows: (ChurchCountFigures & {
          leader: { id: string; member_id: string | null; full_name: string | null };
        })[];
      }[]
    | null;
  others: ChurchCountFigures | null;
}

export async function getChurchCounts(period: string, signal?: AbortSignal): Promise<ChurchCounts> {
  return authenticatedRequest<ChurchCounts>(
    `/api/v1/reports/church-counts?${new URLSearchParams({ period }).toString()}`,
    { signal },
  );
}

/**
 * `GET /reports/people/branch`: *# of People* for one leader's branch (decision 0364). The three
 * figures are null where the placement graph is refused (section 20).
 */
export interface BranchPeople {
  period: string;
  current: boolean;
  at: string;
  total: number | null;
  own: number | null;
  rows:
    | {
        /** Null for a leader the reader may not open; the row still counts. */
        leader: { id: string; member_id: string | null; full_name: string | null } | null;
        people: number;
      }[]
    | null;
}

export async function getBranchPeople(
  leaderId: string,
  period: string,
  signal?: AbortSignal,
): Promise<BranchPeople> {
  return authenticatedRequest<BranchPeople>(
    `/api/v1/reports/people/branch?${new URLSearchParams({ period, scope: 'LEADER', leader_id: leaderId }).toString()}`,
    { signal },
  );
}

export type TrendFigure = 'CG' | 'DCC' | 'CELLS' | 'CELL_LEADERS' | 'PEOPLE';

/** `GET /reports/trends`: twelve months of one figure (decision 0326, point 4). */
export interface Trends {
  figure: TrendFigure;
  months: string[];
  current: string;
  /** One per month: whether it is still open, the current one and last month until the 7th. */
  open: boolean[];
  /** Whole Church first (`leader` null), then each root's branch; or one leader's branch. */
  lines: {
    leader: { id: string; member_id: string | null; full_name: string | null } | null;
    /** A root's branch names its Network; the church and one leader carry none. */
    network: 'MENS' | 'WOMENS' | null;
    /** One per month; null for a month the figure could not be read for. */
    values: (number | null)[];
  }[];
}

export async function getTrends(
  figure: TrendFigure,
  leaderId: string | null,
  signal?: AbortSignal,
): Promise<Trends> {
  const params = new URLSearchParams({ figure });
  if (leaderId !== null) {
    params.set('leader_id', leaderId);
  }
  return authenticatedRequest<Trends>(`/api/v1/reports/trends?${params.toString()}`, { signal });
}
