import { sql } from 'kysely';

import { canonicalId } from '../common/identifiers';

import type { Database } from './schema';
import type { Transaction } from 'kysely';

/**
 * The lock strength an operation needs on a `cells` row.
 *
 * Two values, and which one an operation names is decided by what it will do to the
 * row rather than by how cautious it feels.
 */
export const CellLock = {
  /**
   * The operation writes the `cells` row itself — today, only a closure, which sets
   * `state`, `closed_at` and the closure reason.
   *
   * `FOR NO KEY UPDATE` rather than `FOR UPDATE`, because that is exactly what the
   * `UPDATE` statement itself takes: none of those columns is a key column. Naming
   * the same strength here means the `UPDATE` acquires nothing new, which is the
   * property the whole ordering rests on — see `lockCellsWithin` on upgrades.
   *
   * It conflicts with the `FOR SHARE` that `assert_cell_memberships_match_state`
   * takes at commit, so a concurrent add into this Cell waits and is then refused
   * against the state this operation committed. It does **not** conflict with the
   * `FOR KEY SHARE` a `cell_memberships` insert takes through its foreign key, so
   * that insert proceeds and is refused at its own commit rather than blocking
   * mid-statement. `FOR UPDATE` would block it there instead; both are correct and
   * the weaker one is the strength the operation actually needs.
   */
  WritesTheRow: 'FOR NO KEY UPDATE',

  /**
   * The operation does not write the `cells` row but depends on its `state` staying
   * put — a closure's dispersal destinations, which must not close underneath it.
   *
   * `FOR SHARE` is the same strength the deferred membership trigger takes at
   * commit, so again nothing is acquired later that is not acquired here. It does
   * not conflict with itself, which is deliberate: two closures dispersing into one
   * Cell, and an ordinary add into that Cell, have no reason to wait for each other.
   */
  ReadsTheState: 'FOR SHARE',
} as const;

export type CellLockStrength = (typeof CellLock)[keyof typeof CellLock];

export interface CellLockRequest {
  readonly cellId: string;
  readonly strength: CellLockStrength;
}

/**
 * Take every `cells` row an operation will touch, up front, in one order, each at
 * the strength that operation will need for it (SKILL.md section 5).
 *
 * **This is the half of the Cell ordering that was written three times in prose and
 * refuted three times.** What settled it was running the database:
 * `api/test/database/closure-locking.spec.ts` stages the writes and asserts what
 * happens, and each clause below is pinned by a case there that fails without it.
 * The measurement is the authority; this comment only says what it found.
 *
 * **Sorted acquisition, and by itself that is not the rule.** Two closures
 * dispersing into each other's Cells take the two rows in opposite orders and
 * deadlock — migration 0009 predicted it at the `FOR SHARE` it added, and the
 * harness reproduces it. A total order over the rows removes the cycle, because a
 * transaction then only ever waits on a key above every key it holds.
 *
 * **At the strength the operation will need, which is the clause prose kept
 * missing.** Both parties taking every row *shared* and then upgrading their own to
 * exclusive deadlock anyway: sorted acquisition buys nothing when the upgrade is not
 * itself sorted. So each row is taken **once**, at the final strength — hence the
 * fold below, which keeps the strongest request per row rather than issuing two
 * statements for a Cell named twice. That fold is not tidiness; it is the difference
 * between the rule and the version of it that deadlocks.
 *
 * **Ordered by the canonical identifier, not by the spelling it arrived in.** A
 * `uuid` comparison is case-insensitive, so two callers naming one Cell in different
 * cases lock the same row and would sort it to different positions — two operations
 * acquiring in opposite orders, which is a genuine cycle rather than the harmless
 * over-serialization a merely redundant lock would be. Section 5 records the same
 * defect found in the person lock's key, and section 7 records it found in an
 * authorization comparison; this is the third place it would have been reachable.
 *
 * **After the advisory locks, never before them.** A membership write already takes
 * an advisory lock on the person and then, at commit, a row lock on the Cell — so
 * the order between the two classes is fixed by an existing writer rather than free
 * to choose. Taking the Cell rows first and reaching back for people cycles against
 * that writer, and the harness reproduces that too. A caller therefore calls
 * `lockPersonsWithin` before this, and an operation that locks no people calls
 * `boundLockWaitsWithin` itself, because nothing else sets the bound.
 *
 * One statement per row rather than one statement locking many, for the reason
 * `lockPersonsWithin` gives: the ordering guarantee comes from issuing them in
 * sequence, and `ORDER BY` does not promise that a set-returning statement acquires
 * its locks in the order it sorts.
 *
 * The wait is bounded by the caller's `lock_timeout`, and an elapsed one answers
 * `RESOURCE_BUSY` wherever it is raised (section 5). So does a deadlock this ordering
 * has not reached — `isLockTimeout` matches `40P01` as well as `55P03`, which it did
 * not until this endpoint landed and which is the half of section 5 that had been
 * stated and not built. Ordering reaches the locks an operation takes itself; it does
 * not reach the row locks a deferred constraint trigger takes at COMMIT in write
 * order, so a cycle stays possible however carefully this sorts.
 */
export async function lockCellsWithin(
  transaction: Transaction<Database>,
  requests: readonly CellLockRequest[],
): Promise<void> {
  const strongest = new Map<string, CellLockStrength>();

  for (const { cellId, strength } of requests) {
    const key = canonicalId(cellId);
    const held = strongest.get(key);

    if (held === undefined || (held === CellLock.ReadsTheState && strength !== held)) {
      strongest.set(key, strength);
    }
  }

  const ordered = [...strongest.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  for (const [cellId, strength] of ordered) {
    // The strength is interpolated because `SELECT ... FOR <strength>` takes no
    // parameter there. It comes from `CellLock` and never from a request — the
    // signature admits nothing else, which is what makes the interpolation safe
    // rather than a rule somebody has to remember at each call site.
    await sql`
      SELECT id FROM cells WHERE id = ${cellId}::uuid ${sql.raw(strength)}
    `.execute(transaction);
  }
}
