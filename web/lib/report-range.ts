/**
 * The four periods of the Cell Groups report (SKILL.md section 20, decision 0293), as a
 * screen steps through them. The API derives the same bounds and refuses a period that does
 * not start where its kind starts, so these helpers only decide what to ask for.
 *
 * A week runs Monday to Sunday (decision 0054); quarters and years are the calendar's.
 */
export type RangeKind = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);

  return [year, month, day];
}

function iso(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);

  return iso(new Date(Date.UTC(year, month - 1, day + days)));
}

function addMonths(date: string, months: number): string {
  const [year, month] = parts(date);

  return iso(new Date(Date.UTC(year, month - 1 + months, 1)));
}

/** Where the period of this kind holding `date` begins. */
export function rangeStartOf(kind: RangeKind, date: string): string {
  const [year, month] = parts(date);

  switch (kind) {
    case 'WEEK': {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return addDays(date, weekday === 0 ? -6 : 1 - weekday);
    }
    case 'MONTH':
      return `${date.slice(0, 7)}-01`;
    case 'QUARTER':
      return iso(new Date(Date.UTC(year, Math.floor((month - 1) / 3) * 3, 1)));
    case 'YEAR':
      return `${String(year).padStart(4, '0')}-01-01`;
  }
}

/** The period's last day. */
export function rangeEndOf(kind: RangeKind, start: string): string {
  switch (kind) {
    case 'WEEK':
      return addDays(start, 6);
    case 'MONTH':
      return addDays(addMonths(start, 1), -1);
    case 'QUARTER':
      return addDays(addMonths(start, 3), -1);
    case 'YEAR':
      return addDays(addMonths(start, 12), -1);
  }
}

/** The period before (-1) or after (+1) this one. */
export function shiftRange(kind: RangeKind, start: string, step: number): string {
  switch (kind) {
    case 'WEEK':
      return addDays(start, 7 * step);
    case 'MONTH':
      return addMonths(start, step);
    case 'QUARTER':
      return addMonths(start, 3 * step);
    case 'YEAR':
      return addMonths(start, 12 * step);
  }
}

/**
 * The month the API's guard resolves the period at: the one holding its last day, or the
 * current month where that one has not begun. The API derives it too and refuses any other.
 */
export function rangeGuardMonth(kind: RangeKind, start: string, today: string): string {
  const end = rangeEndOf(kind, start);

  return `${(end < today ? end : today).slice(0, 7)}-01`;
}

function day(date: string, withYear: boolean): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** How the period is named on the screen. */
export function rangeLabel(kind: RangeKind, start: string): string {
  const [year, month] = parts(start);
  const monthName = (m: number) =>
    new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

  switch (kind) {
    case 'WEEK':
      return `${day(start, false)} – ${day(rangeEndOf(kind, start), true)}`;
    case 'MONTH':
      return `${monthName(month)} ${year}`;
    case 'QUARTER':
      return `Q${Math.floor((month - 1) / 3) + 1} ${year} · ${monthName(month).slice(0, 3)}–${monthName(month + 2).slice(0, 3)}`;
    case 'YEAR':
      return String(year);
  }
}
