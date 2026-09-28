import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  InvariantViolationError,
  NotFoundError,
  UnauthenticatedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { DATABASE, type Db } from '../database/database.module';

import { AccountsRepository, normalizeEmail, type AccountRecord } from './accounts.repository';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  matchingStep,
  otpauthUri,
} from './second-step.crypto';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService, hashToken } from './tokens.service';

import type { SessionTokens } from './auth.service';
import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/** How long a sign-in may sit between the password and the code. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

/** Section 6: five wrong codes, then the sign-in starts again. */
export const MAX_FAILED_ATTEMPTS = 5;

/** What sign-in answers an account that owes the step, in place of tokens. */
export interface SecondStepChallenge {
  /** `CODE` asks for a code; `SETUP` walks the holder through setting the step up. */
  second_step: 'CODE' | 'SETUP';
  /** The credential for the second step. Single-use, and only its hash is stored. */
  challenge: string;
  expires_in: number;
}

export interface SecondStepSetup {
  /** The secret as text, for an app that cannot scan (section 6). */
  key: string;
  /** What the QR code encodes. */
  otpauth_uri: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: UnauthenticatedError };

const SIGN_IN_AGAIN = 'This sign-in has expired. Sign in again.';

/**
 * The second sign-in step of an `ADMIN` or `SENIOR_PASTOR` account (SKILL.md section 6,
 * decision 0302).
 *
 * **A wrong code is committed before it is refused.** Each check runs in a transaction
 * that returns its outcome rather than throwing, because a throw would roll back the
 * count of wrong codes and make the limit of five unenforceable.
 */
@Injectable()
export class SecondStepService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: AccountsRepository,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Called by sign-in once the password is right. */
  async begin(account: AccountRecord): Promise<SecondStepChallenge> {
    const token = randomBytes(32).toString('base64url');

    await this.db
      .insertInto('second_step_challenges')
      .values({
        account_id: account.id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      })
      .execute();

    return {
      second_step: account.second_step_set_up_at === null ? 'SETUP' : 'CODE',
      challenge: token,
      expires_in: CHALLENGE_TTL_SECONDS,
    };
  }

  /**
   * Setup, first half: the secret to add to the app. Asking again during the same
   * sign-in returns the same secret, so reloading the screen does not invalidate a
   * QR code already scanned.
   */
  async startSetup(challengeToken: string): Promise<SecondStepSetup> {
    const outcome = await this.db
      .transaction()
      .execute(async (trx): Promise<Outcome<SecondStepSetup>> => {
        const challenge = await this.openChallenge(trx, challengeToken);
        if (!challenge || (await this.liveStep(trx, challenge.account_id))) {
          return { ok: false, error: signInAgain() };
        }

        const account = await trx
          .selectFrom('accounts')
          .select('email')
          .where('id', '=', challenge.account_id)
          .executeTakeFirstOrThrow();

        let secret: string;
        if (challenge.pending_secret_ciphertext !== null) {
          secret = decryptSecret(challenge.pending_secret_ciphertext, this.config.secondStepKey);
        } else {
          secret = generateSecret();
          await trx
            .updateTable('second_step_challenges')
            .set({ pending_secret_ciphertext: encryptSecret(secret, this.config.secondStepKey) })
            .where('id', '=', challenge.id)
            .execute();
        }

        return { ok: true, value: { key: secret, otpauth_uri: otpauthUri(secret, account.email) } };
      });

    return unwrap(outcome);
  }

  /**
   * Setup, second half: a code proves the app holds the secret. The step, its ten
   * recovery codes and the audit entry are one transaction, and the session is issued
   * after it, so the session postdates `set_up_at`.
   */
  async confirmSetup(
    challengeToken: string,
    code: string,
    deviceLabel: string | null,
  ): Promise<SessionTokens & { recovery_codes: string[] }> {
    const outcome = await this.db
      .transaction()
      .execute(async (trx): Promise<Outcome<{ account: AccountRecord; codes: string[] }>> => {
        const challenge = await this.openChallenge(trx, challengeToken);
        if (!challenge || (await this.liveStep(trx, challenge.account_id))) {
          return { ok: false, error: signInAgain() };
        }

        const account = await this.activeAccount(trx, challenge.account_id);
        if (!account || challenge.pending_secret_ciphertext === null) {
          return { ok: false, error: signInAgain() };
        }

        const secret = decryptSecret(
          challenge.pending_secret_ciphertext,
          this.config.secondStepKey,
        );
        const step = matchingStep(secret, code, new Date());
        if (step === null) {
          return { ok: false, error: await this.recordFailure(trx, challenge) };
        }

        const setUpAt = new Date();
        const created = await trx
          .insertInto('second_steps')
          .values({
            account_id: account.id,
            secret_ciphertext: challenge.pending_secret_ciphertext,
            last_used_step: step,
            set_up_at: setUpAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const codes = generateRecoveryCodes();
        await trx
          .insertInto('second_step_recovery_codes')
          .values(
            codes.map((recovery) => ({
              second_step_id: created.id,
              code_hash: hashRecoveryCode(recovery, this.config.secondStepKey),
            })),
          )
          .execute();

        await trx
          .updateTable('second_step_challenges')
          .set({ used_at: setUpAt, pending_secret_ciphertext: null })
          .where('id', '=', challenge.id)
          .execute();

        await this.audit.writeWithin(trx, {
          actorId: account.id,
          action: 'second_step.set_up',
          targetType: 'account',
          targetId: account.id,
        });

        return { ok: true, value: { account, codes } };
      });

    const { account, codes } = unwrap(outcome);
    return { ...(await this.issue(account, deviceLabel)), recovery_codes: codes };
  }

  /** Every later sign-in: a code from the app, or one recovery code. */
  async verify(
    challengeToken: string,
    answer: { code?: string; recoveryCode?: string },
    deviceLabel: string | null,
  ): Promise<SessionTokens> {
    const outcome = await this.db
      .transaction()
      .execute(async (trx): Promise<Outcome<AccountRecord>> => {
        const challenge = await this.openChallenge(trx, challengeToken);
        const step = challenge ? await this.liveStep(trx, challenge.account_id, true) : undefined;
        if (!challenge || !step) {
          return { ok: false, error: signInAgain() };
        }

        const account = await this.activeAccount(trx, challenge.account_id);
        if (!account) {
          return { ok: false, error: signInAgain() };
        }

        const accepted =
          answer.recoveryCode !== undefined
            ? await this.redeemRecoveryCode(trx, step.id, account.id, answer.recoveryCode)
            : await this.acceptCode(trx, step, answer.code ?? '');

        if (!accepted) {
          return { ok: false, error: await this.recordFailure(trx, challenge) };
        }

        await trx
          .updateTable('second_step_challenges')
          .set({ used_at: new Date() })
          .where('id', '=', challenge.id)
          .execute();

        return { ok: true, value: account };
      });

    return this.issue(unwrap(outcome), deviceLabel);
  }

  /**
   * An administrator resets a Senior Pastor's step from the person page (section 6). Never
   * an administrator's: that is the server command's, so that no administrator can remove
   * another's.
   */
  async resetByAdministrator(accountId: string, actor: Actor, claim: CurrentClaim): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', accountId)
        .executeTakeFirst();
      if (!account) {
        throw new NotFoundError('No such account.');
      }

      const roles = await this.liveRoles(trx, accountId);
      if (roles.includes('ADMIN')) {
        throw new InvariantViolationError(
          "An administrator's second step is reset on the server, never through the product.",
          { account_id: accountId },
        );
      }
      if (!roles.includes('SENIOR_PASTOR')) {
        throw new InvariantViolationError('This account signs in without a second step.', {
          account_id: accountId,
        });
      }

      await this.revokeWithin(trx, accountId, actor.accountId);

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 204, body: null });
    });
  }

  /**
   * `npm run reset:second-step`: an administrator's step, reset by an operator on the
   * server. A system action with no account to act as, so the audit actor is null
   * (section 6, the first Admin account).
   */
  async resetByCommand(email: string): Promise<{ accountId: string }> {
    return this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounts')
        .select('id')
        .where('email_normalized', '=', normalizeEmail(email))
        .executeTakeFirst();
      if (!account) {
        throw new NotFoundError(`No account has the address ${email}.`);
      }

      const roles = await this.liveRoles(trx, account.id);
      if (!roles.includes('ADMIN')) {
        throw new InvariantViolationError(
          "This command resets an administrator's second step. A Senior Pastor's is reset from their person page.",
          { account_id: account.id },
        );
      }

      await this.revokeWithin(trx, account.id, null);
      return { accountId: account.id };
    });
  }

  /** Whether an account's step is set up, for the person page (section 6). */
  async describeFor(accountId: string): Promise<{ required: boolean; set_up_at: string | null }> {
    const account = await this.accounts.findById(accountId);
    return {
      required: account?.owes_second_step ?? false,
      set_up_at: account?.second_step_set_up_at?.toISOString() ?? null,
    };
  }

  private async revokeWithin(
    trx: Transaction<Database>,
    accountId: string,
    actorId: string | null,
  ): Promise<void> {
    // The account row first, as every revocation takes it (section 6). It also closes
    // every sign-in paused between the password and the code.
    await this.tokens.revokeAllSessionsWithin(trx, accountId);

    const revoked = await trx
      .updateTable('second_steps')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .returning(['id', 'set_up_at'])
      .executeTakeFirst();

    if (!revoked) {
      throw new InvariantViolationError(
        'There is no second step to reset: it has not been set up.',
        {
          account_id: accountId,
        },
      );
    }

    await this.audit.writeWithin(trx, {
      actorId,
      action: 'second_step.reset',
      targetType: 'account',
      targetId: accountId,
      before: { set_up_at: revoked.set_up_at.toISOString() },
    });
  }

  private async openChallenge(trx: Transaction<Database>, token: string) {
    const challenge = await trx
      .selectFrom('second_step_challenges')
      .select(['id', 'account_id', 'pending_secret_ciphertext', 'failed_attempts'])
      .where('token_hash', '=', hashToken(token))
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .forUpdate()
      .executeTakeFirst();

    return challenge ?? null;
  }

  private async liveStep(trx: Transaction<Database>, accountId: string, lock = false) {
    let query = trx
      .selectFrom('second_steps')
      .select(['id', 'secret_ciphertext', 'last_used_step'])
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null);
    if (lock) {
      query = query.forUpdate();
    }
    return (await query.executeTakeFirst()) ?? null;
  }

  private async liveRoles(trx: Transaction<Database>, accountId: string): Promise<string[]> {
    const rows = await trx
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', accountId)
      .where('revoked_at', 'is', null)
      .execute();
    return rows.map((row) => row.role);
  }

  /** The account, if it may still sign in and still owes the step. */
  private async activeAccount(
    trx: Transaction<Database>,
    accountId: string,
  ): Promise<AccountRecord | null> {
    const account = await this.accounts.findByIdWithin(trx, accountId);
    return account && account.status === 'ACTIVE' && account.owes_second_step ? account : null;
  }

  /** A code is accepted once: it must name a later step than the last one accepted. */
  private async acceptCode(
    trx: Transaction<Database>,
    step: { id: string; secret_ciphertext: string; last_used_step: string | null },
    code: string,
  ): Promise<boolean> {
    const matched = matchingStep(
      decryptSecret(step.secret_ciphertext, this.config.secondStepKey),
      code,
      new Date(),
    );
    if (
      matched === null ||
      (step.last_used_step !== null && matched <= Number(step.last_used_step))
    ) {
      return false;
    }

    await trx
      .updateTable('second_steps')
      .set({ last_used_step: matched })
      .where('id', '=', step.id)
      .execute();
    return true;
  }

  private async redeemRecoveryCode(
    trx: Transaction<Database>,
    stepId: string,
    accountId: string,
    code: string,
  ): Promise<boolean> {
    const redeemed = await trx
      .updateTable('second_step_recovery_codes')
      .set({ used_at: new Date() })
      .where('second_step_id', '=', stepId)
      .where('code_hash', '=', hashRecoveryCode(code, this.config.secondStepKey))
      .where('used_at', 'is', null)
      .returning('id')
      .executeTakeFirst();

    if (!redeemed) {
      return false;
    }

    const left = await trx
      .selectFrom('second_step_recovery_codes')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('second_step_id', '=', stepId)
      .where('used_at', 'is', null)
      .executeTakeFirstOrThrow();

    await this.audit.writeWithin(trx, {
      actorId: accountId,
      action: 'second_step.recovery_code_used',
      targetType: 'account',
      targetId: accountId,
      after: { recovery_codes_left: Number(left.count) },
    });
    return true;
  }

  /** Counts a wrong answer, and voids the sign-in at the fifth. */
  private async recordFailure(
    trx: Transaction<Database>,
    challenge: { id: string; failed_attempts: number },
  ): Promise<UnauthenticatedError> {
    const failed = challenge.failed_attempts + 1;
    const exhausted = failed >= MAX_FAILED_ATTEMPTS;

    await trx
      .updateTable('second_step_challenges')
      .set({ failed_attempts: failed, used_at: exhausted ? new Date() : null })
      .where('id', '=', challenge.id)
      .execute();

    if (exhausted) {
      return signInAgain('Too many wrong codes. Sign in again from the start.');
    }

    const left = MAX_FAILED_ATTEMPTS - failed;
    return new UnauthenticatedError(
      `That code did not work. ${left} ${left === 1 ? 'try' : 'tries'} left, then you sign in again from the start.`,
      { reason: 'CODE_INCORRECT', attempts_left: left },
    );
  }

  private async issue(account: AccountRecord, deviceLabel: string | null): Promise<SessionTokens> {
    await this.accounts.recordLogin(account.id);
    const refresh = await this.tokens.issueRefreshToken(account.id, deviceLabel);

    return {
      access_token: this.tokens.issueAccessToken(account.id, account.person_id),
      refresh_token: refresh.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}

function signInAgain(message = SIGN_IN_AGAIN): UnauthenticatedError {
  return new UnauthenticatedError(message, { reason: 'SIGN_IN_AGAIN' });
}

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}
