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

/**
 * Why a rotation did not produce a token, when it did not.
 *
 * The two refusals are different facts and an operator reading a log during an
 * incident needs to know which happened: `claimed` is another request winning the
 * same instant and nothing else follows, while `revoked` means the account was
 * revoked under the lock and the session is gone.
 */
export type RotationOutcome =
  | { outcome: 'rotated'; issued: IssuedRefreshToken }
  | { outcome: 'claimed' }
  | { outcome: 'revoked' };

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
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const row = await this.db
      .insertInto('refresh_tokens')
      .values({
        account_id: accountId,
        token_hash: hashToken(token),
        device_label: deviceLabel,
        // Written explicitly rather than left to the column default. `issued_at`
        // is compared against `accounts.sessions_revoked_at`, which the
        // application stamps, and against a JWT's `iat`, which it also stamps.
        // Leaving this one to the database's clock made that comparison span two
        // clocks, so a token could sit on the wrong side of a revocation by
        // whatever the two disagreed by.
        issued_at: issuedAt,
        expires_at: expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id, token, expiresAt };
  }

  async findRefreshToken(token: string): Promise<{
    id: string;
    account_id: string;
    issued_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    replaced_by_id: string | null;
  } | null> {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .select(['id', 'account_id', 'issued_at', 'expires_at', 'revoked_at', 'replaced_by_id'])
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst();

    return row ?? null;
  }

  /**
   * Revokes a token, and reports whether this call is the one that did it.
   *
   * Sign-out only. It never sets `replaced_by_id`, which is what keeps the two
   * facts distinguishable: a token carrying a replacement was rotated, and one
   * without was signed out.
   *
   * The `revoked_at is null` clause is load-bearing twice over. It stops a
   * sign-out touching a token that was already rotated, which would blur that
   * distinction; and it makes the claim exclusive, so exactly one of two racing
   * callers gets a row back.
   */
  async revokeRefreshToken(id: string): Promise<boolean> {
    const now = new Date();
    const revoked = await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: now, last_used_at: now })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .returning('id')
      .executeTakeFirst();

    return revoked !== undefined;
  }

  /**
   * Rotation, as one transaction: claim the presented token, then issue its
   * replacement.
   *
   * The order matters and so does the claim. Issuing first and revoking second --
   * two statements, the row count discarded -- let two requests presenting the
   * same token concurrently both read it live, both mint a replacement, and only
   * one revoke land. Two live chains from one presentation, and the reuse signal
   * section 6 requires never raised for the loser. That is the exact window
   * rotation exists to close.
   *
   * Returns null where the token was already claimed, which the caller treats as
   * the reuse case.
   */
  async rotateRefreshToken(
    id: string,
    accountId: string,
    deviceLabel: string | null,
    presentedIssuedAt: Date,
  ): Promise<RotationOutcome> {
    return this.db.transaction().execute(async (trx) => {
      // Take the account row first, and lock it.
      //
      // Checking the revocation marker before opening this transaction is not
      // enough, and the reason is worth stating: that read sees committed state
      // only, so a revocation that has stamped the marker but not yet committed
      // reads as absent. A token that escaped the revoking UPDATE could then be
      // rotated in that window into a replacement issued *after* the marker,
      // which every later check would accept. Thirty days of a session that was
      // revoked.
      //
      // The lock orders this rotation against the revocation in the database
      // rather than in the application: if a revocation is in flight, this waits
      // for it and then sees its marker. Nothing about the two clocks matters
      // for the ordering, only for the comparison.
      const account = await trx
        .selectFrom('accounts')
        .select(['sessions_revoked_at'])
        .where('id', '=', accountId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      if (!account) {
        return { outcome: 'revoked' };
      }

      if (account.sessions_revoked_at && presentedIssuedAt <= account.sessions_revoked_at) {
        return { outcome: 'revoked' };
      }

      const now = new Date();
      const claimed = await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now, last_used_at: now })
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .returning('id')
        .executeTakeFirst();

      if (!claimed) {
        return { outcome: 'claimed' };
      }

      const token = randomBytes(32).toString('base64url');
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      const issued = await trx
        .insertInto('refresh_tokens')
        .values({
          account_id: accountId,
          token_hash: hashToken(token),
          device_label: deviceLabel,
          issued_at: issuedAt,
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('refresh_tokens')
        .set({ replaced_by_id: issued.id })
        .where('id', '=', id)
        .execute();

      return { outcome: 'rotated', issued: { id: issued.id, token, expiresAt } };
    });
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
    await this.db.transaction().execute(async (trx) => {
      // The account row first, and for the same reason rotation takes it first:
      // so that both paths take these two locks in the same order.
      //
      // Taking `refresh_tokens` first inverted it. A rotation holding the account
      // row and about to claim its token, against a revocation holding that token
      // and about to stamp the marker, is a cycle -- and PostgreSQL aborts the
      // side that began waiting first, which is normally this one. The revocation
      // then does not happen at all: `logout-all` answers 500 and every session
      // stays live, at exactly the moment somebody is trying to end them.
      await trx
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', accountId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date() })
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute();

      // Stamped *after* the revocation, deliberately. A rotation running
      // alongside this inserts its replacement while that statement waits on the
      // row lock, so the replacement is never revoked by it -- and a marker read
      // before the statement would sort *earlier* than that replacement's
      // issued_at, leaving it alive. Read afterwards, the marker dominates
      // anything that escaped, and `refresh` refuses it.
      //
      // The cost is that a sign-in racing a revocation is also killed. That is
      // the right direction: section 6 says revocation invalidates every session
      // immediately, and a session begun in that instant is one of them.
      // Read here rather than earlier: a timestamp computed before a statement
      // that then waits on a lock carries a pre-wait reading, which is how the
      // marker came to sort before tokens it was meant to kill.
      const revokedAt = new Date();

      await trx
        .updateTable('accounts')
        .set({ sessions_revoked_at: revokedAt })
        .where('id', '=', accountId)
        .execute();
    });
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
