import { Injectable, Logger } from '@nestjs/common';

import { ApiError, ApiErrorCode } from '../common/errors/api-error';

import { AccountsRepository } from './accounts.repository';
import { AuthorizationService, type Actor } from './authorization/authorization.service';
import { PasswordService } from './password.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from './tokens.service';

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accounts: AccountsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly authorization: AuthorizationService,
  ) {}

  async login(email: string, password: string, deviceLabel: string | null): Promise<SessionTokens> {
    const account = await this.accounts.findByEmail(email);
    const correct = await this.passwords.verify(account?.password_hash ?? null, password);

    // One response for every failure: wrong password, no such account, an account
    // awaiting activation, and a disabled one are indistinguishable from outside.
    if (!account || !correct || account.status !== 'ACTIVE') {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Email or password is incorrect.');
    }

    await this.accounts.recordLogin(account.id);
    return this.issue(account.id, account.person_id, deviceLabel);
  }

  /**
   * Refresh tokens rotate on use: the presented token is revoked and a new one
   * issued. A token presented after it has already been **rotated** is a reuse
   * signal -- it means a copy is in circulation -- and the response is to revoke
   * the whole account, on every device, rather than to refuse this one request
   * (SKILL.md section 6).
   *
   * A token revoked by signing out is a different matter and is simply refused.
   * The two are told apart by `replaced_by_id`, which only rotation sets.
   * Without that distinction, an ordinary sign-out followed by a retry from the
   * same device would end every other session the leader holds -- section 6 is
   * explicit that signing out on one device ends that session only.
   */
  async refresh(token: string, deviceLabel: string | null): Promise<SessionTokens> {
    const row = await this.tokens.findRefreshToken(token);

    if (!row) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    if (row.revoked_at !== null) {
      if (row.replaced_by_id !== null) {
        this.logger.warn(
          `Refresh token ${row.id} was presented after rotation; revoking every session for account ${row.account_id}.`,
        );
        await this.tokens.revokeAllSessions(row.account_id);
      }

      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    if (row.expires_at.getTime() <= Date.now()) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    const account = await this.accounts.findById(row.account_id);
    if (!account || account.status !== 'ACTIVE') {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    // Section 6 says revocation invalidates **every** token for the account,
    // immediately. Revoking by row alone does not achieve that: a rotation
    // committing alongside `revokeAllSessions` inserts its replacement after that
    // statement has taken its snapshot, so the replacement is never seen and
    // stays live for thirty days -- minting access tokens whose issued-at
    // post-dates the revocation, which the guard then admits.
    //
    // The marker closes it, as it does for access tokens, and both sides of this
    // comparison are stamped by the application so that it spans one clock. A
    // token issued before the account was revoked is dead whatever its own row
    // says; one issued after is a new sign-in and is untouched.
    if (account.sessions_revoked_at && row.issued_at <= account.sessions_revoked_at) {
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    // The check above is the cheap early refusal and reads committed state only.
    // The authoritative one is inside the rotation, under a row lock on the
    // account, where a revocation still in flight cannot be missed.
    const issued = await this.tokens.rotateRefreshToken(
      row.id,
      account.id,
      deviceLabel,
      row.issued_at,
    );

    if (!issued) {
      // Something claimed the token between the read above and here: another
      // refresh in flight at the same instant, or a sign-out a moment earlier.
      // Neither is a replay.
      //
      // Section 6 defines the reuse signal as a token presented **after** use,
      // and that case is handled above, where the token already reads as
      // revoked. A simultaneous presentation is what an ordinary mobile client
      // does when two requests hit 401 together, and revoking the account for it
      // would sign a leader out of every device for behaving normally. This one
      // request is refused; the winner's session is untouched.
      //
      // The cost is accepted deliberately: an attacker racing a stolen token
      // within the same instant is not caught here. They are caught on the next
      // presentation, which is the case the specification actually describes.
      this.logger.debug(
        `Refresh token ${row.id} was claimed concurrently; refusing this request only.`,
      );
      throw new ApiError(ApiErrorCode.UNAUTHENTICATED, 'Your session has ended. Sign in again.');
    }

    return {
      access_token: this.tokens.issueAccessToken(account.id, account.person_id),
      refresh_token: issued.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Signing out on one device ends that session only (section 6). */
  async logout(actor: Actor, token: string): Promise<void> {
    const row = await this.tokens.findRefreshToken(token);

    // Signing out is idempotent, and never discloses whether the token existed or
    // whose it was. A token belonging to another account is simply not revoked.
    if (row && row.account_id === actor.accountId) {
      await this.tokens.revokeRefreshToken(row.id);
    }
  }

  /** Revocation is account-wide and immediate, on every device (section 6). */
  async logoutEverywhere(actor: Actor): Promise<void> {
    await this.tokens.revokeAllSessions(actor.accountId);
  }

  /**
   * What the caller's own session carries. Clients use it to decide what to
   * render; it is never what decides what they may do, because the API is the
   * sole authority for authorization (section 1, principle 4).
   */
  async describe(actor: Actor): Promise<Record<string, unknown>> {
    const account = await this.accounts.findById(actor.accountId);
    const grants = await this.authorization.grantsFor(actor.accountId);

    return {
      account_id: actor.accountId,
      person_id: actor.personId,
      email: account?.email ?? null,
      capabilities: grants.map((grant) => ({
        capability: grant.capability,
        scope_type: grant.scope.type,
        scope_network: grant.scope.network,
        read_only: grant.readOnly,
        source: grant.source,
      })),
    };
  }

  private async issue(
    accountId: string,
    personId: string,
    deviceLabel: string | null,
  ): Promise<SessionTokens> {
    const refresh = await this.tokens.issueRefreshToken(accountId, deviceLabel);

    return {
      access_token: this.tokens.issueAccessToken(accountId, personId),
      refresh_token: refresh.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
