import { endOfManilaDay, startOfManilaDay } from '../common/time/manila';

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
 * rather than find a bare helper beside the calendar functions. It composes the Manila
 * helpers rather than doing its own date arithmetic, so there is one implementation of a
 * day boundary in the system.
 */
export interface ReportingPeriod {
  /** Midnight on the first of the month, Asia/Manila. */
  start: Date;
  /** The last millisecond of the month's final day, Asia/Manila. */
  end: Date;
}

/**
 * `reportingMonth` is the first of a month, this repository's one spelling of one.
 *
 * The final day is derived by stepping to the first of the next month and back one day in
 * UTC, which is safe here and would not be in general: Asia/Manila observes no daylight
 * saving (section 20), so every Manila day is exactly 24 hours and no day is skipped or
 * repeated. The day *string* is then handed to `endOfManilaDay`, so the zone conversion is
 * done once, in the helper that owns it.
 */
export function reportingPeriodBounds(reportingMonth: string): ReportingPeriod {
  const [year, month] = reportingMonth.split('-').map(Number);

  // The first of the next month, as a Manila calendar date. Constructed from the parts
  // rather than by adding milliseconds, so December rolls the year over on its own.
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const firstOfNext = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;

  // One Manila day back from the first of the next month. `startOfManilaDay` gives the
  // instant, and subtracting a day lands inside the final day rather than on its boundary,
  // so the date rendered from it is that day whatever the offset.
  const insideFinalDay = new Date(startOfManilaDay(firstOfNext).getTime() - 12 * 60 * 60 * 1000);
  const finalDay = insideFinalDay.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  return { start: startOfManilaDay(reportingMonth), end: endOfManilaDay(finalDay) };
}
