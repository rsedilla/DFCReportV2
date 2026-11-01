import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import {
  InvariantViolationError,
  NotFoundError,
  ResourceBusyError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../database/database.module';
import { EMAIL_PORT, type EmailPort, type OutboundEmail } from '../email/email.port';

import { PeopleReadService } from '../people/people.read.service';

import { AccountTokensService } from './account-tokens.service';
import {
  AccountsRepository,
  normalizeEmail,
  sessionPredatesSecondStep,
} from './accounts.repository';
import { PasswordService } from './password.service';
import { SignInPauseService } from './sign-in-pause.service';
import { TokensService, hashToken } from './tokens.service';
import { UsernamesService, assertUsernameShape } from './usernames.service';

import type { Actor } from './authorization/authorization.service';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';

/** Section 6 gives a reset token "a short expiration (e.g. 30 minutes)". */
const RESET_LIFETIME_MS = 30 * 60 * 1000;

/** A link confirming a new email address lasts a day (decision 0415). */
const EMAIL_CHANGE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Setting a password: the first one, and every one after (SKILL.md section 6).
 *
 * Activation and reset are one service because they differ in exactly two ways —
 * which token purpose they redeem, and whether the account was `PENDING_ACTIVATION`
 * — and are identical in everything section 6 actually constrains: the token is
 * single-use, the password is the holder's own, and every existing session dies.
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Db,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    private readonly tokens: AccountTokensService,
    private readonly people: PeopleReadService,
    private readonly sessions: TokensService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly usernames: UsernamesService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: AccountsRepository,
    private readonly pauses: SignInPauseService,
  ) {}

  /**
   * Begins a reset, and answers the same way whether or not the address exists.
   *
   * **The response is identical, which is what section 6 requires**, and a
   * delivery failure is caught and logged rather than raised for the same reason:
   * an error on the hit path and a success on the miss path is the same oracle
   * wearing a different hat.
   *
   * **The timing is not equalized, and that is a known gap rather than a claim.**
   * The miss branch returns after one `SELECT`; the hit branch runs a transaction,
   * so the two are distinguishable by a caller who measures. An earlier version of
   * this comment asserted the opposite — that the branches did "comparable work" —
   * which was false of the code beneath it.
   *
   * **Delivery is not awaited**, which keeps the gap at the scale of one database
   * write. A real provider takes around a second to accept a message, and awaiting it
   * would make the hit path slower by that much. `PasswordService` does the honest
   * version of equalizing for sign-in, where the comparison is one hash against one.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const account = await this.db
      .selectFrom('accounts')
      .select(['id', 'person_id', 'email', 'status'])
      .where('email_normalized', '=', normalizeEmail(email))
      .executeTakeFirst();

    // A disabled account is not reset into life: section 6 makes reactivation "a
    // separate, explicit, authorized decision". Silent, because saying so here
    // would disclose that the address exists.
    if (!account || account.status === 'DISABLED') {
      return;
    }

    try {
      const minted = await this.db.transaction().execute(async (trx) => {
        const token = await this.tokens.mintWithin(
          trx,
          account.id,
          'PASSWORD_RESET',
          RESET_LIFETIME_MS,
        );

        // **Read again under the account lock, after the mint** (decision 0415): the
        // address may have changed, or the account been started over, since the read
        // above. Changing it locks the row `FOR UPDATE`, which waits for this one, so
        // either it committed first and is seen here, or it comes after and supersedes
        // this link. A link is never minted for an address the account no longer has.
        const locked = await trx
          .selectFrom('accounts')
          .select(['email', 'email_normalized', 'status'])
          .where('id', '=', account.id)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();

        if (locked.status === 'DISABLED' || locked.email_normalized !== normalizeEmail(email)) {
          throw new NoLongerAddressed();
        }

        return { token, email: locked.email };
      });

      // Through `people`, which owns `persons` (section 2).
      const person = await this.people.forDecision(account.person_id);

      this.email
        .send({
          kind: 'PASSWORD_RESET',
          to: { email: minted.email, name: person?.fullName ?? '' },
          token: minted.token.token,
          expiresAt: minted.token.expiresAt,
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Could not send a password reset for account ${account.id}.`,
            error instanceof Error ? error.stack : undefined,
          );
        });
    } catch (error) {
      // Rolled back, the address having moved: silent, as for an unknown address.
      if (error instanceof NoLongerAddressed) {
        return;
      }
      this.logger.error(
        `Could not send a password reset for account ${account.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * An administrator sends a reset link to an account in use, for its holder at the
   * account's own address (section 6, decision 0393).
   *
   * **The administrator learns nothing they could sign in with.** The token goes only to the
   * address already on the account and never into a response, so the holder still chooses
   * their own password. Only an `ACTIVE` account: one awaiting activation is sent its
   * activation email again, and a disabled one is re-enabled first, which section 6 makes a
   * separate decision rather than something a reset link reopens.
   *
   * **Tokens first, then the account row**, the order setting a password, disabling and
   * correcting an address take the two tables in, so none of them deadlocks with this. The
   * account is read unlocked only to answer `NOT_FOUND`; its status is decided under the lock,
   * and a refusal rolls the token back.
   *
   * Two sends at once both reach the mint before either locks the account; the second waits
   * for the first and then meets the one-outstanding-token index. That is answered
   * `RESOURCE_BUSY`, which releases the claim, so a retry sends again.
   *
   * Delivery is logged, not raised, after the commit, for the reason the activation re-send
   * gives: raising would contradict the completion the store already holds.
   */
  async sendResetByAdministrator(
    accountId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<void> {
    let outcome: OutboundEmail;
    try {
      outcome = await this.db.transaction().execute(async (trx) => {
        const exists = await trx
          .selectFrom('accounts')
          .select('id')
          .where('id', '=', accountId)
          .executeTakeFirst();

        if (!exists) {
          throw new NotFoundError('No such account.');
        }

        const token = await this.tokens.mintWithin(
          trx,
          accountId,
          'PASSWORD_RESET',
          RESET_LIFETIME_MS,
        );

        const account = await trx
          .selectFrom('accounts')
          .select(['id', 'person_id', 'email', 'status'])
          .where('id', '=', accountId)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();

        if (account.status !== 'ACTIVE') {
          throw new InvariantViolationError(
            account.status === 'PENDING_ACTIVATION'
              ? 'This account has not been activated yet. Send its activation email again instead.'
              : 'This account is disabled. Re-enable it before sending a password reset.',
            { account_id: accountId, status: account.status },
          );
        }

        const person = await this.people.forDecisionWithin(trx, account.person_id);

        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'account.password_reset_sent',
          targetType: 'account',
          targetId: accountId,
        });

        // Last statement (CLAUDE.md, Write endpoints).
        await this.idempotency.completeWithin(trx, { ...claim, status: 204, body: null });

        return {
          kind: 'PASSWORD_RESET' as const,
          to: { email: account.email, name: person?.fullName ?? '' },
          token: token.token,
          expiresAt: token.expiresAt,
        };
      });
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        violatedConstraint(error) === 'account_tokens_one_outstanding'
      ) {
        throw new ResourceBusyError({ account_id: accountId });
      }
      throw error;
    }

    try {
      await this.email.send(outcome);
    } catch (error) {
      this.logger.error(
        `Could not send a password reset for account ${accountId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Redeems an activation token and sets the first password, and the username where one is
   * sent (decision 0337). A name another account holds refuses the whole activation, so the
   * token is not spent on a request that changed nothing.
   */
  async activate(token: string, password: string, username?: string): Promise<void> {
    const name = username === undefined ? null : assertUsernameShape(username);
    await this.setPassword('ACTIVATION', token, password, name);
  }

  /**
   * Redeems a reset token and replaces the password, and answers with a proof the browser
   * keeps: for fifteen minutes it signs that browser in through a pause (decision 0413).
   * Only its hash is stored.
   */
  async resetPassword(token: string, password: string): Promise<{ sign_in_proof: string }> {
    const proof = randomBytes(32).toString('base64url');
    await this.setPassword('PASSWORD_RESET', token, password, null, hashToken(proof));
    return { sign_in_proof: proof };
  }

  /**
   * The holder changes their own password while signed in (section 6, decision 0351).
   *
   * The current password is asked first, so an unlocked device is not enough to lock
   * its owner out. Every other session ends at once; the session whose refresh token is
   * presented is carried across, so this device stays signed in. A refresh token that is
   * not this account's live one keeps nothing, and every session ends.
   */
  async changePassword(
    actor: Actor,
    currentPassword: string,
    newPassword: string,
    refreshToken: string,
    claim: CurrentClaim,
  ): Promise<void> {
    assertPasswordIsAcceptable(newPassword, 'new_password');

    const account = await this.db
      .selectFrom('accounts')
      .select(['id', 'person_id', 'email', 'password_hash'])
      .where('id', '=', actor.accountId)
      .executeTakeFirstOrThrow();

    // Both hashes outside the transaction, for the reason `setPassword` gives.
    if (!(await this.passwords.verify(account.password_hash, currentPassword))) {
      throw wrongCurrentPassword();
    }
    const passwordHash = await this.passwords.hash(newPassword);
    const changedAt = new Date();

    await this.db.transaction().execute(async (trx) => {
      // A pending email change ends with the password (decision 0415): it may be what an
      // attacker asked for before the holder took the account back. Tokens before the
      // account row, the order every path takes the two tables in.
      await this.tokens.supersedeWithin(trx, account.id, 'EMAIL_CHANGE');

      const locked = await trx
        .selectFrom('accounts')
        .select('password_hash')
        .where('id', '=', account.id)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();

      // Changed by another request since it was checked: the password typed is no
      // longer the current one, so the same body sent again is refused the same way.
      if (locked.password_hash !== account.password_hash) {
        throw wrongCurrentPassword();
      }

      await trx
        .updateTable('accounts')
        .set({ password_hash: passwordHash, updated_at: changedAt })
        .where('id', '=', account.id)
        .execute();

      const presented = await trx
        .selectFrom('refresh_tokens')
        .select(['id', 'issued_at'])
        .where('token_hash', '=', hashToken(refreshToken))
        .where('account_id', '=', account.id)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', changedAt)
        .executeTakeFirst();

      // Only a session a refresh would still renew is kept: one an earlier revocation
      // already ended, or one from before the second step the account owes, is not
      // brought back by being dated past this change (decision 0302). Read under the
      // account lock taken above, so no revocation lands between this and the change.
      const record = await this.accounts.findByIdWithin(trx, account.id);
      const kept =
        presented !== undefined &&
        record !== null &&
        !(record.sessions_revoked_at && presented.issued_at <= record.sessions_revoked_at) &&
        !sessionPredatesSecondStep(record, presented.issued_at)
          ? presented.id
          : null;

      await this.sessions.revokeAllSessionsWithin(trx, account.id, kept);

      await this.audit.writeWithin(trx, {
        actorId: account.id,
        action: 'password.changed',
        targetType: 'account',
        targetId: account.id,
      });

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 204, body: null });
    });

    // After the commit, and nothing here may fail the request: the completion is already
    // recorded, so a failure would answer an error while every retry replays the success
    // (CLAUDE.md, Write endpoints). The change stands whether or not the notice goes out.
    void this.sendPasswordChanged(account, changedAt);
  }

  /**
   * The holder asks to change their own address (section 6, decision 0415): the current
   * password is asked, and a link goes to the new address. Nothing on the account changes
   * until that link is confirmed, so a typing mistake locks nobody out.
   *
   * **An address another account holds is not refused here.** Refusing it would tell any
   * signed-in person whether an address has an account; the confirmation refuses it
   * instead, where only whoever reads that mailbox learns it.
   */
  async requestEmailChange(
    actor: Actor,
    newEmail: string,
    currentPassword: string,
    claim: CurrentClaim,
  ): Promise<void> {
    const account = await this.db
      .selectFrom('accounts')
      .select(['id', 'person_id', 'email_normalized', 'password_hash'])
      .where('id', '=', actor.accountId)
      .executeTakeFirstOrThrow();

    // Outside the transaction, for the reason `setPassword` gives.
    if (!(await this.passwords.verify(account.password_hash, currentPassword))) {
      throw wrongCurrentPassword();
    }

    const email = newEmail.trim();
    const normalized = normalizeEmail(email);

    if (normalized === account.email_normalized) {
      throw new InvariantViolationError('That is already your email address.', {
        field: 'new_email',
      });
    }

    let token: { token: string; expiresAt: Date };
    try {
      token = await this.mintEmailChange(account, email, normalized, claim);
    } catch (error) {
      // Two requests minting at once: the index allowing one outstanding link refuses the
      // second, which has decided nothing and is retried, as for a reset sent twice.
      if (
        isUniqueViolation(error) &&
        violatedConstraint(error) === 'account_tokens_one_outstanding'
      ) {
        throw new ResourceBusyError({ account_id: account.id });
      }
      throw error;
    }

    // After the commit and never fatal: asking again sends another link.
    void this.sendOrLog(
      account.person_id,
      (name) => ({
        kind: 'EMAIL_CHANGE',
        to: { email, name },
        token: token.token,
        expiresAt: token.expiresAt,
      }),
      `Could not send the email-change link for account ${account.id}.`,
    );
  }

  /** The transaction of {@link requestEmailChange}: the link minted, and the completion. */
  private async mintEmailChange(
    account: { id: string; password_hash: string | null },
    email: string,
    normalized: string,
    claim: CurrentClaim,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.db.transaction().execute(async (trx) => {
      // Tokens before the account row, the order every path takes the two tables in.
      const minted = await this.tokens.mintWithin(
        trx,
        account.id,
        'EMAIL_CHANGE',
        EMAIL_CHANGE_LIFETIME_MS,
        { email, normalized },
      );

      const locked = await trx
        .selectFrom('accounts')
        .select(['status', 'password_hash'])
        .where('id', '=', account.id)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();

      // Changed by another request since it was checked, as `changePassword` refuses.
      if (locked.password_hash !== account.password_hash || locked.status !== 'ACTIVE') {
        throw wrongCurrentPassword();
      }

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 204, body: null });

      return minted;
    });
  }

  /**
   * Confirms a new address from the link sent to it (section 6, decision 0415). The link
   * is the credential, so this is unauthenticated, as a reset is.
   *
   * Every outstanding token is superseded, so a reset link already mailed to the old
   * address stops working. The sessions are kept: the holder made this change. The old
   * address is told.
   */
  async confirmEmailChange(token: string): Promise<{ email: string }> {
    const changedAt = new Date();

    const outcome = await this.db.transaction().execute(async (trx) => {
      const claimed = await this.tokens.redeemEmailChangeWithin(trx, token);

      if (!claimed) {
        throw invalidLink();
      }

      await this.tokens.supersedeAllWithin(trx, claimed.accountId);

      // `FOR UPDATE`, not `FOR NO KEY UPDATE`: only the stronger lock waits for the key lock
      // a token insert holds on this row, which the second pass below depends on.
      const account = await trx
        .selectFrom('accounts')
        .select(['id', 'person_id', 'email', 'status'])
        .where('id', '=', claimed.accountId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // A disabled account is answered as an unknown link, for the reason `setPassword`
      // gives. No other status reaches here: an administrator starting the account over
      // supersedes this link.
      if (account.status !== 'ACTIVE') {
        throw invalidLink();
      }

      // Again under the account lock: a reset link whose insert had not committed when the
      // first pass ran is invisible to it, and holds a key lock on this row until it does,
      // which the `FOR UPDATE` above waited for, so it is committed by now. A reset requested
      // after this commits reads the new address under its own lock and mints nothing for
      // the old one. A deadlock with a link being redeemed answers `RESOURCE_BUSY`.
      await this.tokens.supersedeAllWithin(trx, account.id);

      const taken = await trx
        .selectFrom('accounts')
        .select('id')
        .where('email_normalized', '=', claimed.normalized)
        .where('id', '<>', account.id)
        .executeTakeFirst();

      if (taken) {
        throw addressTaken();
      }

      try {
        await trx
          .updateTable('accounts')
          .set({
            email: claimed.email,
            email_normalized: claimed.normalized,
            updated_at: changedAt,
          })
          .where('id', '=', account.id)
          .execute();
      } catch (error) {
        // Taken by a commit after the check above: the same answer.
        if (isUniqueViolation(error)) {
          throw addressTaken();
        }
        throw error;
      }

      await this.audit.writeWithin(trx, {
        actorId: account.id,
        action: 'account.email_changed',
        targetType: 'account',
        targetId: account.id,
        before: { email: account.email },
        after: { email: claimed.email },
      });

      return { account, email: claimed.email };
    });

    void this.sendOrLog(
      outcome.account.person_id,
      (name) => ({
        kind: 'EMAIL_CHANGED',
        to: { email: outcome.account.email, name },
        changedAt,
        byAdministrator: false,
      }),
      `Could not tell the old address of account ${outcome.account.id} that it was changed.`,
    );

    return { email: outcome.email };
  }

  /** Sends to a Person, and turns a failure into a log line. */
  private async sendOrLog(
    personId: string,
    compose: (name: string) => OutboundEmail,
    failure: string,
  ): Promise<void> {
    try {
      const person = await this.people.forDecision(personId);
      await this.email.send(compose(person?.fullName ?? ''));
    } catch (error) {
      this.logger.error(failure, error instanceof Error ? error.stack : undefined);
    }
  }

  private async sendPasswordChanged(
    account: { id: string; person_id: string; email: string },
    changedAt: Date,
  ): Promise<void> {
    try {
      const person = await this.people.forDecision(account.person_id);
      await this.email.send({
        kind: 'PASSWORD_CHANGED',
        to: { email: account.email, name: person?.fullName ?? '' },
        changedAt,
      });
    } catch (error) {
      this.logger.error(
        `Could not send a password-changed notice for account ${account.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async setPassword(
    purpose: 'ACTIVATION' | 'PASSWORD_RESET',
    token: string,
    password: string,
    username: string | null = null,
    proofHash: string | null = null,
  ): Promise<void> {
    assertPasswordIsAcceptable(password);

    // Hashed outside the transaction. Argon2 is deliberately slow (section 24),
    // and holding a transaction open across it would keep a pooled connection for
    // the duration — the liveness hazard section 24 records the bounded pool as
    // creating.
    const passwordHash = await this.passwords.hash(password);

    await this.db.transaction().execute(async (trx) => {
      const claimed = await this.tokens.redeemWithin(trx, token, purpose);

      // Every other outstanding link ends with the new password, an email change above all
      // (decision 0415): an attacker's pending change would otherwise outlive the reset that
      // took the account back, and move where the next reset goes.
      if (claimed) {
        await this.tokens.supersedeAllWithin(trx, claimed.accountId);
      }

      if (!claimed) {
        // One answer for expired, already used, and never issued. Distinguishing
        // them tells an attacker holding a stolen link which of those it is, and
        // tells a legitimate holder nothing they can act on differently: in every
        // case the remedy is to ask for another.
        throw new ValidationFailedError('That link is no longer valid. Ask for a new one.', {
          field: 'token',
        });
      }

      // **A disabled account is not reactivated by setting a password.** Section 6
      // makes reactivation "a separate, explicit, authorized decision", and both
      // token purposes can outlive a disablement — a reset token by thirty
      // minutes, an activation token by a week. Without this, an unauthenticated
      // endpoint undoes an `accounts.manage` decision.
      //
      // **Locked, not merely read inside the transaction.** Under `READ COMMITTED`
      // (section 24) a bare read takes no lock and sees committed state at
      // statement start, so a disablement committing between here and the update
      // below would be silently overwritten and the account would come back
      // `ACTIVE` with the token-holder's password. An earlier version of this
      // comment claimed the read alone gave "the state this write will actually
      // overwrite", which is the lock-then-decide omission section 5 exists to
      // prevent, asserted rather than implemented.
      //
      // `FOR NO KEY UPDATE` on `accounts` after the token row `redeemWithin` claimed above:
      // tokens first, then the account, the order every other path takes these two tables
      // in. The revocation below then takes the same row, so no new wait is introduced.
      const account = await trx
        .selectFrom('accounts')
        .select(['status', 'email', 'username'])
        .where('id', '=', claimed.accountId)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();

      if (account.status === 'DISABLED') {
        // The same answer as an unknown token, deliberately: distinguishing them
        // tells whoever holds the link that the account exists and has been
        // disabled, which is not theirs to learn from an unauthenticated route.
        throw new ValidationFailedError('That link is no longer valid. Ask for a new one.', {
          field: 'token',
        });
      }

      await trx
        .updateTable('accounts')
        .set({
          password_hash: passwordHash,
          status: 'ACTIVE',
          updated_at: new Date(),
        })
        .where('id', '=', claimed.accountId)
        .execute();

      if (username !== null) {
        await this.usernames.setWithin(trx, claimed.accountId, username);
      }

      // **Every existing session dies**, and through the one implementation that
      // gets the ordering right. Section 6 requires the marker to be stamped
      // *after* the tokens are revoked, and its timestamp to be read after the
      // statement that waits on the account row — an earlier version of this
      // method inverted both, which on the reset path is the window that matters:
      // somebody resetting a password may be doing it because a session is in
      // hands that are not theirs.
      await this.sessions.revokeAllSessionsWithin(trx, claimed.accountId);

      // A completed reset ends a pause on the account's address and username (decision
      // 0413): it is the way in the pause's own message points to.
      if (purpose === 'PASSWORD_RESET' && proofHash !== null) {
        await this.pauses.resetForWithin(trx, account, proofHash);
      }

      await this.audit.writeWithin(trx, {
        actorId: claimed.accountId,
        action: purpose === 'ACTIVATION' ? 'account.activated' : 'password.reset',
        targetType: 'account',
        targetId: claimed.accountId,
        after: { status: 'ACTIVE' },
      });
    });
  }
}

/** Section 6, What a password must be. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Refuses a password section 6 does not accept.
 *
 * Length only, and no composition rule: section 23's criterion 3.3.8 permits a
 * password because password managers assist in completing it, and a rule forcing a
 * symbol pushes people toward something short enough to retype from memory —
 * against the very mechanism conformance rests on.
 *
 * **The length is counted in code points, not UTF-16 units.** `String.length`
 * counts a single emoji or an astral character as two, so a twelve-character
 * passphrase containing one would be accepted while a plainer twelve-character one
 * of the same visible length is refused, which is arbitrary from the holder's side.
 * The maximum is counted the same way, and the password is never truncated to fit.
 */
export function assertPasswordIsAcceptable(password: string, field = 'password'): void {
  const length = [...password].length;

  if (length < PASSWORD_MIN_LENGTH) {
    throw new ValidationFailedError(
      `A password must be at least ${PASSWORD_MIN_LENGTH} characters. There is no requirement to include a digit, a symbol or a capital — length is what matters.`,
      { field, min_length: PASSWORD_MIN_LENGTH },
    );
  }

  if (length > PASSWORD_MAX_LENGTH) {
    throw new ValidationFailedError(
      `A password may be at most ${PASSWORD_MAX_LENGTH} characters.`,
      { field, max_length: PASSWORD_MAX_LENGTH },
    );
  }
}

/** A reset rolled back because the account no longer has the address it was asked for. */
class NoLongerAddressed extends Error {}

function invalidLink(): ValidationFailedError {
  return new ValidationFailedError('That link is no longer valid. Ask for a new one.', {
    field: 'token',
  });
}

function addressTaken(): InvariantViolationError {
  return new InvariantViolationError(
    'That email address already has an account, so it cannot be used for yours.',
    { field: 'email' },
  );
}

function wrongCurrentPassword(): ValidationFailedError {
  return new ValidationFailedError('That is not your current password.', {
    field: 'current_password',
  });
}
