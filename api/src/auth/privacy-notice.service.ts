import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';

import { ValidationFailedError } from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';

import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';

/**
 * The Privacy Notice in force, named by its "Last updated" date (decision 0496).
 *
 * It moves with the wording of `web/app/privacy/page.tsx`, in the same change, and moving it
 * asks every account again at its next open. The website's *Before you continue* screen sends
 * back the date `/auth/me` names, so it never disagrees with this. The activation page sends
 * its own copy, in `web/lib/privacy-notice.ts`, having no session to ask, so while a deploy
 * that moves the date has reached one of the two and not the other, in either order, every
 * activation is refused with a message asking for a reload, and succeeds once both are
 * deployed. A change that moves the date deploys the API and the website together.
 */
export const PRIVACY_NOTICE_VERSION = '2026-11-16';

/** Where a tick sent against another notice is refused, and why. */
function staleNotice(field: string): ValidationFailedError {
  return new ValidationFailedError(
    'The Privacy Notice has changed since this page opened. Reload the page and read it again.',
    { field, current: PRIVACY_NOTICE_VERSION },
  );
}

/**
 * Ticks that an account holder read the Privacy Notice (SKILL.md sections 6 and 24, decision
 * 0496).
 *
 * **Only the holder ticks their own**: at activation, where the activation token is the
 * credential, and once signed in, where their session is. Nothing here takes an account from a
 * request body. A tick records a fact and grants nothing, so no route reads it to decide
 * access.
 */
@Injectable()
export class PrivacyNoticeService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** The caller's own tick of the notice in force, for `/auth/me`. */
  async ownStatus(accountId: string): Promise<{ version: string; acknowledged_at: string | null }> {
    return {
      version: PRIVACY_NOTICE_VERSION,
      acknowledged_at: await this.acknowledgedAt(accountId),
    };
  }

  /** When an account ticked the notice in force, or null where it has not. */
  async acknowledgedAt(accountId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('privacy_notice_acknowledgments')
      .select('acknowledged_at')
      .where('account_id', '=', accountId)
      .where('notice_version', '=', PRIVACY_NOTICE_VERSION)
      .executeTakeFirst();

    return row ? new Date(row.acknowledged_at).toISOString() : null;
  }

  /**
   * The caller ticks the notice once signed in. A second tick of the same notice writes nothing
   * and answers with the first one's time, which is the evidence.
   */
  async acknowledgeOwn(
    actor: Actor,
    version: string,
    claim: CurrentClaim,
  ): Promise<{ version: string; acknowledged_at: string }> {
    return this.db.transaction().execute(async (trx) => {
      const acknowledgedAt = await this.acknowledgeWithin(trx, actor.accountId, version, 'version');
      const body = { version: PRIVACY_NOTICE_VERSION, acknowledged_at: acknowledgedAt };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Records a tick in the caller's transaction, refusing any notice but the one in force, and
   * answers when the account first ticked it. Used by activation as well, inside the
   * transaction that sets the first password.
   */
  async acknowledgeWithin(
    trx: Transaction<Database>,
    accountId: string,
    version: string,
    /** The body field the date came in, which a refusal names (decision 0126). */
    field: 'version' | 'privacy_notice_version',
  ): Promise<string> {
    if (version !== PRIVACY_NOTICE_VERSION) {
      throw staleNotice(field);
    }

    // The table refuses an update, so a second tick does nothing rather than move the time.
    await trx
      .insertInto('privacy_notice_acknowledgments')
      .values({ account_id: accountId, notice_version: version })
      .onConflict((conflict) => conflict.columns(['account_id', 'notice_version']).doNothing())
      .execute();

    const row = await trx
      .selectFrom('privacy_notice_acknowledgments')
      .select('acknowledged_at')
      .where('account_id', '=', accountId)
      .where('notice_version', '=', version)
      .executeTakeFirstOrThrow();

    return new Date(row.acknowledged_at).toISOString();
  }
}
