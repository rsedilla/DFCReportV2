/**
 * The PostgreSQL error conditions this application recognises by code.
 *
 * Here rather than beside the code that provokes each one, because the place that
 * has to *classify* a database error is the exception filter, and `common` must
 * not reach into a module to ask. `database/person-lock.ts` is what sets the
 * timeout; this is what a failure anywhere is measured against, and both point the
 * same way.
 */

/** `lock_not_available`: a lock wait elapsed (SKILL.md section 5). */
export const LOCK_NOT_AVAILABLE = '55P03';

/** `deadlock_detected`: the database chose this transaction as the victim (section 5). */
export const DEADLOCK_DETECTED = '40P01';

/**
 * Whether a thrown value is PostgreSQL reporting a wait this transaction lost.
 *
 * **Both ways a wait can end**, which section 5 states in as many words: "a deadlock
 * ends a wait too, and answers the same way… the two differ in cause and not in what
 * the caller should do: nothing was recorded, the retry is very likely to succeed,
 * and a 503 releases the idempotency key while a 500 would report a defect the caller
 * cannot act on."
 *
 * **`40P01` was left out until the closure endpoint landed, and this docblock said
 * so** — "that lands with the closure endpoint, which is the first operation that can
 * produce `40P01` in ordinary practice". The closure endpoint landed and the
 * predicate was not widened with it, which is a promise a file made about itself and
 * did not keep. It is widened here.
 *
 * The closure's own ordering is what makes a deadlock unlikely rather than
 * impossible: ordering reaches the locks an operation takes itself and not the row
 * locks a deferred constraint trigger takes at COMMIT in write order, so `40P01`
 * stays reachable however carefully an operation sorts. A victim is still worth
 * surfacing in a log, which is where section 5 puts the distinction rather than in
 * the response.
 *
 * A statement timeout is `57014` and stays out: it is not contention, and nothing
 * says a retry helps.
 */
export function isLockTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return code === LOCK_NOT_AVAILABLE || code === DEADLOCK_DETECTED;
}
