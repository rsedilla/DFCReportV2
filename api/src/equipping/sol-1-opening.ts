import { sql, type Transaction } from 'kysely';

import { ResourceBusyError } from '../common/errors/api-error';
import { isLostLockWait } from '../common/errors/postgres-errors';
import { boundLockWaitsWithin } from '../database/person-lock';

import type { Database } from '../database/schema';

/**
 * **SOL 1 becomes the school's the moment a Coordinator opens its first class** (owner,
 * 2026-11-26, "When a class opens"; decision 0514, point 13), and from then no leader ticks it.
 * A leader's Training save reads whether a SOL 1 class exists, and at `READ COMMITTED` a class
 * opened between that read and the save's commit would let a leader's tick land after the class
 * opened. So the two take one advisory lock, transaction-scoped: opening a SOL 1 class takes it
 * exclusively, a Training save naming SOL 1 takes it shared and first, before it reads. Either
 * the save finishes while SOL 1 was not yet the school's, or it waits and sees the class.
 *
 * The wait is bounded as the person locks bound theirs (`database/person-lock.ts`), for the same
 * reason: an unbounded advisory wait can tie up the bounded pool (section 24). A wait that runs
 * out answers `RESOURCE_BUSY`, and the client retries.
 */
const SOL_1_OPENING = 'equipping:sol-1-opening';

async function takeWithin(trx: Transaction<Database>, shared: boolean): Promise<void> {
  await boundLockWaitsWithin(trx);
  try {
    await (
      shared
        ? sql`SELECT pg_advisory_xact_lock_shared(hashtext(${SOL_1_OPENING}))`
        : sql`SELECT pg_advisory_xact_lock(hashtext(${SOL_1_OPENING}))`
    ).execute(trx);
  } catch (error) {
    if (isLostLockWait(error)) {
      throw new ResourceBusyError({ lock: 'sol_1_opening' });
    }
    throw error;
  }
}

/** Taken by opening a SOL 1 class, before it is written. */
export async function lockSol1OpeningWithin(trx: Transaction<Database>): Promise<void> {
  await takeWithin(trx, false);
}

/** Taken by a Training save that names SOL 1, before it reads whether a SOL 1 class is open. */
export async function shareSol1OpeningWithin(trx: Transaction<Database>): Promise<void> {
  await takeWithin(trx, true);
}
