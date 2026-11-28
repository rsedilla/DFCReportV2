import { sql, type Transaction } from 'kysely';

import { ResourceBusyError } from '../common/errors/api-error';
import { isLostLockWait } from '../common/errors/postgres-errors';
import { boundLockWaitsWithin } from '../database/person-lock';

import type { Database } from '../database/schema';

/**
 * **A SOL level becomes the school's the moment a Coordinator opens its first class** (owner,
 * 2026-11-26, "When a class opens"; decision 0514, point 13, and decision 0516, point 1 for SOL
 * 2), and from then no leader ticks it. A leader's Training save reads whether a class of the
 * level exists, and at `READ COMMITTED` a class opened between that read and the save's commit
 * would let a leader's tick land after the class opened. So the two take one advisory lock,
 * transaction-scoped and shared by every SOL level: opening a SOL class takes it exclusively, a
 * Training save naming a SOL level takes it shared and first, before it reads. Either the save
 * finishes while the level was not yet the school's, or it waits and sees the class. One lock for
 * all levels serialises a save against an opening at another level too, which costs a wait in a
 * rare collision and buys one place to reason about.
 *
 * The wait is bounded as the person locks bound theirs (`database/person-lock.ts`), for the same
 * reason: an unbounded advisory wait can tie up the bounded pool (section 24). A wait that runs
 * out answers `RESOURCE_BUSY`, and the client retries.
 */
const SOL_OPENING = 'equipping:sol-opening';

async function takeWithin(trx: Transaction<Database>, shared: boolean): Promise<void> {
  await boundLockWaitsWithin(trx);
  try {
    await (
      shared
        ? sql`SELECT pg_advisory_xact_lock_shared(hashtext(${SOL_OPENING}))`
        : sql`SELECT pg_advisory_xact_lock(hashtext(${SOL_OPENING}))`
    ).execute(trx);
  } catch (error) {
    if (isLostLockWait(error)) {
      throw new ResourceBusyError({ lock: 'sol_opening' });
    }
    throw error;
  }
}

/** Taken by opening a SOL class, before it is written. */
export async function lockSolOpeningWithin(trx: Transaction<Database>): Promise<void> {
  await takeWithin(trx, false);
}

/** Taken by a Training save that names a SOL level, before it reads whether one is open. */
export async function shareSolOpeningWithin(trx: Transaction<Database>): Promise<void> {
  await takeWithin(trx, true);
}
