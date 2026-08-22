import { sql } from 'kysely';

import { ResourceBusyError } from '../common/errors/api-error';
import { isLockTimeout } from '../common/errors/postgres-errors';

import type { Database } from './schema';
import type { Transaction } from 'kysely';

/**
 * How long a request may wait for a person's lock before giving up.
 *
 * `pg_advisory_xact_lock` waits forever, and the connection pool is bounded
 * (SKILL.md section 24) — so an unbounded wait lets one client left idle in a
 * transaction consume every connection and take the liveness probe down with it,
 * which shares the pool. Three seconds is longer than any transaction that takes
 * this lock legitimately, all of which are a handful of statements, and short
 * enough that the queue drains rather than accumulating.
 */
const LOCK_TIMEOUT = '3s';

/**
 * Serializes the writes that decide whether a pastoral edge crosses Networks
 * (SKILL.md sections 4 and 5).
 *
 * **Why anything is needed.** The same-Network triggers are
 * `DEFERRABLE INITIALLY DEFERRED`, so each compares only the state its own
 * transaction can see at commit. A transaction opening an edge under a person,
 * with a `started_at` just before a Network correction's effective instant and
 * committing just after it, is seen by neither: the correction's comparison does
 * not yet see the row, and the new edge's own trigger compares at its
 * `started_at`, where that person's Network was still the old one. The result is
 * a permanent cross-Network edge that nothing revisits — which section 5 says
 * cannot happen, because it makes the rule "a hard server-side invariant on every
 * write".
 *
 * **An advisory lock rather than `SELECT ... FOR UPDATE` on `persons`.** The two
 * paths that must agree live in different modules, and `persons` belongs to
 * `people` (section 2, Modules) — so a row lock would mean `networks` reading a
 * table it does not own, to coordinate rather than to read data. An advisory lock
 * is a coordination primitive belonging to no table, which is exactly what this
 * is. It is transaction-scoped, so it is released at commit or rollback and
 * cannot be leaked by a failing path.
 *
 * **The order is part of the rule, and it is ordered by the key rather than by the
 * person id.** A caller taking more than one takes them in ascending *lock key*,
 * always: two corrections moving people under each other, each locking its own
 * person first, would otherwise deadlock, with PostgreSQL rather than us choosing
 * the victim.
 *
 * Sorting by person id would be very nearly right and wrong in a way worth
 * avoiding. The lock identity is the hash, not the id, so two ids colliding on one
 * key can invert the order between two callers and produce a genuine cycle —
 * negligible at 64 bits, and still a claim the sort would not have earned. Ordering
 * by the key that is actually taken makes the guarantee exact, and collisions
 * collapse into a single lock, which over-serializes and nothing worse.
 *
 * One statement per key rather than one statement locking many: the ordering
 * guarantee comes from issuing them in sequence, and `ORDER BY` does not promise
 * that a set-returning statement acquires locks in the order it sorts.
 */
export async function lockPersonsWithin(
  transaction: Transaction<Database>,
  personIds: readonly string[],
): Promise<void> {
  if (personIds.length === 0) {
    return;
  }

  // `SET LOCAL`, so it reverts when this transaction ends and never leaks onto the
  // pooled connection's next occupant. Interpolated rather than parameterized
  // because `SET` takes no parameters; the value is a constant in this file and
  // never comes from a request.
  //
  // **It is transaction-scoped, not statement-scoped**, so it stays in force for
  // everything the caller does afterwards — the row locks its own writes take, and
  // the key's row lock in `completeWithin`. That is deliberate and is written into
  // section 5: those waits are unbounded otherwise, and an unbounded wait anywhere
  // in a transaction holding a pooled connection is the same liveness hazard. What
  // it requires is that a timeout raised *outside* this loop still answers
  // `RESOURCE_BUSY` rather than an unhandled 500, which `ApiExceptionFilter` does.
  await sql`SET LOCAL lock_timeout = ${sql.raw(`'${LOCK_TIMEOUT}'`)}`.execute(transaction);

  // **`::uuid::text` normalizes the spelling before hashing, and that is not
  // cosmetic.** `hashtextextended` is case-sensitive; a `uuid` column comparison is
  // not, and `@IsUUID()` accepts either case — so the same leader named in
  // uppercase and in lowercase compares equal everywhere in the system except
  // here, and would take two different locks that serialize against nothing.
  // `UUID().uuidString` on iOS is uppercase by default, and section 2 names iOS as
  // a client. The cast also refuses a value that is not a UUID rather than hashing
  // it.
  const keys = await sql<{ key: string }>`
    SELECT DISTINCT hashtextextended(id::uuid::text, 0) AS key
      FROM unnest(${sql.val([...personIds])}::text[]) AS id
     ORDER BY key
  `.execute(transaction);

  for (const { key } of keys.rows) {
    try {
      await sql`SELECT pg_advisory_xact_lock(${key}::bigint)`.execute(transaction);
    } catch (error) {
      if (isLockTimeout(error)) {
        // Transient, and carrying no decision: the caller's transaction rolls back
        // having written nothing, and the client retries. `ResourceBusyError` says
        // there why it is a 5xx.
        throw new ResourceBusyError({ person_ids: [...personIds] });
      }

      throw error;
    }
  }
}
