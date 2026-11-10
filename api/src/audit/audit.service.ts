import { Injectable } from '@nestjs/common';

import { sql } from 'kysely';

import { canonicalIfUuid, canonicalId } from '../common/identifiers';

import type { Db } from '../database/database.module';
import type { AuditAction, Database, Json } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * The `audit` module (SKILL.md section 2, Modules). It owns `audit_log` and is
 * the only writer of it.
 *
 * One writer matters more here than for most tables. Section 21 makes this log
 * append-only and requires every entry to carry actor, target, action, timestamp
 * and the relevant before-and-after values — and an entry that omits one is not
 * an error anything raises, it is simply a record that cannot answer the question
 * it was written for. Where four modules insert directly, four of them get to
 * decide separately what "relevant" means.
 */

export interface AuditEntry {
  /** Null only for a system action (section 21). */
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  /** Text, not a UUID: a setting is keyed by its `key` (section 7). */
  targetId: string;
  before?: Json | null;
  after?: Json | null;
  /** Required where the action demands one (section 21). */
  reason?: string | null;
  /** Groups the per-record entries of one bulk import (section 2). */
  batchId?: string | null;
}

@Injectable()
export class AuditService {
  /**
   * Writes an entry inside a caller's transaction.
   *
   * Always inside one, and deliberately there is no pooled-connection variant.
   * Section 5 requires a reassignment to be audit logged and section 21 requires
   * the entry to describe what happened — so an entry that commits when the
   * change it describes rolled back is a record of something that never occurred,
   * and one that fails to commit when the change did leaves the change
   * unexplained. Neither is recoverable afterwards, because the log is
   * append-only and nothing may edit it.
   */
  async writeWithin(transaction: Transaction<Database>, entry: AuditEntry): Promise<void> {
    await transaction
      .insertInto('audit_log')
      .values({
        actor_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        // Canonical, because this is the one place a client-supplied identifier is
        // **stored** rather than compared. The column is `text` (section 21: not
        // every target is keyed by a UUID), so the lookup it will eventually face
        // is case-sensitive — and migration 0002 makes an audit row unrepairable,
        // so a mis-cased target would be an entry permanently invisible to the
        // search section 7 resolves scope through. Closed here rather than left to
        // every caller having wired a pipe.
        //
        // Narrowed to values that are UUIDs: a setting's key is a target too, and
        // lowercasing every target would canonicalize the identifiers and corrupt
        // anything else that is case-sensitive.
        target_id: canonicalIfUuid(entry.targetId),
        before: entry.before ?? null,
        after: entry.after ?? null,
        reason: entry.reason ?? null,
        batch_id: entry.batchId ?? null,
      })
      .execute();
  }

  /**
   * Who put each of these people into this Cell: the account behind the latest *added* or
   * *moved* entry naming the Cell, for each person (decision 0464). A Cell's Members page
   * shows it where that was not the Cell's own leader.
   *
   * **One fact per member, and nothing else of the log.** Section 10 puts a membership's actor
   * here rather than on the row (migration 0009 declines an `actor_id` column for that reason),
   * so the roster asks the log rather than the table growing a second record of it. What it
   * returns is the account that made the membership the reader is already looking at, which
   * the roster's own capability admits; no other entry, field or action is reachable through
   * it, so it is not the audit log read `audit.view` guards.
   *
   * The latest entry, because a person who left the Cell and came back holds the membership the
   * second entry opened. Absent for a membership no entry opened, such as one encoded at setup.
   * Indexed by `audit_log_by_target`, over at most one page of a roster.
   */
  async whoAddedWithin(
    executor: Db | Transaction<Database>,
    cellId: string,
    personIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await executor
      .selectFrom('audit_log')
      .select(['target_id', 'actor_id'])
      .distinctOn('target_id')
      .where('target_type', '=', 'person')
      .where(
        'target_id',
        'in',
        personIds.map((id) => canonicalId(id)),
      )
      .where('action', 'in', ['cell_membership.added', 'cell_membership.moved'])
      .where(sql<string>`after->>'cell_uuid'`, '=', canonicalId(cellId))
      .orderBy('target_id')
      .orderBy('occurred_at', 'desc')
      .execute();

    return new Map(
      rows.flatMap((row) =>
        row.actor_id === null ? [] : [[row.target_id, row.actor_id] as const],
      ),
    );
  }
}
