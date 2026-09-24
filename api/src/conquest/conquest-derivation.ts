/**
 * The arithmetic behind Conquest's derived dates (SKILL.md section 27; decisions 0284
 * and 0285), kept free of the database so it can be tested on its own.
 *
 * Every period is half-open, `[start, end)`, as every effective-dated table here is,
 * and an end of `null` is still in force.
 */

export interface Period {
  start: number;
  end: number;
}

const OPEN = Number.POSITIVE_INFINITY;

export function period(start: Date, end: Date | null): Period {
  return { start: start.getTime(), end: end === null ? OPEN : end.getTime() };
}

/** Where two periods overlap, or null where they do not. */
export function overlap(left: Period, right: Period): Period | null {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start < end ? { start, end } : null;
}

/**
 * The earliest instant at which at least `target` of these disciples are counted at
 * once, or null where that never happened. Each disciple's periods are merged first,
 * so a disciple with two edges, or two Cells at once, counts once.
 */
export function earliestReached(
  periodsByDisciple: ReadonlyMap<string, readonly Period[]>,
  target: number,
): number | null {
  const events: { at: number; delta: number }[] = [];

  for (const periods of periodsByDisciple.values()) {
    for (const merged of union(periods)) {
      events.push({ at: merged.start, delta: 1 });
      if (merged.end !== OPEN) {
        events.push({ at: merged.end, delta: -1 });
      }
    }
  }

  // An ending sorts before a start at the same instant: a period ending at `t` is not
  // in force at `t`.
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);

  let count = 0;
  for (const event of events) {
    count += event.delta;
    if (count >= target) {
      return event.at;
    }
  }

  return null;
}

/** How many of these disciples are counted at this instant. */
export function countedAt(
  periodsByDisciple: ReadonlyMap<string, readonly Period[]>,
  at: number,
): number {
  let count = 0;

  for (const periods of periodsByDisciple.values()) {
    if (periods.some((entry) => entry.start <= at && at < entry.end)) {
      count += 1;
    }
  }

  return count;
}

function union(periods: readonly Period[]): Period[] {
  const sorted = [...periods].sort((left, right) => left.start - right.start);
  const merged: Period[] = [];

  for (const entry of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && entry.start <= last.end) {
      last.end = Math.max(last.end, entry.end);
    } else {
      merged.push({ ...entry });
    }
  }

  return merged;
}
