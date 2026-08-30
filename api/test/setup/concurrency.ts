/**
 * Waiting for a dispatched request to block on a lock, without racing a wall clock.
 *
 * **The hazard these replace.** Every probe of this shape used to poll `pg_locks`
 * against a fixed budget taken from the moment the request was dispatched — 2.5
 * seconds in `person-lock`, 1.5 in `pastoral-reassignment`. Between dispatch and the
 * lock acquisition the request has to complete an HTTP round trip, verify a token,
 * run the capability guard's `account_roles` and `capability_grants` reads and any
 * subtree walk, validate its DTO and open a transaction. On a loaded machine that
 * work alone can exceed the budget, and then the probe reports no waiter and the
 * assertion fails **while the system is behaving correctly**.
 *
 * That is not hypothetical: one full run failed a single test that eight subsequent
 * runs did not reproduce, on a machine whose suite time varies between 219 and 433
 * seconds.
 *
 * **Why a budget was there at all, and why it is not needed.** The comments justified
 * it by the three-second `lock_timeout` the code under test sets: past that the waiter
 * is gone, so a longer budget would spend the difference failing. That reasoning
 * measures from the wrong origin. `lock_timeout` aborts a statement that waits too
 * long *while attempting to acquire a lock*, so its clock starts when the wait starts
 * rather than when the request was dispatched — slow pre-lock work does not consume
 * any of it.
 *
 * Verified against this project's PostgreSQL rather than read out of the manual: with
 * `lock_timeout` at 1000ms and three seconds of `pg_sleep` inside the transaction
 * before the contended acquisition, the acquisition still waited 1007ms before raising
 * `55P03`.
 *
 * So the right bound is not time at all. It is the attempt itself: poll until the
 * waiter appears, or until the attempt settles. A request that settles while the
 * holder still has the lock never waited on it, which is the genuine failure these
 * probes exist to catch, and it is reported as one.
 */
export interface InFlight {
  /** True once the attempt has resolved or rejected. */
  readonly settled: boolean;
  /** Resolves when the attempt settles, whichever way it went. */
  readonly done: Promise<void>;
}

/**
 * Watch a dispatched attempt without consuming it.
 *
 * The caller keeps its own reference and may still await the original promise for the
 * response. Both outcomes are observed here, which matters: a version that tracked
 * only the resolved path would leave `settled` false for ever on a rejection, and the
 * poll below would then run to its backstop instead of failing usefully.
 */
export function track(attempt: Promise<unknown>): InFlight {
  let settled = false;

  const done = attempt.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  return {
    get settled() {
      return settled;
    },
    done,
  };
}

/**
 * Poll `probe` until it reports a non-zero count, or until `attempt` settles.
 *
 * Returns the count, so a caller asserts `toBeGreaterThan(0)` exactly as before. Zero
 * now means "the attempt finished without ever being seen to wait", which is the thing
 * worth failing on, rather than "the machine was busy".
 *
 * `backstopMs` is not the old budget under another name. It is far above any
 * `lock_timeout` in this codebase and exists only so that an attempt which never
 * settles — a genuine hang — fails with a message that says so, rather than being
 * killed by the suite timeout with nothing to read.
 */
export async function countWhileInFlight(
  probe: () => Promise<number>,
  attempt: InFlight,
  what: string,
  backstopMs = 20_000,
): Promise<number> {
  const backstop = Date.now() + backstopMs;

  for (;;) {
    const found = await probe();

    if (found > 0) {
      return found;
    }

    // Checked after the probe rather than before it, so an attempt that settles
    // between the two is still given the poll it was in the middle of.
    if (attempt.settled) {
      return 0;
    }

    if (Date.now() > backstop) {
      throw new Error(
        `gave up after ${backstopMs}ms waiting for ${what}: the attempt never settled ` +
          'and no waiter appeared, which is a hang rather than contention.',
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
