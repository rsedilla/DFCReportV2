import { ValidationFailedError } from '../errors/api-error';

/**
 * Dates and instants, in the church's time zone (SKILL.md section 20).
 *
 * Section 20 is the single authority for every period boundary in the system, and
 * it names the zone rather than the offset: Asia/Manila observes no daylight
 * saving today, and hard-coding `+08:00` would be a silent defect on the day that
 * stops being true. Everything here goes through `Intl` with the named zone, so
 * nothing in this file knows what the offset is.
 *
 * These are pure functions with no database access, which is why they can be
 * exercised without one.
 */

const ZONE = 'Asia/Manila';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // `h23` rather than `hour12: false`. The latter renders midnight as hour 24 in
  // some ICU versions, which would put the start of a day at the end of the
  // previous one -- the exact class of defect section 20 exists to prevent.
  hourCycle: 'h23',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(instant: Date): WallClock {
  const parts = PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new Error(`Intl did not render a ${type} for ${ZONE}.`);
    }
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far the zone's wall clock runs ahead of UTC at this instant. */
function offsetMsAt(instant: Date): number {
  const wall = wallClockAt(instant);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );

  // The instant's own sub-second part is not in the formatted output and is not
  // part of an offset, so it is removed before the comparison.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The Asia/Manila calendar day an instant falls in, as `YYYY-MM-DD`. */
export function manilaDayOf(instant: Date): string {
  const wall = wallClockAt(instant);
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

/**
 * Whether a string is a `YYYY-MM-DD` date that **exists** (SKILL.md section 20).
 *
 * **A shape check is not a date check, and the difference is a 500.** `2026-09-31`,
 * `2026-02-30` and `2026-13-05` all satisfy `\d{4}-\d{2}-\d{2}` and none of them is a
 * day. PostgreSQL refuses each with `22008 date/time field value out of range`, which
 * no error filter here recognises — so a value that passes a shape check and reaches a
 * `::date` cast answers `INTERNAL_ERROR` rather than a refusal, on a documented path
 * parameter.
 *
 * That is not hypothetical: the capability guard's first version of the Cell-meeting
 * target validated the shape, said in its own comment that a malformed value "would
 * reach the port and be compared as a `date` in SQL, answering with a database error
 * rather than a refusal", and then admitted four such values. Because the guard runs
 * before `authorize`, any authenticated caller reached it — and the 500 arrived only
 * for a closed Cell in an open month, which made it an oracle for that state.
 *
 * **Round-tripped rather than range-checked**, so leap years need no special case:
 * `Date.UTC` normalises an impossible day into the following month, and a component
 * that comes back changed is one that did not exist. Month `13` rolls the year, day
 * `00` rolls the month, and both are caught by the same comparison.
 *
 * **It is not exactly `::date`, and the one divergence is years 1 to 99.** PostgreSQL
 * accepts `0026-01-01`; this refuses it, because `Date.UTC(26, ...)` applies the legacy
 * two-digit-year mapping and returns 1926 — so the component "comes back changed" for a
 * reason that is a coercion rather than an impossible date, which is the one case where
 * the sentence above describes the mechanism and not the meaning. The direction is
 * fail-safe, a refusal rather than a cast error, and no record in this system carries a
 * first-century date. Stated because the equivalence with `::date` is what the guard's
 * refusal rests on, and it is very nearly exact rather than exact.
 *
 * It says nothing about zones — a calendar date is the same date everywhere, and the
 * zone matters only once it becomes an instant, which is `startOfManilaDay`'s job.
 */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * The instant at which an Asia/Manila calendar day begins.
 *
 * A date-only field that has to become an instant takes 00:00:00 of that day in
 * this zone (SKILL.md section 20). An effective date is the case that arises
 * first: section 4 requires a Network change and the reassignment it forces to
 * share one exact instant, and a day cannot be that on its own.
 *
 * Two passes, because the offset is a function of the instant and the instant is
 * what is being solved for. The first pass reads the offset near the answer and
 * the second confirms it; they differ only where a zone transition falls inside
 * the day, which Asia/Manila has not had since 1978 and which this does not
 * assume.
 */
export function startOfManilaDay(day: string): Date {
  // **`isCalendarDate` rather than the shape alone, and the shape alone silently
  // invented days.** `Date.UTC` normalises an impossible day into the following month,
  // so `2026-02-30` came back as 2026-03-02 and every caller downstream was handed a
  // plausible instant for a day nobody named. `CloseCellDto.effective_date` reached
  // here with a shape check alone and wrote a Cell closure on that invented day, into
  // an effective-dated history table, reporting the invented date back in the response
  // and the audit entry — with no error anywhere on the path.
  //
  // The edge is where such a value is refused (section 22, ruling of 2026-09-02) and
  // every date-only DTO field now carries `IsManilaCalendarDate`. This is the backstop
  // for the next caller that forgets, on `reportingMonthOf`'s reasoning: a backstop
  // that answers `INTERNAL_ERROR` is not one, so it throws the refusal the edge would
  // have thrown rather than a plain `Error`.
  //
  // One branch rather than two, and the shape half is not separable from it: the
  // predicate anchors the same expression, so a value failing the shape fails the
  // predicate and a second branch for it would be unreachable.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null || !isCalendarDate(day)) {
    throw new ValidationFailedError(`"${day}" is not a YYYY-MM-DD date that exists.`, {
      field: 'date',
      value: day,
    });
  }

  const asIfUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  const firstPass = asIfUtc - offsetMsAt(new Date(asIfUtc));
  const secondPass = asIfUtc - offsetMsAt(new Date(firstPass));

  return new Date(secondPass);
}

/**
 * The last instant of an Asia/Manila day, as an instant.
 *
 * A day is a period and every effective-dated table in this schema is read at an
 * *instant*, so a rule phrased over a day — section 9 fixes a DCC responsible
 * leader "as of the event date" — has to name one. This is that instant.
 *
 * **The last millisecond, not the first instant of the next day.** Rows are in
 * force over `[started_at, ended_at)`, so an assignment beginning exactly at
 * midnight belongs to the following day; handing that midnight back as "the end of
 * this day" would pick it up. Stepping back one millisecond is what excludes it,
 * and it costs the final millisecond of the day: an assignment whose boundary lands
 * inside it resolves to its predecessor. Nothing in this system can place a
 * boundary there deliberately — an effective date is a day, and an undated write
 * takes `clock_timestamp()` — so the exposure is one clock tick in 86.4 million per
 * day, against a rule that has to name some instant.
 *
 * A millisecond rather than a microsecond because that is the resolution both ends
 * share: PostgreSQL stores `timestamptz` to the microsecond and a JavaScript `Date`
 * holds milliseconds, so a microsecond step would not survive the round trip and
 * would silently become no step at all.
 */
export function endOfManilaDay(day: string): Date {
  return new Date(startOfManilaDay(manilaDayAfter(startOfManilaDay(day))).getTime() - 1);
}

/**
 * The Asia/Manila day after the day this instant falls in.
 *
 * This is the arithmetic behind section 4's backdate floor. The floor is an
 * instant and an effective date is a day, so the earliest date that clears the
 * floor is the day after the floor's own day — always, and without a comparison:
 * the start of the floor's day is never strictly later than the floor, and the
 * start of the next day always is.
 */
export function manilaDayAfter(instant: Date): string {
  const wall = wallClockAt(instant);

  // Plain calendar arithmetic on the rendered day, which needs no zone: adding a
  // day to a date is the same operation everywhere. `Date.UTC` is the vehicle for
  // the month and year rollover, not a statement about the zone.
  const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));

  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1, 2)}-${pad(next.getUTCDate(), 2)}`;
}

/**
 * The first day of the Asia/Manila month **after** the month this instant falls
 * in, as `YYYY-MM-DD`.
 *
 * This is the arithmetic behind section 10's schedule rule: a schedule change
 * takes effect at the start of the following month, so a change decided at any
 * point in August takes effect on 1 September. A month therefore holds exactly
 * one schedule throughout, which is what makes a past month's coverage figure
 * reproducible (section 3).
 *
 * **The zone is not optional and is the whole reason this is not `getMonth()`.**
 * Section 10 records the trap in full: "first day of a month" is a calendar-day
 * test, so a legitimate row starts at Manila 00:00 on the 1st, which is 16:00 UTC
 * on the last day of the *previous* month. UTC and Manila disagree on the calendar
 * date through the first eight hours of any Manila day — 00:00 to 07:59, which is UTC
 * 16:00 to 23:59 of the day before — but they disagree on the **month** only when
 * that day is the **first of a Manila month**. So the window is eight hours a month,
 * not eight hours a day: Manila 15 September 03:00 is UTC 14 September, still
 * September, and a UTC reading answers correctly.
 *
 * Two earlier versions of this sentence were wrong in opposite directions. The first
 * said the *last* eight hours and called that "an ordinary evening" — backwards, since
 * at Manila evening the zones agree. The second fixed the direction and kept "of a
 * Manila day", overstating the window by roughly thirty times.
 *
 * Returns a day rather than an instant, because section 20 makes a date-only
 * value the thing this system reasons about and `startOfManilaDay` is the single
 * conversion to an instant. Composing the two is deliberate: one function decides
 * *which day*, the other decides *what instant a day begins at*, and a helper
 * doing both would have two reasons to be wrong.
 */
export function startOfNextManilaMonth(instant: Date): string {
  const wall = wallClockAt(instant);

  // Plain calendar arithmetic on the rendered month, which needs no zone: the
  // month after August is September everywhere. `Date.UTC` is the vehicle for the
  // year rollover — December gives January of the next year — and not a statement
  // about the zone, exactly as in `manilaDayAfter` above.
  const next = new Date(Date.UTC(wall.year, wall.month, 1));

  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1, 2)}-01`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
