import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  InvariantViolationError,
  NotFoundError,
  UnauthenticatedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

import { AccountTokensService } from './account-tokens.service';
import { TokensService } from './tokens.service';

import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { AccountStatus, AuditAction, Database } from '../database/schema';
import type { Transaction } from 'kysely';

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

/** What setting Approves Cells answers: the account's value after the change. */
export type ApprovesCellsBody = {
  id: string;
  approves_cells: boolean;
};

/** What setting Moves people answers: the account's value after the change. */
export type MovesPeopleBody = {
  id: string;
  moves_people: boolean;
};

type LeaderTick = 'full_view' | 'approves_cells' | 'moves_people';

/** Each tick's name in a refusal and its audit action (decisions 0323, 0352 and 0356). */
const TICKS: Record<LeaderTick, { label: string; action: AuditAction }> = {
  full_view: { label: 'Full view', action: 'account.full_view_changed' },
  approves_cells: { label: 'Approves Cells', action: 'account.approves_cells_changed' },
  moves_people: { label: 'Moves people', action: 'account.moves_people_changed' },
};

/** The ticks offered only with Full view, and cleared with it (decisions 0352 and 0356). */
const NEEDS_FULL_VIEW: readonly ('approves_cells' | 'moves_people')[] = [
  'approves_cells',
  'moves_people',
];

/**
 * Disabling an account and re-enabling it, by an administrator (SKILL.md section 6,
 * decision 0307), and ticking Full view (section 7, decision 0323).
 *
 * **Disabling and re-enabling take every lock in the order setting a password takes them**:
 * the account's
 * tokens first, then the account row. An activation already under way finishes first
 * and this then sees its outcome; one that comes later finds its link used.
 *
 * Roles, grants and a Senior Pastor seat are untouched by those two. Disablement is an
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
    private readonly people: PeopleReadService,
  ) {}

  /**
   * Refuses a change to an account whose Person was merged away (SKILL.md section 3, decision
   * 0408): the merge disabled it, and its holder signs in through the record kept. Read after
   * the account row is locked, so a merge committing first is seen; one committing later
   * disables the account again.
   */
  private async assertHolderNotMergedAwayWithin(
    trx: Transaction<Database>,
    accountId: string,
  ): Promise<void> {
    const account = await trx
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!account) {
      return;
    }

    const person = await this.people.forDecisionWithin(trx, account.person_id);
    if (person?.mergedIntoId) {
      throw new InvariantViolationError(
        'That account belongs to a record merged into another. Give the record kept an account instead.',
        { account_id: accountId, merged_into_id: person.mergedIntoId },
      );
    }
  }

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

      await this.writeDisabledWithin(trx, accountId, account.status, actor.accountId);

      const body: AccountAccessBody = { id: accountId, status: 'DISABLED' };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Disables an account inside the caller's transaction, for an archive that chose
   * *Disable account access* (SKILL.md section 6, decision 0397). The locks are taken in
   * `disable`'s order, tokens then the account row, and an account already disabled is left
   * as it is: the archive offers the choice only for one that is not.
   *
   * No self-refusal here: the archive itself refuses the actor's own Person.
   */
  async disableWithin(
    trx: Transaction<Database>,
    accountId: string,
    actorAccountId: string,
  ): Promise<void> {
    await this.accountTokens.supersedeAllWithin(trx, accountId);

    // The actor's row with the target's, in id order, and the actor still active, as
    // `disable` takes them: two administrators each disabling the other, by either route,
    // would otherwise both commit and leave nobody able to sign in.
    const rows = await trx
      .selectFrom('accounts')
      .select(['id', 'status'])
      .where('id', 'in', [accountId, actorAccountId])
      .orderBy('id')
      .forNoKeyUpdate()
      .execute();

    if (rows.find((row) => row.id === actorAccountId)?.status !== 'ACTIVE') {
      throw new UnauthenticatedError('Your session has ended. Sign in again.');
    }

    const account = rows.find((row) => row.id === accountId);

    if (!account || account.status === 'DISABLED') {
      return;
    }

    await this.writeDisabledWithin(trx, accountId, account.status, actorAccountId);
  }

  /** The write and the audit entry both disabling paths share. */
  private async writeDisabledWithin(
    trx: Transaction<Database>,
    accountId: string,
    status: AccountStatus,
    actorAccountId: string,
  ): Promise<void> {
    await trx
      .updateTable('accounts')
      .set({ status: 'DISABLED', updated_at: new Date() })
      .where('id', '=', accountId)
      .execute();

    await this.sessions.revokeAllSessionsWithin(trx, accountId);

    await this.audit.writeWithin(trx, {
      actorId: actorAccountId,
      action: 'account.disabled',
      targetType: 'account',
      targetId: accountId,
      before: { status },
      after: { status: 'DISABLED' },
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

      await this.assertHolderNotMergedAwayWithin(trx, accountId);

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
    return (await this.setLeaderTick(
      'full_view',
      accountId,
      fullView,
      actor,
      claim,
    )) as unknown as FullViewBody;
  }

  /**
   * Ticks or clears Approves Cells on a Leader account (decision 0352, point 1), exactly as
   * Full view is ticked: refused on an account holding no `LEADER` role, and audited only
   * when the value changes.
   */
  async setApprovesCells(
    accountId: string,
    approvesCells: boolean,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<ApprovesCellsBody> {
    return (await this.setLeaderTick(
      'approves_cells',
      accountId,
      approvesCells,
      actor,
      claim,
    )) as unknown as ApprovesCellsBody;
  }

  /**
   * Ticks or clears Moves people on a Leader account (decision 0356), exactly as Approves
   * Cells is ticked: refused on an account holding no `LEADER` role or without Full view,
   * and audited only when the value changes.
   */
  async setMovesPeople(
    accountId: string,
    movesPeople: boolean,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<MovesPeopleBody> {
    return (await this.setLeaderTick(
      'moves_people',
      accountId,
      movesPeople,
      actor,
      claim,
    )) as unknown as MovesPeopleBody;
  }

  /** The one write the three ticks share: lock, check the role, write and audit a change. */
  private async setLeaderTick(
    column: LeaderTick,
    accountId: string,
    value: boolean,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, string | boolean>> {
    const { label } = TICKS[column];

    return this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'full_view', 'approves_cells', 'moves_people'])
        .where('id', '=', accountId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      if (!account) {
        throw new NotFoundError('No such account.');
      }

      await this.assertHolderNotMergedAwayWithin(trx, accountId);

      const leader = await trx
        .selectFrom('account_roles')
        .select('role')
        .where('account_id', '=', accountId)
        .where('role', '=', 'LEADER')
        .where('revoked_at', 'is', null)
        .executeTakeFirst();

      if (!leader) {
        throw new InvariantViolationError(`${label} applies only to a Leader account.`, {
          account_id: accountId,
        });
      }

      // Approves Cells and Moves people are offered only on an account with Full view
      // (owners' rulings of 2026-10-15 and 2026-10-16, decisions 0352 and 0356).
      if (column !== 'full_view' && value && !account.full_view) {
        throw new InvariantViolationError(
          `${label} is offered only on an account with Full view. Tick Full view first ` +
            '(SKILL.md section 7).',
          { account_id: accountId },
        );
      }

      // Clearing Full view clears both with it, in the same transaction and each audited as
      // its own change, so no account holds either without Full view.
      if (column === 'full_view' && !value) {
        for (const tick of NEEDS_FULL_VIEW.filter((name) => account[name])) {
          await trx
            .updateTable('accounts')
            .set({ [tick]: false, updated_at: new Date() })
            .where('id', '=', accountId)
            .execute();

          await this.audit.writeWithin(trx, {
            actorId: actor.accountId,
            action: TICKS[tick].action,
            targetType: 'account',
            targetId: accountId,
            before: { [tick]: true },
            after: { [tick]: false },
          });
        }
      }

      if (account[column] !== value) {
        await trx
          .updateTable('accounts')
          .set({ [column]: value, updated_at: new Date() })
          .where('id', '=', accountId)
          .execute();

        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: TICKS[column].action,
          targetType: 'account',
          targetId: accountId,
          before: { [column]: account[column] },
          after: { [column]: value },
        });
      }

      const body: Record<string, string | boolean> = { id: accountId, [column]: value };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }
}
