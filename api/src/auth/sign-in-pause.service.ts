import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { DATABASE, type Db } from '../database/database.module';

import { normalizeEmail } from './accounts.repository';

import type { Database } from '../database/schema';

/** Section 6: ten wrong passwords within fifteen minutes pause sign-in for fifteen. */
export const SIGN_IN_PAUSE_AFTER = 10;
const WINDOW = sql`interval '15 minutes'`;
const PAUSE = sql`interval '15 minutes'`;
/** How long an untouched row is kept; it holds what strangers typed, so not for long. */
const KEEP = sql`interval '1 day'`;
/** The Admin is emailed about one account once a day, and about twenty in all (owner, 2026-11-01). */
export const ALERTS_PER_DAY = 20;
/** The start of today in Manila, the reporting time zone (decision 0010). */
const MANILA_TODAY = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`;

interface PauseRow {
  paused_until: Date | null;
  paused: boolean;
  exempt: boolean;
  recent: number;
}

/** What {@link SignInPauseService.begin} answers. */
export type PauseAttempt =
  | { admitted: true; exempt: false }
  /**
   * Paused, but presenting the proof of a reset completed in the last fifteen minutes: only
   * the right password helps.
   */
  | { admitted: true; exempt: true; pausedUntil: Date | null }
  | { admitted: false; pausedUntil: Date | null };

/** What sign-in was asked with, as typed (decision 0337). */
export type SignInName = { email: string } | { username: string };

/** The key a pause is kept under: the name as typed, normalized as the lookup normalizes it. */
export function pauseIdentifier(who: SignInName): string {
  return 'email' in who
    ? `email:${normalizeEmail(who.email)}`
    : `username:${who.username.trim().toLowerCase()}`;
}

/**
 * The pause after ten wrong passwords (SKILL.md section 6, decision 0413).
 *
 * **Kept for the name as typed, whether or not an account holds it**, and that is what
 * keeps it from saying whether one does: a name nobody holds is paused after ten wrong
 * passwords exactly as a held one is, with the same words. Keying on the account instead
 * would pause a held name typed as an address and as a username together and an unheld
 * one separately, which an attacker can tell apart.
 *
 * **Each attempt is counted before its password is checked** ({@link begin}), in a short
 * transaction that locks the row, and the check runs after it commits: Argon2 is slow
 * (section 24) and must not hold a pooled connection. Counting first is what stops ten
 * attempts sent at once all passing a count that none of them has been added to yet.
 * A correct password then starts the count again ({@link succeeded}); a wrong one leaves its
 * attempt counted and, at the tenth, starts the pause ({@link failed}).
 */
@Injectable()
export class SignInPauseService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Counts an attempt for this name, or refuses it where sign-in for it is paused, saying
   * until when. Also refused where ten attempts of the window are already counted and still
   * being checked, so that no eleventh password is checked while the tenth may yet start a
   * pause; no pause is set then, so there is no end to name.
   *
   * **For fifteen minutes after a completed reset, the browser that completed it gets through a
   * pause** (owner, 2026-11-01): it presents the proof the reset answered with, and while the name
   * is paused its attempts are admitted and not counted; its correct password signs in, and a wrong
   * one is answered as the pause. So somebody re-pausing the name the moment a reset clears it
   * cannot keep the holder out of the device they reset on. Any other attempt on a paused name is
   * refused as the pause, so the allowance opens no window for guessing.
   */
  async begin(identifier: string, proofHash: string | null): Promise<PauseAttempt> {
    // Rows nobody has touched for a day: cheap, indexed, and on the one path that writes.
    // **Its own statement, before the counting transaction, skipping any row that is
    // locked**, so it never holds a lock on a row it does not own. Inside the transaction
    // it could lock an account's other name while a reset clearing both waited on this
    // one, and the two would deadlock.
    await this.db
      .deleteFrom('sign_in_pauses')
      .where('identifier', 'in', (eb) =>
        eb
          .selectFrom('sign_in_pauses')
          .select('identifier')
          .where(sql<boolean>`updated_at < now() - ${KEEP}`)
          .forUpdate()
          .skipLocked(),
      )
      .execute();

    return this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('sign_in_pauses')
        .values({ identifier })
        .onConflict((oc) => oc.column('identifier').doNothing())
        .execute();

      const row = await this.lockedRow(trx, identifier, proofHash);
      if (row.paused) {
        return row.exempt
          ? { admitted: true, exempt: true, pausedUntil: row.paused_until }
          : { admitted: false, pausedUntil: row.paused_until };
      }
      if (row.recent >= SIGN_IN_PAUSE_AFTER) {
        return row.exempt
          ? { admitted: true, exempt: true, pausedUntil: null }
          : { admitted: false, pausedUntil: null };
      }

      await trx
        .updateTable('sign_in_pauses')
        .set({
          failed_at: sql`array_append(ARRAY(SELECT t FROM unnest(failed_at) AS t WHERE t > now() - ${WINDOW}), now())`,
          paused_until: null,
          updated_at: sql`now()`,
        })
        .where('identifier', '=', identifier)
        .execute();
      return { admitted: true as const, exempt: false as const };
    });
  }

  /**
   * A correct password for an active account: the count starts again. While a reset's fifteen
   * minutes run the row is kept, **and so is any pause on it**: only the browser that reset gets
   * through, so its signing in must not open the name to everybody else. Signing in once does
   * not end the allowance either.
   */
  async succeeded(identifier: string): Promise<void> {
    await this.db
      .updateTable('sign_in_pauses')
      .set({ failed_at: [], updated_at: sql`now()` })
      .where('identifier', '=', identifier)
      .where(sql<boolean>`exempt_until > now()`)
      .execute();
    await this.db
      .deleteFrom('sign_in_pauses')
      .where('identifier', '=', identifier)
      // Never a row whose pause is still in force: the allowance may have lapsed while the
      // password was being checked, and a pause started meanwhile must stand.
      .where(sql<boolean>`(exempt_until IS NULL OR exempt_until <= now())`)
      .where(sql<boolean>`NOT coalesce(paused_until > now(), false)`)
      .execute();
  }

  /**
   * The attempt {@link begin} counted was wrong. Answers when the pause ends where this
   * is the attempt that starts one, so the caller says so and the Admin is told once per
   * pause; null otherwise.
   */
  async failed(identifier: string): Promise<Date | null> {
    return this.db.transaction().execute(async (trx) => {
      const row = await this.lockedRow(trx, identifier, null, true);
      if (row === undefined || row.paused || row.recent < SIGN_IN_PAUSE_AFTER) {
        return null;
      }

      // The window's attempts are spent by the pause, so the count starts again after it.
      const paused = await trx
        .updateTable('sign_in_pauses')
        .set({ failed_at: [], paused_until: sql`now() + ${PAUSE}`, updated_at: sql`now()` })
        .where('identifier', '=', identifier)
        .returning('paused_until')
        .executeTakeFirstOrThrow();
      return paused.paused_until;
    });
  }

  /**
   * A completed password reset ends any pause on the account's address and username, empties
   * their counts, and starts the fifteen minutes in which a pause does not stop the browser
   * presenting this proof ({@link begin}). Only the proof's hash is kept.
   */
  async resetForWithin(
    trx: Transaction<Database>,
    account: { email: string; username: string | null },
    proofHash: string,
  ): Promise<void> {
    const identifiers = [pauseIdentifier({ email: account.email })];
    if (account.username !== null) {
      identifiers.push(pauseIdentifier({ username: account.username }));
    }
    // In one order, so two resets of one account take the rows' locks alike.
    identifiers.sort();
    for (const identifier of identifiers) {
      await trx
        .insertInto('sign_in_pauses')
        .values({
          identifier,
          failed_at: [],
          exempt_until: sql`now() + ${PAUSE}`,
          exempt_proof_hash: proofHash,
        })
        .onConflict((oc) =>
          oc.column('identifier').doUpdateSet({
            failed_at: [],
            paused_until: null,
            exempt_until: sql`now() + ${PAUSE}`,
            exempt_proof_hash: proofHash,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    }
  }

  /**
   * Records a pause of a name an account holds in the audit log, as a system action, and
   * answers whether the Admin should be emailed about it: not if this account's pause was
   * already emailed today, nor once twenty have been today (owner, 2026-11-01), so that
   * alerts cannot spend the mail provider's daily allowance that reset emails need.
   *
   * One transaction holding an advisory lock, so two pauses at once cannot both find
   * nineteen and both send the twentieth.
   */
  async recordPause(accountId: string, identifier: string, pausedUntil: Date): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('sign_in_pause_alerts'))`.execute(trx);
      await trx
        .deleteFrom('sign_in_pause_alerts')
        .where(sql<boolean>`sent_at < now() - interval '2 days'`)
        .execute();

      const today = await trx
        .selectFrom('sign_in_pause_alerts')
        .select([
          sql<number>`count(*)::int`.as('all'),
          sql<number>`count(*) FILTER (WHERE account_id = ${accountId})::int`.as('mine'),
        ])
        .where(sql<boolean>`sent_at >= ${MANILA_TODAY}`)
        .executeTakeFirstOrThrow();
      const email = today.mine === 0 && today.all < ALERTS_PER_DAY;

      if (email) {
        await trx.insertInto('sign_in_pause_alerts').values({ account_id: accountId }).execute();
      }
      await this.audit.writeWithin(trx, {
        actorId: null,
        action: 'sign_in.paused',
        targetType: 'account',
        targetId: accountId,
        // The name as it was compared, `email:…` or `username:…`, so the log says which name
        // was paused even if the account's username changes later.
        after: { name: identifier, paused_until: pausedUntil.toISOString(), admin_emailed: email },
      });
      return email;
    });
  }

  private lockedRow(
    trx: Transaction<Database>,
    identifier: string,
    proofHash: string | null,
  ): Promise<PauseRow>;
  private lockedRow(
    trx: Transaction<Database>,
    identifier: string,
    proofHash: string | null,
    mayBeGone: true,
  ): Promise<PauseRow | undefined>;
  private async lockedRow(
    trx: Transaction<Database>,
    identifier: string,
    proofHash: string | null,
    mayBeGone = false,
  ): Promise<PauseRow | undefined> {
    const row = await trx
      .selectFrom('sign_in_pauses')
      .select([
        'paused_until',
        sql<boolean>`coalesce(paused_until > now(), false)`.as('paused'),
        // Exempt only for the proof this reset answered with, and only while it runs.
        sql<boolean>`coalesce(exempt_until > now() AND exempt_proof_hash = ${proofHash}, false)`.as(
          'exempt',
        ),
        sql<number>`(SELECT count(*)::int FROM unnest(failed_at) AS t WHERE t > now() - ${WINDOW})`.as(
          'recent',
        ),
      ])
      .where('identifier', '=', identifier)
      .forUpdate()
      .executeTakeFirst();

    if (row === undefined && !mayBeGone) {
      throw new Error(`The sign-in pause row for ${identifier} was not found under its lock.`);
    }
    return row;
  }
}
