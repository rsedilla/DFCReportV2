import { rangeLabel, rangeStartOf, shiftRange, type RangeKind } from './report-range';

/**
 * What a reader without Reports at Whole Church is offered on Quarterly and Year (SKILL.md
 * section 19, decision 0310): finished periods only, the last four quarters and the last
 * year, none ending before the DCC calendar's first Sunday. The API answers any period that
 * has begun; this decides what the two report screens offer.
 */
export function isFinishedOnlyKind(kind: RangeKind): boolean {
  return kind === 'QUARTER' || kind === 'YEAR';
}

/** How many periods before the latest finished one a leader may step back to. */
const BACK: Record<'QUARTER' | 'YEAR', number> = { QUARTER: 3, YEAR: 0 };

/** The last period of this kind whose last day has passed. */
export function latestFinished(kind: RangeKind, today: string): string {
  return shiftRange(kind, rangeStartOf(kind, today), -1);
}

export type LeaderReach =
  | { kind: 'open'; earliest: string; latest: string }
  /** Nothing to offer yet: `first` is the first period it will be, or null with no calendar. */
  | { kind: 'none'; first: string | null };

export function leaderReach(
  kind: 'QUARTER' | 'YEAR',
  today: string,
  calendarStart: string | null,
): LeaderReach {
  if (calendarStart === null) {
    return { kind: 'none', first: null };
  }
  const latest = latestFinished(kind, today);
  // The period holding the first Sunday is the first that does not end before it.
  const floor = rangeStartOf(kind, calendarStart);
  const rolling = shiftRange(kind, latest, -BACK[kind]);
  const earliest = floor > rolling ? floor : rolling;

  return earliest > latest ? { kind: 'none', first: floor } : { kind: 'open', earliest, latest };
}

/**
 * The period a report screen shows, and why it is not the one the address asked for.
 *
 * `calendarStart` is `undefined` until the screen has read it from a report answer, and then
 * nothing is chosen yet: a leader's screen must not show a figure it would then take away.
 */
export function choosePeriod(
  kind: 'QUARTER' | 'YEAR',
  today: string,
  startParam: string | null,
  finishedOnly: boolean,
  calendarStart: string | null | undefined,
):
  | { ready: false }
  | { ready: true; reach: LeaderReach | null; start: string | null; moved: 'LATER' | 'EARLIER' | null; asked: string } {
  const current = rangeStartOf(kind, today);
  if (!finishedOnly) {
    const asked = rangeStartOf(kind, startParam ?? current);
    // A period that has not begun is not reported (decision 0216).
    return { ready: true, reach: null, start: asked > current ? current : asked, moved: null, asked };
  }
  if (calendarStart === undefined) {
    return { ready: false };
  }

  const reach = leaderReach(kind, today, calendarStart);
  const asked = startParam === null ? latestFinished(kind, today) : rangeStartOf(kind, startParam);
  if (reach.kind === 'none') {
    return { ready: true, reach, start: null, moved: null, asked };
  }
  const moved = asked > reach.latest ? 'LATER' : asked < reach.earliest ? 'EARLIER' : null;

  return { ready: true, reach, start: moved === null ? asked : reach.latest, moved, asked };
}

/** "1 January", or "1 January 2027" with the year. */
export function opensOnLabel(date: string, withYear: boolean): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** "Q4 2026 · Oct–Dec opens on 1 January.", for the period after `start`. */
export function nextOpensLine(kind: 'QUARTER' | 'YEAR', start: string): string {
  const next = shiftRange(kind, start, 1);

  return `${rangeLabel(kind, next)} opens on ${opensOnLabel(shiftRange(kind, next, 1), kind === 'YEAR')}.`;
}
