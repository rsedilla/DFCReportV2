import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  InvariantViolationError,
  NotFoundError,
  UnauthenticatedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';

import { AccountTokensService } from './account-tokens.service';
import { TokensService } from './tokens.service';

import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { AccountStatus } from '../database/schema';

/** What both routes answer: the account's state after the change. */
export type AccountAccessBody = {
  id: string;
  status: AccountStatus;
};

/** What setting Full view answers: the account's value after the change. */
export type FullViewBody = {
  id: string;
  full_view: boolean;
};

/**
 * Disabling an account and re-enabling it, by an administrator (SKILL.md section 6,
 * decision 0307), and ticking Full view (section 7, decision 0323).
 *
 * **Both take every lock in the order setting a password takes them**: the account's
 * tokens first, then the account row. An activation already under way finishes first
 * and this then sees its outcome; one that comes later finds its link used.
 *
 * Roles, grants and a Senior Pastor seat are untouched by either. Disablement is an
 * authentication decision (section 10), so a disabled account keeps its authority and
 * re-enabling gives it all back.
 */
@Injectable()
export class AccountAccessService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly accountTokens: AccountTokensService,
    private readonly sessions: TokensService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Ends every session at once and kills every activation and reset link. Refused for
   * the actor's own account, so whoever disables somebody is an administrator who can
   * still sign in.
   */
  async disable(accountId: string, actor: Actor, claim: CurrentClaim): Promise<AccountAccessBody> {
    return this.db.transaction().execute(async (trx) => {
      await this.accountTokens.supersedeAllWithin(trx, accountId);

      if (accountId === actor.accountId) {
        throw new InvariantViolationError(
          'You can’t disable your own account. Another administrator can.',
          { account_id: accountId },
        );
      }

      // The actor's row is locked with the target's, in id order, and must still be
      // active: two administrators disabling each other at once would otherwise both
      // commit and leave nobody able to sign in.
      const rows = await trx
        .selectFrom('accounts')
        .select(['id', 'status'])
        .where('id', 'in', [accountId, actor.accountId])
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();

      if (rows.find((row) => row.id === actor.accountId)?.status !== 'ACTIVE') {
        throw new UnauthenticatedError('Your session has ended. Sign in again.');
      }

      const account = rows.find((row) => row.id === accountId);

      if (!account) {
        throw new NotFoundError('No such account.');
      }

      if (account.status === 'DISABLED') {
        throw new InvariantViolationError('That account is already disabled.', {
          account_id: accountId,
          status: account.status,
        });
      }

      await trx
        .updateTable('accounts')
        .set({ status: 'DISABLED', updated_at: new Date() })
        .where('id', '=', accountId)
        .execute();

      await this.sessions.revokeAllSessionsWithin(trx, accountId);

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'account.disabled',
        targetType: 'account',
        targetId: accountId,
        before: { status: account.status },
        after: { status: 'DISABLED' },
      });

      const body: AccountAccessBody = { id: accountId, status: 'DISABLED' };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Re-enables a disabled account: `ACTIVE` where its holder has set a password, and
   * awaiting activation where they never did, for the administrator to resend the email.
   *
   * **Sessions and links are ended again**, not left as disabling left them: a sign-in
   * that raced the disablement, or a reset link requested in the same moment, would
   * otherwise come back to life here. Nothing from before the disablement works after it.
   */
  async reactivate(
    accountId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<AccountAccessBody> {
    return this.db.transaction().execute(async (trx) => {
      await this.accountTokens.supersedeAllWithin(trx, accountId);

      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'status', 'password_hash'])
        .where('id', '=', accountId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      if (!account) {
        throw new NotFoundError('No such account.');
      }

      if (account.status !== 'DISABLED') {
        throw new InvariantViolationError('That account is not disabled.', {
          account_id: accountId,
          status: account.status,
        });
      }

      const status: AccountStatus =
        account.password_hash === null ? 'PENDING_ACTIVATION' : 'ACTIVE';

      await trx
        .updateTable('accounts')
        .set({ status, updated_at: new Date() })
        .where('id', '=', accountId)
        .execute();

      await this.sessions.revokeAllSessionsWithin(trx, accountId);

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'account.reactivated',
        targetType: 'account',
        targetId: accountId,
        before: { status: 'DISABLED' },
        after: { status },
      });

      const body: AccountAccessBody = { id: accountId, status };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Ticks or clears Full view on a Leader account (decision 0323, point 1). An account
   * holding no `LEADER` role is refused, since Full view changes only what that role gives.
   *
   * **Setting the value it already has writes nothing and is not audited**: the audit log
   * records each change, and two administrators ticking the same box at once both see it
   * ticked rather than one of them being refused.
   */
  async setFullView(
    accountId: string,
    fullView: boolean,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<FullViewBody> {
    return this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'full_view'])
        .where('id', '=', accountId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      if (!account) {
        throw new NotFoundError('No such account.');
      }

      const leader = await trx
        .selectFrom('account_roles')
        .select('role')
        .where('account_id', '=', accountId)
        .where('role', '=', 'LEADER')
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (!leader) {
        throw new InvariantViolationError('Full view applies only to a Leader account.', {
          account_id: accountId,
        });
      }

      if (account.full_view !== fullView) {
        await trx
          .updateTable('accounts')
          .set({ full_view: fullView, updated_at: new Date() })
          .where('id', '=', accountId)
          .execute();

        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'account.full_view_changed',
          targetType: 'account',
          targetId: accountId,
          before: { full_view: account.full_view },
          after: { full_view: fullView },
        });
      }

      const body: FullViewBody = { id: accountId, full_view: fullView };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }
}
