import { sql } from 'kysely';

import type { Database } from './schema';
import type { Transaction } from 'kysely';

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
 * **The order is part of the rule.** A caller taking more than one of these takes
 * them in ascending person id, always. Two corrections moving people under each
 * other, each locking its own person first, would otherwise deadlock — and the
 * victim is chosen by PostgreSQL rather than by us. `lockPersonsWithin` sorts, so
 * a caller cannot get this wrong by listing its arguments in the order that reads
 * best.
 *
 * One statement per key rather than one statement locking many. `FOR UPDATE` with
 * `ORDER BY` does not guarantee that rows are locked in the sorted order, and the
 * same caution applies to batching advisory locks: the ordering guarantee here
 * comes from issuing them in sequence.
 */
export async function lockPersonsWithin(
  transaction: Transaction<Database>,
  personIds: readonly string[],
): Promise<void> {
  const ordered = [...new Set(personIds)].sort();

  for (const personId of ordered) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${personId}, 0))`.execute(transaction);
  }
}
