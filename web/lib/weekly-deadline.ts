/**
 * The weekly deadline's labels (SKILL.md section 13, decisions 0335 and 0387): each week is due
 * at 12 noon on the second Monday after it and closes two Mondays later, from the week of
 * 26 October 2026.
 *
 * **The server decides; these only word what it decided.** Every row that can be recorded
 * carries its own `due_at` and `closes_at` from the API, and every period its `open` flag.
 * What is computed here is the wording of a month's close, which the API sends as a flag
 * rather than a date, and whether last month is worth asking about at all. The first Monday
 * matches `weeklyDeadlineFrom` in `api/src/common/time/submission-window.ts`.
 */

import { addDays } from '@/lib/calendar-day';

const WEEKLY_FROM = '2026-10-26';

/** The Monday of the Monday-to-Sunday week a day falls in. */
function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

function lastDayOf(reportingMonth: string): string {
  const [year, month] = reportingMonth.split('-').map(Number);

  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** "Mon 23 Nov" for a `YYYY-MM-DD` day, in no zone, as a date is a date. */
function shortDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * When a month closes, as a day and whether it is at noon: its last week's close, or for a
 * month before the weekly rule the end of the 7th of the month after.
 */
function monthClose(reportingMonth: string): { day: string; noon: boolean } {
  return dayClose(lastDayOf(reportingMonth));
}

/** When the record dated `date` closes to leaders, as a day and whether it is at noon. */
function dayClose(date: string): { day: string; noon: boolean } {
  const week = weekStart(date);
  if (week < WEEKLY_FROM) {
    const [year, month] = date.split('-').map(Number);
    return { day: new Date(Date.UTC(year, month, 7)).toISOString().slice(0, 10), noon: false };
  }

  return { day: addDays(week, 28), noon: true };
}

/** "Open until Mon 23 Nov, 12NN", or "Open until 7 November" for a month before the weekly rule. */
export function monthOpenUntilLabel(reportingMonth: string): string {
  return openUntil(monthClose(reportingMonth));
}

/** The same for any period, by its last day: a week closes with its own records. */
export function periodOpenUntilLabel(lastDay: string): string {
  return openUntil(dayClose(lastDay));
}

/**
 * "Still open, until Mon 23 Nov, 12 noon": the same close in a sentence, for the note under a
 * Full view leader's report controls (decision 0363), where a tag would read as a button.
 */
export function periodStillOpenNote(lastDay: string): string {
  return openUntil(dayClose(lastDay))
    .replace('Open until', 'Still open, until')
    .replace(', 12NN', ', 12 noon');
}

function openUntil(close: { day: string; noon: boolean }): string {
  if (!close.noon) {
    const [, month, day] = close.day.split('-').map(Number);
    const name = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, month - 1, day)),
    );
    return `Open until ${day} ${name}`;
  }

  return `Open until ${shortDay(close.day)}, 12NN`;
}

/**
 * Whether a month may still be open on `today` (a Manila date), to decide whether to ask
 * for it. Generous by up to half a day around noon: the server's `open` flag decides.
 */
export function mayStillBeOpen(reportingMonth: string, today: string): boolean {
  return today <= monthClose(reportingMonth).day;
}

/** "Mon 9 Nov, 12NN" for an instant the API sent, read in Manila. */
function noonLabel(instant: string): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));

  return `${shortDay(day)}, 12NN`;
}

/**
 * A row's deadline in words (decision 0335): "Due Mon 9 Nov, 12NN" until it is due, then
 * "Late · closes Mon 23 Nov, 12NN". A row from before the weekly rule has no deadline and
 * says when it closes. Null where the server sent neither, as an older answer would.
 */
export function deadlineLabel(
  row: { due_at?: string | null; closes_at?: string },
  now: Date = new Date(),
): { late: boolean; text: string } | null {
  if (row.closes_at === undefined) {
    return null;
  }
  if (row.due_at === null || row.due_at === undefined) {
    return { late: false, text: `Closes ${closeOfMonthLabel(row.closes_at)}` };
  }
  if (now.getTime() <= new Date(row.due_at).getTime()) {
    return { late: false, text: `Due ${noonLabel(row.due_at)}` };
  }

  return { late: true, text: `Late · closes ${noonLabel(row.closes_at)}` };
}

/** The old close is midnight starting the 8th, so the day named is the 7th. */
function closeOfMonthLabel(instant: string): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(new Date(instant).getTime() - 1));

  return `end of ${shortDay(day)}`;
}

/** "Due Mon 9 Nov, 12NN" for a week by its Monday, or null for a week before the rule. */
export function weekDueLabel(monday: string): string | null {
  return weekStart(monday) < WEEKLY_FROM ? null : `Due ${shortDay(addDays(weekStart(monday), 14))}, 12NN`;
}