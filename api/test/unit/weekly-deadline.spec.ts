import {
  monthClosesAt,
  recordClosesAt,
  recordDueAt,
  weekStartOf,
  weeklyDeadlineFrom,
  windowClosesAt,
} from '../../src/common/time/submission-window';

/**
 * The weekly deadline's arithmetic (SKILL.md section 13, decision 0335), on the fixed dates
 * the ruling names: from the week of Monday 26 October 2026 a week is due at 12 noon the
 * Monday after it and closes two Mondays later; a week before keeps the end of the 7th.
 * Manila is UTC+8, so 12:00 Manila is 04:00Z.
 */
describe('The weekly deadline (decision 0335)', () => {
  const previous = process.env.WEEKLY_DEADLINE_FROM;

  beforeEach(() => {
    delete process.env.WEEKLY_DEADLINE_FROM;
  });

  afterAll(() => {
    if (previous !== undefined) {
      process.env.WEEKLY_DEADLINE_FROM = previous;
    }
  });

  it('starts with the week of Monday 26 October 2026', () => {
    expect(weeklyDeadlineFrom()).toBe('2026-10-26');
  });

  it('runs a week Monday to Sunday', () => {
    expect(weekStartOf('2026-10-26')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-01')).toBe('2026-10-26');
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02');
  });

  it('makes the first week due at noon on Monday 2 November and closes it on 16 November', () => {
    for (const day of ['2026-10-26', '2026-10-30', '2026-11-01']) {
      expect(recordDueAt(day)?.toISOString()).toBe('2026-11-02T04:00:00.000Z');
      expect(recordClosesAt(day).toISOString()).toBe('2026-11-16T04:00:00.000Z');
    }
  });

  it('keeps the end of the 7th for a day before the weekly rule, with no deadline', () => {
    expect(recordDueAt('2026-10-25')).toBeNull();
    expect(recordClosesAt('2026-10-25')).toEqual(windowClosesAt('2026-10-01'));
    expect(recordClosesAt('2026-10-25').toISOString()).toBe('2026-11-07T16:00:00.000Z');
  });

  it('closes a month when its last week closes, between the 15th and the 21st', () => {
    expect(monthClosesAt('2026-10-01').toISOString()).toBe('2026-11-16T04:00:00.000Z');
    expect(monthClosesAt('2026-11-01').toISOString()).toBe('2026-12-21T04:00:00.000Z');
    expect(monthClosesAt('2027-02-01').toISOString()).toBe('2027-03-15T04:00:00.000Z');
    // A month before the rule keeps the 7th.
    expect(monthClosesAt('2026-09-01')).toEqual(windowClosesAt('2026-09-01'));
  });

  it('moves its start only in a test process, and only to a Monday', () => {
    process.env.WEEKLY_DEADLINE_FROM = '2026-08-03';
    expect(weeklyDeadlineFrom()).toBe('2026-08-03');

    process.env.WEEKLY_DEADLINE_FROM = '2026-08-04';
    expect(() => weeklyDeadlineFrom()).toThrow(/not a Monday/);

    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WEEKLY_DEADLINE_FROM = '2026-08-03';
    try {
      expect(weeklyDeadlineFrom()).toBe('2026-10-26');
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
