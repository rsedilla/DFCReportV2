import { Injectable } from '@nestjs/common';

import { type Db } from '../../database/database.module';

import type { Database, SettingKey } from '../../database/schema';
import type { Transaction } from 'kysely';

/**
 * The church-wide operational settings (SKILL.md section 7, `settings.manage`).
 *
 * `admin` owns `settings` (section 2, Modules) and this is the only thing that
 * touches it. Nothing read it before this change: migration 0002 created the
 * table and seeded both keys eighteen months of rulings ago, and the value that
 * bounds the initial-encoding relaxation had never been consulted by anything.
 *
 * **Only the read exists here, deliberately.** Section 7 puts every change behind
 * `settings.manage` with an audit entry carrying the previous and new values, and
 * section 2 closes the encoding phase by "a deliberate, audited Admin action" —
 * which is an endpoint, and `docs/ROADMAP.md` puts it in Stage 7. Writing the
 * setter now would mean writing its authorization as a comment, which is the
 * failure this repository keeps correcting. A method with no caller is the other
 * one.
 */
@Injectable()
export class SettingsService {
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
