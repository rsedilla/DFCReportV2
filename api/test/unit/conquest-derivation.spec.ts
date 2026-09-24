import {
  countedAt,
  earliestReached,
  overlap,
  period,
  type Period,
} from '../../src/conquest/conquest-derivation';

/**
 * The arithmetic behind Conquest's derived dates (SKILL.md section 27; decisions 0284
 * and 0285), which needs no database.
 *
 * Every period here is half-open, `[start, end)`, as every effective-dated table is
 * (section 5): a period ending at `t` is not in force at `t`, and a period starting at
 * `t` is. That boundary is what decides whether a reassignment at `t` briefly counts a
 * disciple under both leaders, so it is asserted at the instant itself rather than near it.
 */
describe('Conquest derivation (section 27)', () => {
  const at = (minute: number): number => minute;
  const p = (start: number, end: number = Number.POSITIVE_INFINITY): Period => ({ start, end });
  const of = (entries: Record<string, Period[]>) => new Map(Object.entries(entries));

  describe('period', () => {
    it('reads a null end as still in force', () => {
      const open = period(new Date('2026-01-01T00:00:00Z'), null);

      expect(open.start).toBe(Date.parse('2026-01-01T00:00:00Z'));
      expect(open.end).toBe(Number.POSITIVE_INFINITY);
    });

    it('keeps a closed end as its instant', () => {
      const closed = period(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));

      expect(closed.end).toBe(Date.parse('2026-02-01T00:00:00Z'));
    });
  });

  describe('overlap', () => {
    it('is the shared part of two periods', () => {
      expect(overlap(p(0, 10), p(5, 20))).toEqual({ start: 5, end: 10 });
      expect(overlap(p(5), p(0, 10))).toEqual({ start: 5, end: 10 });
      expect(overlap(p(0), p(3))).toEqual({ start: 3, end: Number.POSITIVE_INFINITY });
    });

    it('is nothing where one ends at the instant the other starts', () => {
      expect(overlap(p(0, 10), p(10, 20))).toBeNull();
      expect(overlap(p(10, 20), p(0, 10))).toBeNull();
    });

    it('is nothing where two periods are apart', () => {
      expect(overlap(p(0, 5), p(6, 9))).toBeNull();
    });

    it('is nothing against a zero-length period', () => {
      expect(overlap(p(0, 10), p(4, 4))).toBeNull();
    });
  });

  describe('earliestReached', () => {
    it('is the instant the target-th disciple is first counted', () => {
      const periods = of({ a: [p(at(1))], b: [p(at(3))], c: [p(at(2))] });

      expect(earliestReached(periods, 3)).toBe(at(3));
      expect(earliestReached(periods, 2)).toBe(at(2));
      expect(earliestReached(periods, 1)).toBe(at(1));
    });

    it('is null where the target is never held at one instant', () => {
      // Three disciples, never more than two at once.
      const periods = of({ a: [p(0, 5)], b: [p(4, 8)], c: [p(7)] });

      expect(earliestReached(periods, 3)).toBeNull();
    });

    it('does not count a period ending at t together with one starting at t', () => {
      // `a` leaves at 5 as `c` arrives at 5: two at every instant, never three.
      const periods = of({ a: [p(0, 5)], b: [p(0)], c: [p(5)] });

      expect(earliestReached(periods, 3)).toBeNull();
      expect(earliestReached(periods, 2)).toBe(0);
    });

    it('counts a disciple with two edges once, overlapping or contiguous', () => {
      // `a` holds two overlapping periods and `b` two contiguous ones. Counted per
      // period, three would be reached at 2; counted per disciple, it never is.
      const periods = of({ a: [p(0, 10), p(2)], b: [p(1, 4), p(4)] });

      expect(earliestReached(periods, 3)).toBeNull();
      expect(earliestReached(periods, 2)).toBe(1);
    });

    it('keeps a disciple counted across a contiguous handover of their own periods', () => {
      // `a` is counted from 0 onward without a gap, so the pair is reached at 3.
      const periods = of({ a: [p(0, 3), p(3)], b: [p(3)] });

      expect(earliestReached(periods, 2)).toBe(3);
    });

    it('does not bridge a gap in one disciple’s periods', () => {
      // `a` is away between 3 and 6; `b` is there only between 4 and 5.
      const periods = of({ a: [p(0, 3), p(6)], b: [p(4, 5)] });

      expect(earliestReached(periods, 2)).toBeNull();
    });

    it('stays reached at the first instant after the count falls again', () => {
      // Three at 2, two from 4 on: the milestone is dated at 2.
      const periods = of({ a: [p(0)], b: [p(1)], c: [p(2, 4)] });

      expect(earliestReached(periods, 3)).toBe(2);
    });

    it('takes the earliest of two separate times the target is held', () => {
      const periods = of({ a: [p(0, 3), p(8)], b: [p(1, 3), p(9)] });

      expect(earliestReached(periods, 2)).toBe(1);
    });

    it('ignores the order periods are given in', () => {
      const periods = of({ a: [p(6), p(0, 3)], b: [p(7, 9), p(1, 2)] });

      expect(earliestReached(periods, 2)).toBe(1);
    });

    it('never counts a zero-length period', () => {
      const periods = of({ a: [p(0)], b: [p(5, 5)] });

      expect(earliestReached(periods, 2)).toBeNull();
    });

    it('is null for nobody', () => {
      expect(earliestReached(new Map(), 1)).toBeNull();
    });
  });

  describe('countedAt', () => {
    const periods = of({ a: [p(0, 5)], b: [p(5)], c: [p(2, 3), p(7)] });

    it('counts a period starting at t and not one ending at t', () => {
      expect(countedAt(periods, 5)).toBe(1);
      expect(countedAt(periods, 4)).toBe(1);
    });

    it('counts each disciple once, whatever periods they hold', () => {
      const doubled = of({ a: [p(0, 10), p(2)], b: [p(0)] });

      expect(countedAt(doubled, 3)).toBe(2);
    });

    it('counts across a gap only where a period is in force', () => {
      expect(countedAt(periods, 2)).toBe(2);
      expect(countedAt(periods, 3)).toBe(1);
      expect(countedAt(periods, 6)).toBe(1);
      expect(countedAt(periods, 7)).toBe(2);
    });
  });
});
