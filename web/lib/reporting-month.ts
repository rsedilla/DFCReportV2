/**
 * The one spelling of a month this client uses (SKILL.md section 20).
 *
 * Every route that takes a period takes `YYYY-MM-01`, a **Manila** date. These
 * helpers exist so no screen builds one by string arithmetic on its own, and so
 * that "this month" means the same thing on every screen.
 *
 * **The month is derived from the browser's clock and the server decides.** A
 * phone in another time zone can be a day either side of Manila, so the value
 * here is a starting point for a picker rather than an authority: the API reads
 * every boundary from the database (decision 0160), and a request for a month
 * that has not begun is refused there (decision 0216). What this must not do is
 * pretend to be the authority and quietly disagree with it.
 */

const MANILA = 'Asia/Manila';

/** The parts of a Manila date, without pulling in a date library. */
function manilaParts(at: Date): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA,
    year: 'numeric',
    month: '2-digit',
  });

  const [year, month] = formatter.format(at).split('-').map(Number);

  return { year, month };
}

/** `YYYY-MM-01` for the month containing `at` in Manila. */
export function reportingMonthOf(at: Date = new Date()): string {
  const { year, month } = manilaParts(at);

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** The month before or after this one, as the same `YYYY-MM-01` spelling. */
export function shiftMonth(reportingMonth: string, by: number): string {
  const [year, month] = reportingMonth.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + by;

  return `${String(Math.floor(zeroBased / 12)).padStart(4, '0')}-${String((zeroBased % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * A month as a person reads it — "June 2026".
 *
 * Formatted from the parts rather than from a `Date` in the viewer's zone: the
 * first of a Manila month is the last day of the previous one in the Americas,
 * and a heading that disagrees with the figures underneath it is worse than an
 * unformatted string.
 */
export function monthLabel(reportingMonth: string): string {
  const [year, month] = reportingMonth.split('-').map(Number);

  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  );
}

/** A `YYYY-MM-DD` day as a person reads it — "Sunday 7 June". */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Whether this month is later than the current Manila one, which no report covers. */
export function hasNotBegun(reportingMonth: string): boolean {
  return reportingMonth > reportingMonthOf();
}
