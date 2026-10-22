import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { hashToken } from './tokens.service';

import type { AccountTokenPurpose, Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * Activation and password-reset tokens (SKILL.md section 6, Password reset
 * security).
 *
 * One service for both purposes because section 6 states one set of rules for
 * them: cryptographically secure, single-use, stored only as a hash, short-lived,
 * and issuing a new one of a purpose invalidates any outstanding one of that
 * purpose for the account. Two implementations of that would be two chances to
 * omit a rule.
 */
@Injectable()
export class AccountTokensService {
  /**
   * No database handle: **every method here takes the caller's transaction.**
   *
   * Minting belongs inside the write that created the account, and redeeming
   * belongs inside the write that sets the password — a pooled connection here
   * would let either half-happen, which is exactly what section 6's single-use
   * guarantee cannot tolerate. Taking no `Db` at all makes that a compile error
   * rather than a convention, the way `completeWithin`'s transaction parameter
   * does for the idempotency store.
   */

  /**
   * Marks every outstanding token of the account used, whatever its purpose (decision
   * 0300): a link mailed to an address the account no longer has must not set its password.
   */
  async supersedeAllWithin(trx: Transaction<Database>, accountId: string): Promise<void> {
    await trx
      .updateTable('account_tokens')
      .set({ used_at: new Date() })
      .where('account_id', '=', accountId)
      .where('used_at', 'is', null)
      .execute();
  }

  /**
   * Mints a token, invalidating any outstanding one of the same purpose.
   *
   * Returns the plaintext **once**, to its caller. It is never stored and never in
   * an API response: section 6 says an administrator may not know or choose
   * another user's password, and a token that sets one is the same secret a step
   * earlier.
   *
   * **One caller prints it, and section 6 names that one.** The first Admin
   * bootstrap has no Admin to re-send from and refuses to run twice, so a lost
   * token would leave the installation unrecoverable — and its operator is the
   * holder, standing at the machine. Every other caller passes it to the email
   * port and nowhere else. This paragraph replaces "never logged", which was left
   * standing one frame from a caller that logs it.
   *
   * **The invalidation and the insert are one statement each inside the caller's
   * transaction**, so a mint that fails leaves neither a live old token nor a new
   * one. Section 6's "issuing a new token of a purpose invalidates any outstanding
   * one" is otherwise two writes that can half-happen.
   */
  async mintWithin(
    trx: Transaction<Database>,
    accountId: string,
    purpose: AccountTokenPurpose,
    lifetimeMs: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    // 32 bytes from the CSPRNG, base64url so it survives a URL without escaping.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + lifetimeMs);

    // Marked used rather than deleted: section 5's no-deletion rule exempts these
    // tables for pruning only, and a redeemed-or-superseded row is what makes a
    // replay answer "already used" rather than "unknown" (section 6, Retention).
    await trx
      .updateTable('account_tokens')
      .set({ used_at: new Date() })
      .where('account_id', '=', accountId)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .execute();

    await trx
      .insertInto('account_tokens')
      .values({
        account_id: accountId,
        purpose,
        token_hash: hashToken(token),
        expires_at: expiresAt,
      })
      .execute();

    return { token, expiresAt };
  }

  /**
   * Redeems a token, or reports why it cannot be.
   *
   * **Claimed conditionally in one statement**, the way refresh-token rotation is
   * (section 6): a read followed by a write lets two requests presenting one token
   * both pass the read. The `used_at IS NULL` predicate is what makes single-use
   * real rather than intended.
   *
   * Expiry is checked in the same predicate rather than afterwards, so an expired
   * token is never redeemed and then rejected.
   */
  async redeemWithin(
    trx: Transaction<Database>,
    token: string,
    purpose: AccountTokenPurpose,
  ): Promise<{ accountId: string } | null> {
    const claimed = await trx
      .updateTable('account_tokens')
      .set({ used_at: new Date() })
      .where('token_hash', '=', hashToken(token))
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .returning(['account_id'])
      .executeTakeFirst();

    return claimed ? { accountId: claimed.account_id } : null;
  }

  /**
   * The account a token would redeem for, without redeeming it, or null where it is
   * expired, used or never issued: what activation's username suggestion reads before the
   * holder has chosen a password (decision 0337). The same predicate as {@link redeemWithin}.
   * A read, in the caller's transaction like every other method here.
   */
  async accountForLiveTokenWithin(
    trx: Transaction<Database>,
    token: string,
    purpose: AccountTokenPurpose,
  ): Promise<string | null> {
    const row = await trx
      .selectFrom('account_tokens')
      .select('account_id')
      .where('token_hash', '=', hashToken(token))
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    return row?.account_id ?? null;
  }
}
