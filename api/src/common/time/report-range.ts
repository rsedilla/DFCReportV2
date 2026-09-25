import { ValidationFailedError } from '../errors/api-error';
import { isCalendarDate } from './manila';

/**
 * The four periods a My 12 table is read over (SKILL.md section 20, decision 0293).
 *
 * **One rule on four lengths.** A person's journey stage is their lifetime Cell attendance
 * counted through the period's last day, which is section 12's month rule unchanged: a
 * week, a quarter or a year is the same question asked over a shorter or longer run of
 * days. A week runs Monday to Sunday (decision 0054); quarters and years are the
 * calendar's.
 */
export type ReportRangeKind = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export const REPORT_RANGE_KINDS: readonly ReportRangeKind[] = ['WEEK', 'MONTH', 'QUARTER', 'YEAR'];

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);

  return { year, month, day };
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days are added in UTC arithmetic on a calendar date, which carries no time zone. */
function addDays(date: string, days: number): string {
  const { year, month, day } = parts(date);
  const at = new Date(Date.UTC(year, month - 1, day + days));

  return format(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** The last day of the month `months` after the one holding `date`'s first. */
function lastDayAfter(date: string, months: number): string {
  const { year, month } = parts(date);
  const end = new Date(Date.UTC(year, month - 1 + months, 0));

  return format(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
}

/**
 * A period's first day must be where that kind of period begins: a Monday, the first of a
 * month, the first of January, April, July or October, or the first of January. Anything
 * else is refused naming `start`, because a period that begins mid-week would be a
 * different period with the same name.
 */
export function assertReportRangeStart(kind: ReportRangeKind, start: string): void {
  const refuse = (message: string) => {
    throw new ValidationFailedError(message, { field: 'start', value: start });
  };

  if (!isCalendarDate(start) || start.startsWith('9999')) {
    refuse('A period starts on a calendar date, as YYYY-MM-DD.');
  }

  const { month, day } = parts(start);
  const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();

  if (kind === 'WEEK' && weekday !== 1) {
    refuse('A week starts on a Monday.');
  }
  if (kind === 'MONTH' && day !== 1) {
    refuse('A month starts on its first day.');
  }
  if (kind === 'QUARTER' && (day !== 1 || ![1, 4, 7, 10].includes(month))) {
    refuse('A quarter starts on the first of January, April, July or October.');
  }
  if (kind === 'YEAR' && (day !== 1 || month !== 1)) {
    refuse('A year starts on the first of January.');
  }
}

/** The period's last day, a calendar date. `start` is the caller's to validate. */
export function reportRangeEnd(kind: ReportRangeKind, start: string): string {
  switch (kind) {
    case 'WEEK':
      return addDays(start, 6);
    case 'MONTH':
      return lastDayAfter(start, 1);
    case 'QUARTER':
      return lastDayAfter(start, 3);
    case 'YEAR':
      return lastDayAfter(start, 12);
  }
}

/**
 * The reporting month the capability guard resolves a range's scope at.
 *
 * **The guard reads a month, so a range names one** — and that month is derived here rather
 * than chosen by a client, which the route enforces by refusing any other. It is the month
 * holding the range's last day, or the current month where that one has not begun: a report
 * resolves at the period's final millisecond, open or closed (decision 0218), and a
 * running year's December has not begun and so cannot be named (decision 0216). No write
 * can place a pastoral assignment in the future, so resolving at the end of the current
 * month instead of at a December still to come reaches the same tree.
 */
export function reportRangeGuardMonth(kind: ReportRangeKind, start: string, today: string): string {
  const end = reportRangeEnd(kind, start);
  const last = end < today ? end : today;

  return `${last.slice(0, 7)}-01`;
}
