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

/** `unique_violation`: a unique index refused a row (section 22, *Write conflicts*). */
export const UNIQUE_VIOLATION = '23505';

/** `foreign_key_violation`: a row named something that does not exist (section 22). */
export const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Whether a thrown value is PostgreSQL refusing a row on a unique index.
 *
 * **It is a conflict rather than a defect, and only on the indexes that make it
 * one.** Section 22 names two records that do not exist until they are reported —
 * a Cell meeting and a person's DCC attendance — and says of the race between two
 * first submissions that "a uniqueness violation left to surface on its own is an
 * `INTERNAL_ERROR` on an ordinary race". So the caller that provoked it turns it
 * into the `VERSION_CONFLICT` that section states, and every other unique index in
 * this schema keeps failing loudly.
 *
 * The classification is deliberately not made here. This answers what PostgreSQL
 * said; which index it was, and whether that index has a conflict to report, is a
 * question only the operation knows.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/**
 * The name of the constraint a violation names, or null.
 *
 * **Which index it was decides what the failure means**, and a caller that only asks
 * "was it a unique violation" answers for indexes it knows nothing about. The DCC
 * submission turns a violation of `dcc_attendance_one_live` into section 22's
 * `VERSION_CONFLICT`; a violation of anything else on that path is a defect and must
 * keep failing loudly. Without the name those two are one branch, and the wrong half
 * wins.
 *
 * PostgreSQL puts it on the error as `constraint`, which node-pg passes through
 * verbatim.
 */
export function violatedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) {
    return null;
  }

  const name = (error as { constraint?: unknown }).constraint;

  return typeof name === 'string' ? name : null;
}

/**
 * Whether a thrown value is PostgreSQL reporting a wait this transaction lost.
 *
 * **Named for what it matches, and it was `isLockTimeout` until it stopped matching
 * only a timeout.** This repository renamed `cells_relationships_match_state` one
 * slice ago on exactly that ground: a name that says less than the thing does is how
 * the next reader concludes the other half is unhandled.
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
export function isLostLockWait(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return code === LOCK_NOT_AVAILABLE || code === DEADLOCK_DETECTED;
}

/**
 * Whether a thrown value is PostgreSQL refusing a row because it names a row that is
 * not there.
 *
 * **A client-supplied identifier reaching a foreign key is a refusal owed to the client,
 * not a defect.** Section 22 names a raw 500 on a well-formed request as the failure
 * mode, and this is one of the two ways a well-formed body reaches the database and is
 * rejected by it -- the other being text a `text` column cannot keep, which is refused
 * a layer earlier because no lookup is needed to know it.
 *
 * The classification is deliberately not made here, exactly as it is not for a unique
 * violation: this answers what PostgreSQL said, and which constraint it was -- and
 * therefore which field a caller must fix -- is a question only the operation knows.
 * Narrow on `violatedConstraint` by name, so a key nobody has considered keeps failing
 * loudly rather than being reported as somebody's typo.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION;
}
