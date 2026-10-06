import { sql, type Transaction } from 'kysely';

import type { Db } from '../database/database.module';
import type { Database } from '../database/schema';

/**
 * Stored closed months (SKILL.md section 20, decision 0320).
 *
 * A stored report carries the version its month had when it was computed, and is served
 * only while that is still the month's version. Migration 0022's triggers move a month's
 * version whenever a row a stored report reads changes, so nothing here enumerates what
 * invalidates a month.
 */

export type SnapshotKind = 'DCC_MONTHLY' | 'CELL_MONTHLY';

export interface SnapshotKey {
  kind: SnapshotKind;
  scopeType: 'CELL' | 'LEADER' | 'NETWORK' | 'WHOLE_CHURCH';
  /** A Person or Cell id, or a Network name; null for Whole Church. */
  scopeId: string | null;
  period: string;
}

/**
 * How long a month waits for the transactions that were running when its version row
 * was created. Past it the report is computed and served but not stored, which costs a
 * recomputation rather than correctness.
 */
const SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 20;

/** The stored report for this key, if its month has not moved since it was computed. */
export async function readSnapshot(db: Db, key: SnapshotKey): Promise<unknown> {
  // One statement, so the payload and the version it is compared with are one snapshot.
  const row = await db
    .selectFrom('report_snapshots as s')
    .innerJoin('report_month_versions as v', (join) =>
      join.onRef('v.month', '=', 's.period').onRef('v.version', '=', 's.source_version'),
    )
    .select('s.payload')
    .where('s.report_kind', '=', key.kind)
    .where('s.scope_type', '=', key.scopeType)
    .where((eb) =>
      key.scopeId === null ? eb('s.scope_id', 'is', null) : eb('s.scope_id', '=', key.scopeId),
    )
    .where('s.period', '=', key.period)
    .executeTakeFirst();

  return row?.payload;
}

/**
 * Makes a month storable, and says whether it is.
 *
 * **The version row is created first, in a transaction of its own, and then every
 * transaction that was running when it was created is waited out.** A write whose trigger
 * ran before the row existed moved nothing; once those writes have finished, the report
 * computed next sees them, and every later write finds the row and moves it. Without the
 * wait, a write in flight across the row's creation could commit after the month was
 * computed without moving its version, and the stale month would be served for good.
 *
 * Only transactions holding a transaction id are waited for. A write is assigned one before
 * its trigger runs, and a read-only report never is.
 */
export async function prepareToStore(db: Db, period: string): Promise<boolean> {
  await db
    .insertInto('report_month_versions')
    .values({ month: period })
    .onConflict((oc) => oc.column('month').doNothing())
    .execute();

  // **A fresh transaction id, assigned now and committed at once**, rather than a
  // snapshot's xmax. xmax is one past the highest *completed* id, so a writer holding a
  // later id that is still running sits above it and would not be waited for. A write whose
  // trigger missed the row was given its id before the row's creation committed, so its id
  // is below this one, and once this one has committed a later snapshot lists it while it
  // is still running.
  const horizon = (
    await sql<{ horizon: string }>`SELECT pg_current_xact_id()::text AS horizon`.execute(db)
  ).rows[0].horizon;

  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const settled = (
      await sql<{ settled: boolean }>`
        SELECT pg_snapshot_xmin(pg_current_snapshot()) >= ${horizon}::xid8 AS settled
      `.execute(db)
    ).rows[0].settled;
    if (settled) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

/** The month's version, read inside the report's own transaction. */
export async function readVersion(
  trx: Transaction<Database>,
  period: string,
): Promise<string | undefined> {
  const row = await trx
    .selectFrom('report_month_versions')
    .select('version')
    .where('month', '=', period)
    .executeTakeFirst();

  return row?.version;
}

/**
 * Stores a computed month against the version it was computed at. A store computed at an
 * older version never replaces a newer one, so two requests racing to store a month leave
 * the newer.
 */
export async function writeSnapshot(
  db: Db,
  key: SnapshotKey,
  version: string,
  payload: unknown,
): Promise<void> {
  await db
    .insertInto('report_snapshots')
    .values({
      report_kind: key.kind,
      scope_type: key.scopeType,
      scope_id: key.scopeId,
      period: key.period,
      source_version: version,
      payload: JSON.stringify(payload),
    })
    .onConflict((oc) =>
      oc
        .columns(['report_kind', 'scope_type', 'scope_id', 'period'])
        .doUpdateSet((eb) => ({
          source_version: eb.ref('excluded.source_version'),
          payload: eb.ref('excluded.payload'),
          computed_at: sql`now()`,
        }))
        .where(sql<boolean>`report_snapshots.source_version <= excluded.source_version`),
    )
    .execute();
}
