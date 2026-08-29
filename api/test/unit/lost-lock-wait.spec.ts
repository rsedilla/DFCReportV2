import {
  DEADLOCK_DETECTED,
  isLostLockWait,
  LOCK_NOT_AVAILABLE,
} from '../../src/common/errors/postgres-errors';

/**
 * What a lost lock wait is, and why the predicate matches both ways it can be lost.
 *
 * **This file exists because the widening had nothing that could fail on it.** Section
 * 5 has said since the closure pre-flight that "a deadlock ends a wait too, and answers
 * the same way", and `postgres-errors.ts` said in its own docblock that `40P01` would
 * be matched "with the closure endpoint". The endpoint landed, the predicate did not
 * move, and reverting it to `55P03` alone left the whole suite green — which is how a
 * promise a file makes about itself goes unkept twice.
 *
 * A unit file rather than an end-to-end case, deliberately. Provoking a real deadlock
 * through the API means two requests contending in a shape the closure's own ordering
 * is built to prevent, so the case would either be staged against a mutation of the
 * ordering or be flaky. What has to be true is narrow and total: this predicate
 * classifies both codes and nothing else.
 */
describe('a lost lock wait (SKILL.md section 5)', () => {
  it('is a timeout or a deadlock, and nothing else', () => {
    expect(isLostLockWait({ code: LOCK_NOT_AVAILABLE })).toBe(true);
    expect(isLostLockWait({ code: DEADLOCK_DETECTED })).toBe(true);

    // A statement timeout is not contention and nothing says a retry helps, which the
    // predicate's docblock states and this holds it to.
    expect(isLostLockWait({ code: '57014' })).toBe(false);

    // The two codes a closure meets as ordinary domain refusals. Classified as a lost
    // wait they would answer `RESOURCE_BUSY`, which section 22 releases from the
    // idempotency key — so a decision the rules reached would be replayed as transient.
    expect(isLostLockWait({ code: '23514' })).toBe(false);
    expect(isLostLockWait({ code: '23505' })).toBe(false);
  });

  it('says no to anything that is not a PostgreSQL error', () => {
    expect(isLostLockWait(null)).toBe(false);
    expect(isLostLockWait(undefined)).toBe(false);
    expect(isLostLockWait('40P01')).toBe(false);
    expect(isLostLockWait(new Error('deadlock detected'))).toBe(false);
    expect(isLostLockWait({})).toBe(false);
  });

  it('names the two codes it matches', () => {
    // The constants are what `people.import.service.ts` and `cell-lock.ts` cite by
    // name; a rename that left a comment behind is the fault this slice corrected
    // three times.
    expect(LOCK_NOT_AVAILABLE).toBe('55P03');
    expect(DEADLOCK_DETECTED).toBe('40P01');
  });
});
