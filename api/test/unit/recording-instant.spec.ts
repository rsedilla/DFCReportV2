import { recordingInstant } from '../../src/attendance/recording-instant';
import { endOfManilaDay, startOfManilaDay } from '../../src/common/time/manila';

/**
 * The instant a DCC event's dated lookups are made at (SKILL.md section 9; decision
 * 0171).
 *
 * **This file exists because the rule had no test that could fail on it.** The
 * end-to-end suite dates every event a Sunday strictly before today — which it must,
 * so that two cases moving a pastoral assignment the day after the event place that
 * move in the past — and every such event takes the `dayEnd` branch. The `now` branch
 * is the half section 9 argues for at length and was unreachable from any case there,
 * because reaching it needs an event dated *today* and `dcc_events` refuses any day
 * that is not a Sunday.
 *
 * A fixed Sunday is used deliberately, which the end-to-end cases may not: this is
 * arithmetic over two arguments, so nothing here reads a clock and nothing goes stale
 * next year.
 */
describe('the DCC recording instant (section 9)', () => {
  // 2026-03-01 is a Sunday. Asia/Manila is UTC+8 and has no daylight saving, so the
  // day runs from 2026-02-28T16:00Z to 2026-03-01T15:59:59.999Z.
  const sunday = '2026-03-01';

  it('is the end of the event day once the day has ended', () => {
    const monday = new Date('2026-03-02T09:00:00+08:00');

    // The ordinary case: a leader files on Monday for Sunday's service. Section 9's
    // "as of the event date" resolves against the last instant of that date.
    expect(recordingInstant(sunday, monday).getTime()).toBe(endOfManilaDay(sunday).getTime());
  });

  it('is now while the event day is still running', () => {
    // The branch the end-to-end suite cannot reach. A leader recording during the
    // service must not resolve against an instant that has not happened.
    const duringTheService = new Date('2026-03-01T10:30:00+08:00');

    expect(recordingInstant(sunday, duringTheService).getTime()).toBe(duringTheService.getTime());
  });

  it('is the day start at the first instant of the day, not the day end', () => {
    // The clamp is a minimum, so at 00:00 it answers 00:00. This is what makes the
    // instant "always inside the event's own day" rather than always at its end.
    const midnight = startOfManilaDay(sunday);

    expect(recordingInstant(sunday, midnight).getTime()).toBe(midnight.getTime());
  });

  it('never answers past the end of the event day, however late the record is', () => {
    const aYearLater = new Date('2027-03-01T09:00:00+08:00');

    expect(recordingInstant(sunday, aYearLater).getTime()).toBe(endOfManilaDay(sunday).getTime());
  });

  it('stops one millisecond short of the following day', () => {
    // The half-open convention: a pastoral assignment beginning exactly at midnight
    // belongs to the next day, so the instant must not reach it. `endOfManilaDay`
    // states why the step is a millisecond rather than a microsecond.
    const nextDayStart = startOfManilaDay('2026-03-02').getTime();

    expect(recordingInstant(sunday, new Date(nextDayStart)).getTime()).toBe(nextDayStart - 1);
  });

  it('brackets the whole of the event day and nothing outside it', () => {
    const dayStart = startOfManilaDay(sunday).getTime();
    const nextDayStart = startOfManilaDay('2026-03-02').getTime();

    // Whatever the write instant, the answer lands inside the event's own Manila day.
    // That is the property section 9's "as of the event date" means at day
    // granularity, and it is the one thing both branches have to share.
    // Fixed inputs only. An earlier version iterated `Date.now()` here, in a file
    // whose docblock says nothing reads a clock — harmless, since it lands in the
    // `dayEnd` branch and the assertion holds for every input, but it made the one
    // claim the file makes about itself false.
    for (const now of [dayStart, dayStart + 1, nextDayStart - 1, nextDayStart]) {
      const at = recordingInstant(sunday, new Date(now)).getTime();

      expect(at).toBeGreaterThanOrEqual(dayStart);
      expect(at).toBeLessThan(nextDayStart);
    }
  });
});
