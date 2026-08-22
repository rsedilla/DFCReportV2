import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { ApiError, ApiErrorCode } from '../errors/api-error';

import { DATABASE, type Db } from '../../database/database.module';

import type { Database, Json } from '../../database/schema';
import type { Transaction } from 'kysely';

/**
 * The idempotency store of SKILL.md section 22.
 *
 * A leader recording attendance on an unreliable connection will retry, and a
 * retry must never create a second record. This is required from the first write
 * endpoint rather than added later, and pastoral reassignment is that endpoint.
 *
 * The key is scoped to the account, never global (section 22). Two accounts may
 * present the same key: it is client-generated and therefore not a secret, so a
 * global namespace would let a client that reused an observed key receive
 * another account's stored response, or deny that account its own retry.
 */

/** Section 22: the response is stored "for at least 24 hours". */
const RETENTION_HOURS = 24;

/**
 * How long a claim may sit unfinished before another request may take it.
 *
 * Separate from the retention above because it answers a different question.
 * Retention keeps an *answer*; the lease bounds an *attempt*. Using one duration
 * for both left a request whose process died holding its key for a day, with
 * every retry told `REQUEST_IN_FLIGHT` — which section 22 defines as "retry after
 * a short delay".
 *
 * Sixty seconds is longer than any request this API should serve and short enough
 * that a client retrying on a normal backoff gets past it.
 */
const CLAIM_LEASE_SECONDS = 60;

export type ClaimResult =
  /**
   * This request owns the key and should execute. `claimId` identifies *this*
   * claim: every later write against the row carries it, so a request that has
   * since lost the key under the lease matches nothing rather than acting on the
   * claim that replaced it.
   */
  | { outcome: 'claimed'; claimId: string }
  /** The same key and the same body already completed; replay its response. */
  | { outcome: 'replay'; status: number; body: Json | null }
  /** The same key, a different body. Permanent; the client must never retry. */
  | { outcome: 'reused' }
  /** The first request with this key has not finished. Retry after a delay. */
  | { outcome: 'in_flight' };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * A hash of method, path and body (section 22), which is what makes the
   * different-body branch decidable.
   *
   * The body is canonicalized first, so that two encodings of one request agree.
   * Without it, a client serializing its object keys in a different order on a
   * retry -- which nothing forbids, and which several JSON libraries do -- gets
   * `IDEMPOTENCY_KEY_REUSED`, a code section 22 makes permanent and says must
   * never be retried. That turns an ordinary retry into a dead end.
   */
  fingerprint(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method.toUpperCase()} ${path}\n${canonicalize(body)}`)
      .digest('hex');
  }

  /**
   * Claims the key for this request, or reports what already holds it.
   *
   * The claim is one statement and the primary key does the racing. Two requests
   * presenting one key at the same instant cannot both insert, so exactly one is
   * told to execute and the other reads the row that won -- which is the case
   * `REQUEST_IN_FLIGHT` exists for: a phone resending before the first response
   * arrives (section 22).
   *
   * An expired row is reclaimed by that same statement rather than by a read
   * followed by a write, which would reintroduce the race the primary key just
   * closed. `DO UPDATE ... WHERE` returns no row while the existing key is still
   * live, and that absence is what sends the caller on to `inspect`.
   */
  async claim(params: {
    key: string;
    accountId: string;
    fingerprint: string;
  }): Promise<ClaimResult> {
    const retention = `${RETENTION_HOURS} hours`;
    const lease = `${CLAIM_LEASE_SECONDS} seconds`;

    const claimed = await sql<{ claim_id: string }>`
      INSERT INTO idempotency_keys (
        key, account_id, request_fingerprint, state, claim_id, claimed_at, expires_at
      )
      VALUES (
        ${params.key}::uuid,
        ${params.accountId}::uuid,
        ${params.fingerprint},
        'IN_FLIGHT',
        gen_random_uuid(),
        now(),
        now() + ${retention}::interval
      )
      ON CONFLICT (account_id, key) DO UPDATE
        SET request_fingerprint = excluded.request_fingerprint,
            state = 'IN_FLIGHT',
            response_status = NULL,
            response_body = NULL,
            -- A new identity, because this is a new claim. The request that held
            -- the row before carries the old one and now matches nothing.
            claim_id = gen_random_uuid(),
            claimed_at = now(),
            expires_at = excluded.expires_at
        -- Two ways a row may be taken over, and they are different questions.
        -- A retained *answer* is past its retention and may be replaced. An
        -- unfinished *claim* is past its lease, which means the request holding
        -- it is not coming back.
        WHERE idempotency_keys.expires_at <= now()
           OR (
             idempotency_keys.state = 'IN_FLIGHT'
             AND idempotency_keys.claimed_at <= now() - ${lease}::interval
           )
      RETURNING claim_id
    `.execute(this.db);

    if (claimed.rows.length > 0) {
      return { outcome: 'claimed', claimId: claimed.rows[0].claim_id };
    }

    return this.inspect(params);
  }

  /** What the live row holding this key says about it. */
  private async inspect(params: {
    key: string;
    accountId: string;
    fingerprint: string;
  }): Promise<ClaimResult> {
    const row = await this.db
      .selectFrom('idempotency_keys')
      .select(['request_fingerprint', 'state', 'response_status', 'response_body'])
      .where('account_id', '=', params.accountId)
      .where('key', '=', params.key)
      .executeTakeFirst();

    if (!row) {
      // The row expired between the claim and this read. Answering "in flight"
      // asks the client to retry shortly, and that retry claims it. It is the one
      // answer that cannot be wrong here: claiming again is safe, and replaying a
      // response we can no longer see is not.
      return { outcome: 'in_flight' };
    }

    if (row.request_fingerprint !== params.fingerprint) {
      return { outcome: 'reused' };
    }

    if (row.state === 'IN_FLIGHT') {
      return { outcome: 'in_flight' };
    }

    return {
      outcome: 'replay',
      // The check constraint makes this non-null wherever the state is COMPLETED.
      status: row.response_status ?? 200,
      body: row.response_body,
    };
  }

  /**
   * Stores the response this request produced, so a repeat returns it.
   *
   * Called by the interceptor after the handler, which is the right place for a
   * request that wrote nothing. A request that **did** write calls
   * `completeWithin` inside its own transaction instead — see there for why.
   */
  async complete(params: {
    key: string;
    accountId: string;
    claimId: string;
    status: number;
    body: Json | null;
  }): Promise<void> {
    // A zero row count is ordinary here and is not an error: it is what happens
    // when the handler already recorded its own completion transactionally, which
    // is the arrangement that makes the two paths compose.
    await this.completeOn(this.db, params);
  }

  /**
   * The same, inside a caller's transaction.
   *
   * **A write endpoint records its completion here, in the transaction that
   * performs the write** (SKILL.md section 22). The claim is taken before the
   * handler and, left to the interceptor, is recorded after it — so a failure in
   * between leaves a committed write with an unfinished claim, and the claim
   * lease then lets a retry perform that write a second time. Committing the
   * record with the write closes it: either both are there or neither is.
   *
   * The two paths compose without coordinating. This sets the row to `COMPLETED`,
   * and the interceptor's own call afterwards carries `state = 'IN_FLIGHT'` in its
   * predicate, so it matches nothing and leaves this response untouched. Nothing
   * needs to tell the interceptor that the handler already recorded its own
   * completion.
   */
  async completeWithin(
    transaction: Transaction<Database>,
    params: {
      key: string;
      accountId: string;
      claimId: string;
      status: number;
      body: Json | null;
    },
  ): Promise<void> {
    const recorded = await this.completeOn(transaction, params);

    if (recorded === 0n) {
      // The claim is gone: this request passed its lease and another took the key
      // over. Section 22 says the write and the record of it are "either both
      // there or neither" -- so with no record possible, the write must not
      // commit. Throwing aborts the caller's transaction, which is the only way
      // to honour that from here.
      //
      // Returning quietly instead would leave the write on disk with nothing
      // recording it, and the retry that follows would perform it again. That is
      // the failure this whole mechanism exists to prevent, and it would be
      // silent.
      throw new ApiError(
        ApiErrorCode.REQUEST_IN_FLIGHT,
        'This request lost its idempotency claim to a retry. Nothing was recorded. Retry shortly.',
        { header: 'Idempotency-Key' },
      );
    }
  }

  private async completeOn(
    executor: Db,
    params: {
      key: string;
      accountId: string;
      claimId: string;
      status: number;
      body: Json | null;
    },
  ): Promise<bigint> {
    const result = await sql`
      UPDATE idempotency_keys
         SET state = 'COMPLETED',
             response_status = ${params.status},
             -- Serialized here and cast, rather than handed to the driver as a
             -- value. No JSON plugin is installed, so node-pg would render a
             -- JavaScript array as a PostgreSQL array literal ({1,2}) and a bare
             -- string unquoted -- neither of which parses as jsonb. The column
             -- type permits any JSON value and a handler may return one.
             response_body = ${params.body === null ? null : JSON.stringify(params.body)}::jsonb,
             -- Section 22 retains the response "for at least 24 hours". Measured
             -- from the response rather than from the claim, so a slow request
             -- does not shorten the window its own answer is kept for.
             expires_at = now() + ${`${RETENTION_HOURS} hours`}::interval
       WHERE account_id = ${params.accountId}::uuid
         AND key = ${params.key}::uuid
         -- This request's own claim, and no other. Without it a request whose
         -- lease expired mid-flight would complete whichever claim replaced it,
         -- storing its own response against another request's work.
         AND claim_id = ${params.claimId}::uuid
         -- Stops a second write to a row already completed, which is what lets a
         -- handler record its completion transactionally and leaves the
         -- interceptor's later call inert.
         AND state = 'IN_FLIGHT'
    `.execute(executor);

    return result.numAffectedRows ?? 0n;
  }

  /**
   * Releases a claim so the client may retry.
   *
   * Used only where the failure carries no decision: an unexpected error, or
   * anything answered with a 5xx. Those roll back, so nothing was recorded and a
   * retry cannot double-apply, while storing them would pin a transient failure
   * to the key for a day and leave the client no way past it.
   *
   * A 4xx is the opposite and is stored. It is this request's outcome, decided by
   * the rules, and a repeat of the same body is entitled to the same answer.
   */
  async release(params: { key: string; accountId: string; claimId: string }): Promise<void> {
    await this.db
      .deleteFrom('idempotency_keys')
      .where('account_id', '=', params.accountId)
      .where('key', '=', params.key)
      // As above: a request that has lost its claim releases nothing. Without
      // this it would delete the claim that replaced it, and that request's work
      // would go unrecorded.
      .where('claim_id', '=', params.claimId)
      .where('state', '=', 'IN_FLIGHT')
      .execute();
  }
}

/**
 * A stable string for any JSON body: object keys sorted, everything else left
 * alone. Arrays keep their order, because order is meaning in an array and two
 * differently ordered arrays are two different requests.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([itemKey, item]) => `${JSON.stringify(itemKey)}:${canonicalize(item)}`);

  return `{${entries.join(',')}}`;
}
