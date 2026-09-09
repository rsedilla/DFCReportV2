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
  | (MonthlyCommon & { scope: { kind: 'CELL'; cell_id: string }; n: number; buckets: AttendanceBucket[]; coverage: CellCoverage })
  | (MonthlyCommon & { scope: { kind: 'LEADER'; person_id: string } | { kind: 'WHOLE_CHURCH' }; coverage: CellCoverage });

export interface DccMonthlyReport extends MonthlyCommon {
  scope: unknown;
  n: number;
  /** Sundays the calendar holds that carried no service (section 9). */
  removed_events: string[];
  buckets: AttendanceBucket[];
  coverage: DccCoverage;
}

export type ReportScope =
  | { kind: 'WHOLE_CHURCH' }
  | { kind: 'LEADER'; person_id: string }
  | { kind: 'CELL'; cell_id: string };

function query(period: string, scope: ReportScope): string {
  const params = new URLSearchParams({ period, scope: scope.kind });
  if (scope.kind === 'LEADER') {
    params.set('leader_id', scope.person_id);
  }
  if (scope.kind === 'CELL') {
    params.set('cell_id', scope.cell_id);
  }

  return params.toString();
}

export async function getCellMonthlyReport(
  period: string,
  scope: ReportScope,
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
