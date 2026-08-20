import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { UnauthenticatedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

/**
 * An access token lives 15 minutes and a refresh token 30 days (SKILL.md
 * section 6). Neither is configurable: the 15 minutes is what makes the
 * revocation check below cacheable without making "immediately" a lie, and an
 * operator raising it in an environment file would quietly lengthen the window in
 * which a revoked session keeps working.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export interface AccessTokenClaims {
  /** The account. */
  sub: string;
  /** The account's Person. Scope resolves through pastoral position. */
  pid: string;
  iat: number;
  exp: number;
}

export interface IssuedRefreshToken {
  id: string;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class TokensService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  issueAccessToken(accountId: string, personId: string): string {
    return this.jwt.sign(
      { pid: personId },
      { subject: accountId, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      return this.jwt.verify<AccessTokenClaims>(token);
    } catch {
      // Expired, tampered with, or signed by something else: the client is told
      // to sign in again, and never why.
      throw new UnauthenticatedError('Your session has ended. Sign in again.');
    }
  }

  /**
   * Several sessions per account are ordinary use: a leader recording attendance
   * on a phone while reviewing reports on a laptop. Issuing one never evicts
   * another (section 6, Several devices at once).
   */
  async issueRefreshToken(
    accountId: string,
    deviceLabel: string | null,
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const row = await this.db
      .insertInto('refresh_tokens')
      .values({
        account_id: accountId,
        token_hash: hashToken(token),
        device_label: deviceLabel,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id, token, expiresAt };
  }

  async findRefreshToken(token: string): Promise<{
    id: string;
    account_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    replaced_by_id: string | null;
  } | null> {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .select(['id', 'account_id', 'expires_at', 'revoked_at', 'replaced_by_id'])
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();

    return row ?? null;
  }

  async revokeRefreshToken(id: string, replacedById: string | null): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date(), last_used_at: new Date(), replaced_by_id: replacedById })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /**
   * Account-wide revocation. Signing out on one device ends that session only;
   * revocation ends every session on every device, immediately.
   *
   * Both halves are required. Revoking the refresh tokens stops new access tokens
   * being minted; stamping `sessions_revoked_at` is what invalidates the access
   * tokens already out there, which carry no row of their own to revoke.
   */
  async revokeAllSessions(accountId: string): Promise<void> {
    const now = new Date();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute();

      await trx
        .updateTable('accounts')
        .set({ sessions_revoked_at: now })
        .where('id', '=', accountId)
        .execute();
    });
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
