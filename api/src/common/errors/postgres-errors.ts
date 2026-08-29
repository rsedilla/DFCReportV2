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

/**
 * Whether a thrown value is PostgreSQL reporting an elapsed lock wait.
 *
 * Narrow on purpose today, and **section 5 has since overruled half of it**: a
 * deadlock victim answers `RESOURCE_BUSY` like an elapsed wait, because the two
 * differ in cause rather than in what the caller should do. This predicate has not
 * been widened yet — that lands with the closure endpoint, which is the first
 * operation that can produce `40P01` in ordinary practice. Until then `40P01`
 * renders `INTERNAL_ERROR`, which is a known gap rather than the rule.
 *
 * A statement timeout is `57014` and stays out: it is not contention, and nothing
 * says a retry helps.
 */
export function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE
  );
}
