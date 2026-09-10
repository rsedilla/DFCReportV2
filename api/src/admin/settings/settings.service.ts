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
 * **No setter for the encoding phase exists here, deliberately.** Section 7 puts
 * every change behind `settings.manage` with an audit entry carrying the previous
 * and new values, and section 2 closes the encoding phase by "a deliberate, audited
 * Admin action" — which is an endpoint, and `docs/ROADMAP.md` puts it in Stage 7.
 * Writing that setter now would mean writing its authorization as a comment, which
 * is the failure this repository keeps correcting. A method with no caller is the
 * other one.
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
