import { endOfManilaDay } from '../common/time/manila';

/**
 * The instant a DCC event's dated lookups are made at (SKILL.md section 9; decision
 * 0171).
 *
 * Section 9 fixes a person's responsible leader "as of the event date". A date is a
 * day and a pastoral assignment starts at an instant, so the rule has to name one:
 * **the latest instant of the event's Manila day that has already passed** — the
 * earlier of the end of that day and the moment the record is written.
 *
 * Both simpler readings break a path section 9 requires. Resolving at the **start** of
 * the day refuses section 9's own VIP workflow, which creates the Person with their
 * pastoral leader and records their attendance in one sitting at the service: that
 * assignment begins on the Sunday, so at 00:00 the person has no open row and section
 * 9's "a Person with no open assignment row cannot have DCC attendance recorded"
 * refuses the record the workflow was written to produce. Resolving at the **end** of
 * the day unconditionally resolves a record written during the service against an
 * instant that has not happened, which is precisely when leaders record.
 *
 * **A pure function in its own file, because the clamp had no test that could fail on
 * it.** Every event in the end-to-end suite is dated a Sunday strictly before today —
 * which it has to be, so that two cases moving a pastoral assignment the day after the
 * event place that move in the past — and every such event takes the `dayEnd` branch.
 * The `now` branch was unreachable from any case in that file, and reaching it needs an
 * event dated *today*, which is only creatable on a Sunday because `dcc_events` refuses
 * any other day. Lifting the arithmetic out is what lets both branches be exercised on
 * every day of the week (`test/unit/recording-instant.spec.ts`).
 *
 * The caller supplies `now` from the database rather than from the host, which is where
 * that obligation lives: this function is arithmetic, and a function that read a clock
 * would be a second place to get the clock wrong.
 */
export function recordingInstant(eventDate: string, now: Date): Date {
  const dayEnd = endOfManilaDay(eventDate);

  return now.getTime() < dayEnd.getTime() ? now : dayEnd;
}
