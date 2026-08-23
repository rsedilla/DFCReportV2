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
 * Narrow on purpose. A deadlock is `40P01` and a statement timeout is `57014`;
 * neither is ordinary contention and neither should be answered as though a retry
 * would help.
 */
export function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE
  );
}
