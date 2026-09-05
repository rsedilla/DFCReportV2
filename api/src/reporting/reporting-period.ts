import { startOfManilaDay } from '../common/time/manila';

/**
 * The instants a reporting period spans, in Asia/Manila (SKILL.md section 20).
 *
 * **The end is the last millisecond of the period's final day** (decision 0208), which is
 * what `endOfManilaDay` computes for section 13's closure boundary. Not the next day's
 * midnight: assignment rows are in force over `[started_at, ended_at)`, so a row beginning
 * exactly at midnight belongs to the following day, and handing that instant back would
 * place a November edge in October's tree. A millisecond rather than a microsecond, because
 * that is the resolution a `timestamptz` and a JavaScript `Date` share.
 *
 * **Here rather than in `common/time`, deliberately.** The arithmetic is generic and the
 * *rule* is not — which instant a period ends at is a reporting decision with a ruling
 * attached, and a reader looking for why it is 23:59:59.999 should meet that reasoning
 * rather than find a bare helper beside the calendar functions.
 */
export interface ReportingPeriod {
  /** Midnight on the first of the month, Asia/Manila. */
  start: Date;
  /** The last millisecond of the month's final day, Asia/Manila. */
  end: Date;
}

/**
 * `reportingMonth` is the first of a month, and is the caller's to validate — every caller
 * of this is downstream of `assertReportingMonth`, which refuses anything else and names
 * `period` as the field. Deriving bounds from an unvalidated month is what produced a
 * refusal quoting a month nobody sent (decision 0185's shape, one call earlier).
 *
 * **The end is one millisecond before the next month begins**, which is exactly
 * `endOfManilaDay` of the final day without having to name that day. A first version did
 * name it — stepping back inside the previous Manila day and rendering it with a second
 * `toLocaleDateString`, beside the shared formatter `manila.ts` exports as `manilaDayOf`.
 * That produced two implementations of an instant-to-Manila-day rendering in a repository
 * that has one on purpose, and its docblock described a 24-hour step while the code took a
 * 12-hour one. The subtraction is the same arithmetic `endOfManilaDay` performs, with the
 * intermediate day removed.
 *
 * The month string is built from its parts rather than by adding milliseconds, so December
 * rolls the year over on its own and no month length is assumed.
 */
export function reportingPeriodBounds(reportingMonth: string): ReportingPeriod {
  const [year, month] = reportingMonth.split('-').map(Number);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstOfNext = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;

  return {
    start: startOfManilaDay(reportingMonth),
    end: new Date(startOfManilaDay(firstOfNext).getTime() - 1),
  };
}
