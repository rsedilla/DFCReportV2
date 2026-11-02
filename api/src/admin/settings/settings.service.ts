import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { AuditService } from '../../audit/audit.service';
import { type Db } from '../../database/database.module';

import type { Database, Json, SettingKey } from '../../database/schema';
import type { Transaction } from 'kysely';

/**
 * The church-wide operational settings (SKILL.md section 7, `settings.manage`).
 *
 * `admin` owns `settings` (section 2, Modules) and this is the only thing that
 * touches it. Nothing read it before this change: migration 0002 created the
 * table and seeded both keys eighteen months of rulings ago, and the value that
 * bounds the initial-encoding relaxation had never been consulted by anything.
 *
 * **The encoding phase's setter closes it and nothing reopens it.** It arrived with its
 * endpoint, `POST /settings/initial-encoding/close` under `settings.manage` (decision
 * 0425), rather than before it: a setter written ahead of its route would have carried
 * its authorization as a comment.
 *
 * **The DCC calendar's floor is different on both counts** (ruling of 2026-09-11),
 * which is why its setter is here and that one is not: its authorization is already
 * settled — the scheduled command's first run sets it, with no actor (decisions 0161
 * and 0169) — and it has a caller today. It arrived here because `attendance` was
 * writing `settings` directly, which section 2 forbids without exception on the write
 * side, and because that write emitted no audit entry at all where section 7 requires
 * one for every change.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly audit: AuditService) {}
  /**
   * Whether the initial-encoding phase is open (section 2).
   *
   * **Takes an executor rather than fixing one**, because the two callers need
   * different ones. `PeopleImportService` asks inside the import's transaction,
   * where a pooled read would answer from the state the request arrived with and
   * would ask a bounded pool for a second connection — the liveness hazard section
   * 24 names. The import's precondition check asks on the pool, deliberately: it
   * runs before any transaction exists, so that an operator is told the phase is
   * closed before adjudicating thirty rows rather than after.
   *
   * *An earlier version of this said both callers ask inside a transaction, which
   * was false of the one written in the same commit.*
   *
   * The pattern is `HierarchyService`'s: the executor is a parameter, and there is
   * no pooled variant sitting beside it to reach for by accident.
   *
   * **It refuses a missing row rather than defaulting.** Migration 0002 seeds both
   * keys by a system action so that the application never invents a default, which
   * is what would otherwise put a church-wide value in two places and let them
   * disagree. A row that is absent means the migration did not run, and answering
   * `false` would present that as a closed phase — or answering `true` would
   * present it as an open one, which is the worse direction: it is exactly the
   * relaxation section 2 says must have an end.
   */
  async initialEncodingOpenWithin(executor: Db | Transaction<Database>): Promise<boolean> {
    return (await this.readFlag(executor, 'initial_encoding_open')) === true;
  }

  /**
   * Whether the phase is open, **read under a shared lock on its row** (decision 0425), for an
   * operation the phase permits. The close takes the row exclusively, so an operation reading
   * while a close is in flight waits for it and then reads it closed, rather than reading the
   * committed `true` and committing after the close did, which is the relaxation outliving its
   * end. Section 24 places the lock.
   */
  async initialEncodingOpenSharedWithin(transaction: Transaction<Database>): Promise<boolean> {
    const row = await transaction
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'initial_encoding_open')
      .forShare()
      .executeTakeFirst();

    if (row === undefined) {
      throw new Error(
        'The setting `initial_encoding_open` is missing. Migration 0002 seeds it, so an absent ' +
          'row means the database is not fully migrated. Run `npm run migrate:up`.',
      );
    }
    return row.value === true;
  }

  /**
   * The first Sunday the DCC calendar covers, or null before any run has set it
   * (SKILL.md sections 7 and 9).
   *
   * Null rather than a throw for an unset *value*, because unset is the legitimate
   * state of a church that has not generated a calendar yet. A missing **row** still
   * throws, through `readFlag` below: that means the migration did not run.
   */
  async dccCalendarStartWithin(executor: Db | Transaction<Database>): Promise<string | null> {
    const value = await this.readFlag(executor, 'dcc_calendar_start');

    return typeof value === 'string' ? value : null;
  }

  /**
   * The church-wide attention threshold (SKILL.md section 15): how many finished months
   * the *No meeting in 3 months* filter looks back over (decision 0355). Refused where the
   * row is missing or not a whole number of at least one, rather than defaulted.
   */
  async cellAttentionMonthsWithin(executor: Db | Transaction<Database>): Promise<number> {
    const value = await this.readFlag(executor, 'cell_attention_months');

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error('The setting `cell_attention_months` is not a whole number of months.');
    }
    return value;
  }

  /**
   * Set the floor, once, and audit it — or do neither.
   *
   * **The two are one statement on purpose.** Section 7 requires every change to a
   * setting to be audit logged with its previous and new values, and the write this
   * replaced emitted nothing: `setting.changed` had been in the audit vocabulary
   * since it was written with no code ever emitting it. Putting the row and the entry
   * in one method is what stops the next caller reproducing that.
   *
   * **It refuses to move a floor that is already set** rather than silently
   * overwriting, because section 9 makes this value a record of when the church's
   * calendar began and every report over an earlier range reads it. The caller checks
   * first; this checks again, under the caller's transaction, because a check that
   * reads what its caller handed it is not a check (decision 0122).
   *
   * **A null actor, which section 6 permits for exactly this case**: the command is
   * invoked by a schedule and has no interactive actor.
   *
   * Returns whether it wrote, so a caller can tell "I set it" from "somebody else
   * already had".
   */
  async setDccCalendarStartOnceWithin(
    transaction: Transaction<Database>,
    calendarStart: string,
    now: Date,
  ): Promise<boolean> {
    const previous = await this.dccCalendarStartWithin(transaction);

    if (previous !== null) {
      return false;
    }

    await transaction
      .updateTable('settings')
      // `settings.value` is `jsonb`, so a date goes in as a JSON string rather than as
      // bare text — `to_jsonb` rather than a cast, which would refuse `2026-08-30` as
      // invalid JSON. `dccCalendarStartWithin` unwraps it the same way.
      .set({ value: sql<Json>`to_jsonb(${calendarStart}::text)`, updated_at: now })
      .where('key', '=', 'dcc_calendar_start')
      .execute();

    await this.audit.writeWithin(transaction, {
      actorId: null,
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'dcc_calendar_start',
      before: { value: null },
      after: { value: calendarStart },
    });

    return true;
  }

  /**
   * Change the attention threshold, and audit it — or, where it already holds that value,
   * do neither (decision 0425). A write that changes nothing records nothing, as section 7
   * says of a write that writes nothing.
   *
   * The row is locked first, so the audit entry's previous value is the one this replaced.
   * Returns whether it wrote.
   */
  async setCellAttentionMonthsWithin(
    transaction: Transaction<Database>,
    actorId: string,
    months: number,
  ): Promise<boolean> {
    await this.lockWithin(transaction, 'cell_attention_months');
    const previous = await this.cellAttentionMonthsWithin(transaction);

    if (previous === months) {
      return false;
    }

    await transaction
      .updateTable('settings')
      .set({ value: sql<Json>`to_jsonb(${months}::int)`, updated_at: sql<Date>`now()` })
      .where('key', '=', 'cell_attention_months')
      .execute();

    await this.audit.writeWithin(transaction, {
      actorId,
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'cell_attention_months',
      before: { value: previous },
      after: { value: months },
    });

    return true;
  }

  /**
   * Close the initial-encoding phase, once (section 2, decision 0047; the setter decision
   * 0425 gives it). The row is locked, so of two administrators closing it together one
   * closes it and the other is told it is already closed. **It is never reopened**: no
   * method here sets the flag back, and section 2 is that the relaxation has an end.
   *
   * Returns whether it closed it; false where it was already closed.
   */
  async closeInitialEncodingWithin(
    transaction: Transaction<Database>,
    actorId: string,
  ): Promise<boolean> {
    await this.lockWithin(transaction, 'initial_encoding_open');

    // The update names the open value as well as the key, so a close that lost a race
    // changes no row and is told so, whatever the lock above did or did not serialize.
    const closed = await transaction
      .updateTable('settings')
      .set({ value: sql<Json>`'false'::jsonb`, updated_at: sql<Date>`now()` })
      .where('key', '=', 'initial_encoding_open')
      .where(sql<boolean>`value = 'true'::jsonb`)
      .executeTakeFirst();

    if (closed.numUpdatedRows === 0n) {
      return false;
    }

    await this.audit.writeWithin(transaction, {
      actorId,
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'initial_encoding_open',
      before: { value: true },
      after: { value: false },
    });

    return true;
  }

  /**
   * The verse under Record's welcome (decision 0425): its words and reference, or both null.
   * A value that is not that shape is refused rather than shown, as the threshold's is.
   */
  async recordVerseWithin(
    executor: Db | Transaction<Database>,
  ): Promise<{ text: string | null; reference: string | null }> {
    const value = await this.readFlag(executor, 'record_verse');
    const verse = value as { text?: unknown; reference?: unknown } | null;
    const text = verse?.text ?? null;
    const reference = verse?.reference ?? null;

    if (
      (text !== null && typeof text !== 'string') ||
      (reference !== null && typeof reference !== 'string') ||
      (text === null) !== (reference === null)
    ) {
      throw new Error('The setting `record_verse` is not a verse and its reference.');
    }
    return { text, reference };
  }

  /**
   * Change the verse, and audit it, or, where it already holds those words, do neither.
   * Returns whether it wrote.
   */
  async setRecordVerseWithin(
    transaction: Transaction<Database>,
    actorId: string,
    verse: { text: string | null; reference: string | null },
  ): Promise<boolean> {
    await this.lockWithin(transaction, 'record_verse');
    const previous = await this.recordVerseWithin(transaction);

    if (previous.text === verse.text && previous.reference === verse.reference) {
      return false;
    }

    await transaction
      .updateTable('settings')
      .set({
        value: sql<Json>`jsonb_build_object('text', ${verse.text}::text, 'reference', ${verse.reference}::text)`,
        updated_at: sql<Date>`now()`,
      })
      .where('key', '=', 'record_verse')
      .execute();

    await this.audit.writeWithin(transaction, {
      actorId,
      action: 'setting.changed',
      targetType: 'setting',
      targetId: 'record_verse',
      before: { value: previous },
      after: { value: verse },
    });

    return true;
  }

  private async lockWithin(transaction: Transaction<Database>, key: SettingKey): Promise<void> {
    await transaction
      .selectFrom('settings')
      .select('key')
      .where('key', '=', key)
      .forUpdate()
      .executeTakeFirst();
  }

  private async readFlag(executor: Db | Transaction<Database>, key: SettingKey): Promise<unknown> {
    const row = await executor
      .selectFrom('settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();

    if (row === undefined) {
      throw new Error(
        `The setting \`${key}\` is missing. Migration 0002 seeds it, so an absent row ` +
          'means the database is not fully migrated. Run `npm run migrate:up`.',
      );
    }

    return row.value;
  }
}
