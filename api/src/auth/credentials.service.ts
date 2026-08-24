import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { ValidationFailedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';
import { EMAIL_PORT, type EmailPort } from '../email/email.port';

import { PeopleReadService } from '../people/people.read.service';

import { AccountTokensService } from './account-tokens.service';
import { normalizeEmail } from './accounts.repository';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

/** Section 6 gives a reset token "a short expiration (e.g. 30 minutes)". */
const RESET_LIFETIME_MS = 30 * 60 * 1000;

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
   * The miss branch returns after one `SELECT`; the hit branch runs a transaction
   * and attempts a delivery, so the two are distinguishable by a caller who
   * measures. An earlier version of this comment asserted the opposite — that the
   * branches did "comparable work" — which was false of the code beneath it.
   *
   * It is left as it is rather than papered over with a decoy, because a decoy that
   * does not actually match the hit path's cost is a comment claiming a property
   * nobody measured, which is worse than an acknowledged gap. `PasswordService`
   * does the real version of this for sign-in, where the comparison is one hash
   * against one hash and can therefore be made honest. Equalizing here would mean
   * matching a database write and a network call.
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
      const token = await this.db
        .transaction()
        .execute((trx) =>
          this.tokens.mintWithin(trx, account.id, 'PASSWORD_RESET', RESET_LIFETIME_MS),
        );

      // Through `people`, which owns `persons` (section 2).
      const person = await this.people.forDecisionWithin(this.db, account.person_id);

      await this.email.send({
        kind: 'PASSWORD_RESET',
        to: { email: account.email, name: person?.fullName ?? '' },
        token: token.token,
        expiresAt: token.expiresAt,
      });
    } catch (error) {
      this.logger.error(
        `Could not send a password reset for account ${account.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Redeems an activation token and sets the first password. */
  async activate(token: string, password: string): Promise<void> {
    await this.setPassword('ACTIVATION', token, password);
  }

  /** Redeems a reset token and replaces the password. */
  async resetPassword(token: string, password: string): Promise<void> {
    await this.setPassword('PASSWORD_RESET', token, password);
  }

  private async setPassword(
    purpose: 'ACTIVATION' | 'PASSWORD_RESET',
    token: string,
    password: string,
  ): Promise<void> {
    assertPasswordIsAcceptable(password);

    // Hashed outside the transaction. Argon2 is deliberately slow (section 24),
    // and holding a transaction open across it would keep a pooled connection for
    // the duration — the liveness hazard section 24 records the bounded pool as
    // creating.
    const passwordHash = await this.passwords.hash(password);

    await this.db.transaction().execute(async (trx) => {
      const claimed = await this.tokens.redeemWithin(trx, token, purpose);

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
      // `FOR NO KEY UPDATE` on `accounts` first, which is the order every other
      // path takes these two tables in — the revocation below then takes the same
      // row, so no new wait is introduced and no cycle is possible.
      const account = await trx
        .selectFrom('accounts')
        .select('status')
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

      // **Every existing session dies**, and through the one implementation that
      // gets the ordering right. Section 6 requires the marker to be stamped
      // *after* the tokens are revoked, and its timestamp to be read after the
      // statement that waits on the account row — an earlier version of this
      // method inverted both, which on the reset path is the window that matters:
      // somebody resetting a password may be doing it because a session is in
      // hands that are not theirs.
      await this.sessions.revokeAllSessionsWithin(trx, claimed.accountId);

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
export function assertPasswordIsAcceptable(password: string): void {
  const length = [...password].length;

  if (length < PASSWORD_MIN_LENGTH) {
    throw new ValidationFailedError(
      `A password must be at least ${PASSWORD_MIN_LENGTH} characters. There is no requirement to include a digit, a symbol or a capital — length is what matters.`,
      { field: 'password', min_length: PASSWORD_MIN_LENGTH },
    );
  }

  if (length > PASSWORD_MAX_LENGTH) {
    throw new ValidationFailedError(
      `A password may be at most ${PASSWORD_MAX_LENGTH} characters.`,
      { field: 'password', max_length: PASSWORD_MAX_LENGTH },
    );
  }
}
