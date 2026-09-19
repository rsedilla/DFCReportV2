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

/** Whether a report carries buckets — true only at Cell scope (section 12). */
export function hasBuckets(
  report: CellMonthlyReport,
): report is Extract<CellMonthlyReport, { n: number }> {
  return 'buckets' in report;
}

export const CLASSIFICATION_LABELS: { key: keyof Classification; label: string }[] = [
  { key: 'vip', label: 'VIP' },
  { key: 'second_timer', label: '2nd Timer' },
  { key: 'third_timer', label: '3rd Timer' },
  { key: 'fourth_timer', label: '4th Timer' },
  { key: 'regular', label: 'Regular' },
];

/** One named row of a report's coverage by leader (decision 0254). */
export interface ByLeaderRow {
  leader: { id: string; member_id: string; full_name: string };
  filed: number;
  owed: number;
}

/**
 * A page of a report's coverage by leader (decision 0254). Each row counts that leader's own
 * obligations; `others` is every leader the reader could not open, named nobody, null when
 * it counts nothing; `total` is the report's own coverage, which the rows and `others` add
 * up to.
 */
export interface ByLeaderPage {
  period: string;
  open: boolean;
  data: ByLeaderRow[];
  others: { filed: number; owed: number } | null;
  total: { filed: number; owed: number };
  next_cursor: string | null;
}

/** Ten at a time, as the design pages the table. */
const BY_LEADER_PAGE = '10';

export async function getCoverageByLeader(
  report: 'dcc' | 'cells',
  period: string,
  scope: ReportScope,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<ByLeaderPage> {
  const params = new URLSearchParams(query(period, scope));
  params.set('limit', BY_LEADER_PAGE);
  if (cursor) {
    params.set('cursor', cursor);
  }

  return authenticatedRequest<ByLeaderPage>(
    `/api/v1/reports/${report}/monthly/by-leader?${params.toString()}`,
    { signal },
  );
}
