import {
  manilaDayAfter,
  manilaDayOf,
  startOfManilaDay,
  startOfNextManilaMonth,
} from '../../src/common/time/manila';

/**
 * Asia/Manila dates and instants (SKILL.md section 20).
 *
 * These are pure functions and need no database, which matters: the arithmetic
 * they carry is what section 4's backdate floor answers with, and a defect here
 * hands an administrator a date that will be refused again.
 *
 * The two boundary cases are asserted directly, and the rest are asserted as
 * **properties over many instants** rather than as the handful of cases anyone
 * happens to think of. Section 4's rule is a property — "strictly later than" —
 * and the failure this project keeps making is testing the examples instead.
 */
describe('Asia/Manila dates and instants (section 20)', () => {
  describe('startOfManilaDay', () => {
    it('resolves a day to the instant it begins in Manila, not in UTC', () => {
      // +08:00, so a Manila day begins at 16:00 UTC on the previous day. Asserted
      // as a literal instant rather than computed with the same offset the code
      // uses, which would agree with itself whatever it did.
      expect(startOfManilaDay('2026-08-23').toISOString()).toBe('2026-08-22T16:00:00.000Z');
      expect(startOfManilaDay('2026-01-01').toISOString()).toBe('2025-12-31T16:00:00.000Z');
      expect(startOfManilaDay('2024-02-29').toISOString()).toBe('2024-02-28T16:00:00.000Z');
    });

    it('refuses anything that is not a plain YYYY-MM-DD day', () => {
      expect(() => startOfManilaDay('2026-08-23T00:00:00Z')).toThrow(/YYYY-MM-DD/);
      expect(() => startOfManilaDay('23-08-2026')).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('manilaDayOf', () => {
    it('places an instant on the Manila day, not the UTC day', () => {
      // The boundary, from both sides. A record written at 07:00 Monday in Manila
      // is 23:00 Sunday UTC, and section 20 names that as the case a UTC-bucketed
      // report gets wrong.
      expect(manilaDayOf(new Date('2026-08-22T15:59:59.999Z'))).toBe('2026-08-22');
      expect(manilaDayOf(new Date('2026-08-22T16:00:00.000Z'))).toBe('2026-08-23');
    });

    it('pads a single-digit month and day', () => {
      expect(manilaDayOf(new Date('2026-01-04T05:00:00.000Z'))).toBe('2026-01-04');
    });
  });

  describe('manilaDayAfter', () => {
    it('rolls over a month, a year and a leap day', () => {
      expect(manilaDayAfter(new Date('2026-01-31T12:00:00+08:00'))).toBe('2026-02-01');
      expect(manilaDayAfter(new Date('2026-12-31T23:59:59+08:00'))).toBe('2027-01-01');
      expect(manilaDayAfter(new Date('2024-02-28T12:00:00+08:00'))).toBe('2024-02-29');
      expect(manilaDayAfter(new Date('2025-02-28T12:00:00+08:00'))).toBe('2025-03-01');
    });
  });

  /**
   * The property section 4's refusal rests on, stated once and checked against a
   * spread of instants rather than a few chosen ones.
   *
   * The refusal names `manilaDayAfter(floor)` as the earliest date a backdated
   * correction may take. That is only true if the day it names always clears the
   * floor, and if the floor's own day never does — otherwise the administrator is
   * handed a date that will be refused again, or is refused one that would have
   * been accepted.
   */
  describe('startOfNextManilaMonth (section 10, Schedule changes)', () => {
    it('takes a change made mid-month to the first of the next month', () => {
      // Section 10: "A Cell moving from Saturday to Sunday, decided in August, runs
      // on Sunday from 1 September."
      expect(startOfNextManilaMonth(new Date('2026-08-12T04:00:00Z'))).toBe('2026-09-01');
    });

    it('rolls the year over from December', () => {
      expect(startOfNextManilaMonth(new Date('2026-12-20T04:00:00Z'))).toBe('2027-01-01');
    });

    it('reads the month in Manila, not in UTC', () => {
      // **The case the whole helper exists for.** 2026-08-31T16:30:00Z is already
      // 1 September in Manila (UTC+8), so the next month is October. A UTC reading
      // sees 31 August and answers September -- a month early, silently, and only
      // through the **first** eight hours of a Manila day: 00:00 to 07:59, which is
      // UTC 16:00 to 23:59 of the day before. This case is Manila 00:30. At Manila
      // evening the two zones agree on the date and a UTC reading is correct, so the
      // risk is early morning rather than the busiest hours -- an earlier version of
      // this comment had it exactly backwards.
      expect(startOfNextManilaMonth(new Date('2026-08-31T16:30:00Z'))).toBe('2026-10-01');
    });

    it('is unaffected on the same date eight hours earlier', () => {
      // The same calendar date, still 31 August in Manila. Paired with the case
      // above so the two differ only by the zone reading.
      expect(startOfNextManilaMonth(new Date('2026-08-31T08:30:00Z'))).toBe('2026-09-01');
    });

    it('composes with startOfManilaDay to give the instant a schedule row starts at', () => {
      // Section 10 requires the row to start at Manila 00:00 on the 1st, "stored as
      // 16:00 UTC on the last day of the previous month" -- which is what the
      // trigger in migration 0009 checks against.
      const day = startOfNextManilaMonth(new Date('2026-08-12T04:00:00Z'));
      expect(startOfManilaDay(day).toISOString()).toBe('2026-08-31T16:00:00.000Z');
    });
  });

  describe('the earliest date that clears a floor (section 4)', () => {
    const floors = [
      // Midnight in Manila exactly, which is the case that separates "strictly
      // later" from "at or after" and is the one a naive implementation passes by
      // accident in the other direction.
      new Date('2026-08-23T00:00:00.000+08:00'),
      new Date('2026-08-23T00:00:00.001+08:00'),
      new Date('2026-08-23T23:59:59.999+08:00'),
      new Date('2026-02-28T13:45:12.500+08:00'),
      new Date('2024-02-29T08:00:00.000+08:00'),
      new Date('2026-12-31T23:00:00.000+08:00'),
      new Date('2026-01-01T00:00:00.000+08:00'),
      // A UTC instant on the far side of the Manila boundary, so the day it is
      // "in" differs between the two zones.
      new Date('2026-08-22T16:00:00.000Z'),
      new Date('2026-08-22T15:59:59.999Z'),
    ];

    it.each(floors.map((floor) => [floor.toISOString(), floor] as const))(
      'names a day that is strictly later than %s, and the day before it is not',
      (_label, floor) => {
        const earliest = startOfManilaDay(manilaDayAfter(floor));
        expect(earliest.getTime()).toBeGreaterThan(floor.getTime());

        // And it is the *earliest* such day: the floor's own day never clears it.
        // Without this the pair passes trivially by naming a date far in the
        // future.
        const floorsOwnDay = startOfManilaDay(manilaDayOf(floor));
        expect(floorsOwnDay.getTime()).toBeLessThanOrEqual(floor.getTime());
      },
    );

    it('holds across a year of instants, at every hour of the day', () => {
      // A spread rather than a handful. Every third day of 2026 at four times of
      // day, which crosses every month boundary and both sides of the Manila
      // day boundary in UTC terms.
      const start = Date.UTC(2026, 0, 1);
      const day = 24 * 60 * 60 * 1000;

      for (let index = 0; index < 365; index += 3) {
        for (const hours of [0, 7, 15, 23]) {
          const floor = new Date(start + index * day + hours * 60 * 60 * 1000 + 37 * 60 * 1000);

          expect(startOfManilaDay(manilaDayAfter(floor)).getTime()).toBeGreaterThan(
            floor.getTime(),
          );
          expect(startOfManilaDay(manilaDayOf(floor)).getTime()).toBeLessThanOrEqual(
            floor.getTime(),
          );
        }
      }
    });
  });

  it('round-trips a day through its own start instant', () => {
    for (const day of ['2026-01-01', '2026-02-28', '2024-02-29', '2026-08-23', '2026-12-31']) {
      expect(manilaDayOf(startOfManilaDay(day))).toBe(day);
    }
  });
});
