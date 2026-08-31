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

/**
 * The advisory lock key, and the probes that observe it.
 *
 * **Why these are here rather than in each case.** `lockPersonsWithin` computes a
 * person's key as `hashtextextended(id::uuid::text, 0)`, and seven test files were
 * spelling that expression out again — twenty-four times, four of them the identical
 * waiter query. `person-lock.e2e.spec.ts` justified the arrangement by saying the key
 * "is recomputed in SQL from the person id rather than passed in, so the probe agrees
 * with the implementation by construction", which was true of any one copy and is
 * exactly what twenty-four copies cannot promise.
 *
 * **A drifted copy does not fail.** It computes a different key, finds nothing waiting
 * on it, and the case passes — because every one of these probes asserts that a waiter
 * *appears*, so a probe looking in the wrong place reports the same zero as a system
 * that never blocked. The failure mode of the duplication is a green suite, which is
 * why it is worth removing before Stage 4 adds an eighth file.
 *
 * The construction guarantee is not lost, it moves: the key is still computed in SQL by
 * the database rather than in JavaScript, once, by `personLockKey` below, and
 * `person-lock.e2e.spec.ts` pins that one computation against the key the implementation
 * is observed to take.
 */

/** Anything that can run a parameterized statement: `pg.Client` satisfies it. */
interface Queryable {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * The key `lockPersonsWithin` takes for one person, computed by the database.
 *
 * `::uuid::text` normalizes the spelling before hashing, exactly as the implementation
 * does and for the reason it gives: `hashtextextended` is case-sensitive while a `uuid`
 * comparison is not, so an identifier in upper case would hash to a different key and
 * serialize against nothing. A probe that skipped the cast would look for a lock nobody
 * takes.
 */
export async function personLockKey(client: Queryable, personId: string): Promise<string> {
  const { rows } = await client.query<{ key: string }>(
    'SELECT hashtextextended($1::uuid::text, 0) AS key',
    [personId],
  );

  return rows[0].key;
}

/**
 * Take that lock inside the caller's open transaction, and return the key it took.
 *
 * The caller has already issued `BEGIN`; this is `pg_advisory_xact_lock`, so the lock
 * is released by their `COMMIT` or `ROLLBACK` and cannot be leaked by a failing path.
 */
export async function holdPersonLock(client: Queryable, personId: string): Promise<string> {
  const key = await personLockKey(client, personId);
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);

  return key;
}

/**
 * How many backends are **waiting** on an advisory key, in this database.
 *
 * **The database predicate is not decoration.** An advisory lock belongs to one
 * database, and `pg_locks` reports every database in the cluster — so without it a lock
 * held on the same key in `dfc_dev`, by a development server or by a second test run,
 * counts as a waiter here. That direction is the dangerous one: these probes assert a
 * waiter *appears*, so a false positive passes a case that should have failed. Six of
 * the seven files omitted it; `cell-membership.e2e.spec.ts` had it and said why.
 *
 * **Verified rather than assumed, and not pinned by a case.** Against this project's
 * PostgreSQL, an advisory lock's `pg_locks` row reports `datname` and `objsubid = 1`, so
 * both predicates select something. Nothing here can *fail* on the database filter,
 * because reaching it needs a second database holding the same key and CI runs one —
 * so this is a reasoned narrowing backed by a measured premise, not a regression test,
 * and it is written down that way rather than left to look like the latter.
 *
 * `objsubid = 1` selects the 8-byte key form, which is the one `pg_advisory_xact_lock`
 * takes here; the two-integer form reports 2.
 *
 * The key is split across `classid` and `objid` as an unsigned high and low word, which
 * is why it is reassembled rather than compared whole. `classid::bigint << 32` overflows
 * a signed 64-bit value for any key with its top bit set — PostgreSQL's `int8shl` does
 * not check for that and wraps, which produces the correct two's-complement result, so
 * the reassembly is right for a negative key rather than accidentally right for half of
 * them.
 */
export async function countAdvisoryWaiters(client: Queryable, key: string): Promise<number> {
  return countAdvisoryLocks(client, key, false);
}

/** How many backends **hold** it. The discriminating observation where a probe must see a lock taken rather than waited for. */
export async function countAdvisoryHolders(client: Queryable, key: string): Promise<number> {
  return countAdvisoryLocks(client, key, true);
}

async function countAdvisoryLocks(
  client: Queryable,
  key: string,
  granted: boolean,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM pg_locks l
       JOIN pg_database d ON d.oid = l.database
      WHERE l.locktype = 'advisory'
        AND l.granted = $2::boolean
        AND l.objsubid = 1
        AND d.datname = current_database()
        AND ((l.classid::bigint << 32) | l.objid::bigint) = $1::bigint`,
    [key, granted],
  );

  return Number(rows[0].count);
}
