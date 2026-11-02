import { Inject, Injectable } from '@nestjs/common';

import { type Actor } from '../../auth/authorization/authorization.service';
import { DccCalendarService } from '../../attendance/dcc-calendar.service';
import { InvariantViolationError, ValidationFailedError } from '../../common/errors/api-error';
import { boundLockWaitsWithin } from '../../database/person-lock';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../../database/database.module';
import { SettingsService } from '../settings/settings.service';

import type { CurrentClaim } from '../../common/idempotency/current-idempotency.decorator';
import type { Database } from '../../database/schema';
import type { Transaction } from 'kysely';

/** What the Admin's Settings tab shows (decision 0425). A type, so it is assignable to `Json`. */
export type SettingsView = {
  cell_attention_months: number;
  initial_encoding_open: boolean;
  /** The first Sunday the DCC calendar covers, shown and never changed here. */
  dcc_calendar_start: string | null;
  /** The last Sunday the calendar has been generated to (section 9's horizon). */
  dcc_calendar_through: string | null;
  /** The verse under Record's welcome, both null where none is shown. */
  record_verse: RecordVerse;
};

/** A type, so it is assignable to `Json`. */
export type RecordVerse = { text: string | null; reference: string | null };

/**
 * The Admin's Settings tab (SKILL.md sections 7 and 19, decision 0425): one read and the
 * two changes it offers. The rows belong to `SettingsService`, which alone writes them and
 * audits every change; the calendar's reach is `attendance`'s, asked through its service.
 *
 * A module of its own beside `settings`, because `attendance` imports `settings` and a read
 * that also needs `attendance` there would close a cycle.
 */
@Injectable()
export class SettingsRoutesService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly calendar: DccCalendarService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async read(): Promise<SettingsView> {
    return this.viewWithin(this.db, await this.calendar.horizon());
  }

  /** The verse alone, which every signed-in account reads for Record. */
  async recordVerse(): Promise<RecordVerse> {
    return this.settings.recordVerseWithin(this.db);
  }

  /**
   * `PUT /settings/record-verse`. Both words and reference, or neither: one without the other
   * names the missing field. Setting the verse it already holds is no change.
   */
  async setRecordVerse(
    actor: Actor,
    verse: RecordVerse,
    claim: CurrentClaim,
  ): Promise<SettingsView> {
    if ((verse.text === null) !== (verse.reference === null)) {
      const field = verse.text === null ? 'text' : 'reference';
      throw new ValidationFailedError(`${field} is needed with the other, or both left empty.`, {
        field,
      });
    }
    const through = await this.calendar.horizon();

    return this.db.transaction().execute(async (trx) => {
      await this.settings.setRecordVerseWithin(trx, actor.accountId, verse);
      const response = await this.viewWithin(trx, through);
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /** `PATCH /settings/cell-attention-months`. Setting the value it already holds is no change. */
  async setCellAttentionMonths(
    actor: Actor,
    months: number,
    claim: CurrentClaim,
  ): Promise<SettingsView> {
    const through = await this.calendar.horizon();

    return this.db.transaction().execute(async (trx) => {
      await this.settings.setCellAttentionMonthsWithin(trx, actor.accountId, months);
      const response = await this.viewWithin(trx, through);
      // Last statement in the transaction, and inside it (CLAUDE.md, *Write endpoints*).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  /**
   * `POST /settings/initial-encoding/close`. Closed once and never reopened (section 2); a
   * second close is refused rather than answered as a success, so nobody is told they
   * closed something somebody else already had.
   */
  async closeInitialEncoding(actor: Actor, claim: CurrentClaim): Promise<SettingsView> {
    const through = await this.calendar.horizon();

    return this.db.transaction().execute(async (trx) => {
      // Its row lock is taken outside any advisory lock, so it bounds its own wait (section 24):
      // a tree import holds the row shared for its whole run.
      await boundLockWaitsWithin(trx);
      if (!(await this.settings.closeInitialEncodingWithin(trx, actor.accountId))) {
        throw new InvariantViolationError('Initial encoding is already closed.');
      }
      const response = await this.viewWithin(trx, through);
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body: response });
      return response;
    });
  }

  private async viewWithin(
    executor: Db | Transaction<Database>,
    through: string | null,
  ): Promise<SettingsView> {
    return {
      cell_attention_months: await this.settings.cellAttentionMonthsWithin(executor),
      initial_encoding_open: await this.settings.initialEncodingOpenWithin(executor),
      dcc_calendar_start: await this.settings.dccCalendarStartWithin(executor),
      dcc_calendar_through: through,
      record_verse: await this.settings.recordVerseWithin(executor),
    };
  }
}
