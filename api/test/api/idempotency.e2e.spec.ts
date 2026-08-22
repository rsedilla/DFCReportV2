import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';

import { AuthenticatedOnly, Public } from '../../src/auth/authorization/authorization.decorators';
import {
  CurrentIdempotency,
  type CurrentClaim,
} from '../../src/common/idempotency/current-idempotency.decorator';
import { ApiError, ApiErrorCode } from '../../src/common/errors/api-error';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { DATABASE, type Db } from '../../src/database/database.module';
import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * `Idempotency-Key` on every authenticated state-changing request (SKILL.md
 * section 22, Idempotency; section 23, Required from the first write endpoint).
 *
 * A leader recording attendance on an unreliable connection will retry, and a
 * retry must never create a second record. The plumbing is built before the first
 * write endpoint rather than retrofitted around it, so these cases run against a
 * probe controller that exists only here.
 */

/** Counts executions, so "did not execute again" is an assertion rather than a hope. */
let executions = 0;
/** Held open by the slow endpoint, to exercise the in-flight branch deterministically. */
let releaseSlow: (() => void) | null = null;

/**
 * A real effect for the transactional cases to carry, so "the write reverted with
 * its record" is an assertion rather than a description. `audit_log` is used
 * because every write endpoint writes one anyway (SKILL.md section 21).
 */
async function probeWrite(trx: Transaction<Database>): Promise<void> {
  await trx
    .insertInto('audit_log')
    .values({
      actor_id: null,
      action: 'person.created',
      target_type: 'person',
      target_id: 'the-probe-target',
    })
    .execute();
}

@Controller('__idempotency-probe')
class IdempotencyProbeController {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('records-its-own-completion')
  @AuthenticatedOnly('Probe for a write that records its completion transactionally.')
  async recordsItsOwnCompletion(
    @CurrentIdempotency() claim: CurrentClaim,
  ): Promise<{ recorded: true; from: string }> {
    executions += 1;

    // What a real write endpoint does under SKILL.md section 22: the effect and
    // the record of it commit together.
    await this.db.transaction().execute(async (trx) => {
      await probeWrite(trx);
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 201,
        body: { recorded: true, from: 'the transaction' },
      });
    });

    return { recorded: true, from: 'the handler' };
  }

  @Post('rolls-back')
  @AuthenticatedOnly('Probe for a write that completes its key and then fails.')
  async rollsBack(@CurrentIdempotency() claim: CurrentClaim): Promise<never> {
    executions += 1;

    await this.db.transaction().execute(async (trx) => {
      await probeWrite(trx);
      await this.idempotency.completeWithin(trx, {
        ...claim,
        status: 201,
        body: { recorded: true, from: 'the transaction' },
      });

      // Everything above reverts together: the effect and the record of it.
      throw new Error('the write failed after recording itself');
    });

    throw new Error('unreachable');
  }

  @Post('write')
  @AuthenticatedOnly('Probe. Acts on nothing; the interceptor is what is under test.')
  write(@Body() body: Record<string, unknown>): { executions: number; echoed: unknown } {
    executions += 1;
    return { executions, echoed: body.value ?? null };
  }

  @Post('fails-4xx')
  @AuthenticatedOnly('Probe for a domain refusal, which is a decision and is stored.')
  fails4xx(): never {
    executions += 1;
    throw new ApiError(ApiErrorCode.INVARIANT_VIOLATION, 'The rules reject this record.');
  }

  @Post('fails-5xx')
  @AuthenticatedOnly('Probe for an unexpected failure, which carries no decision.')
  fails5xx(): never {
    executions += 1;
    throw new Error('something unexpected');
  }

  @Post('slow')
  @AuthenticatedOnly('Probe that stays in flight until the test releases it.')
  async slow(): Promise<{ done: true }> {
    executions += 1;
    await new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    return { done: true };
  }

  @Post('no-content')
  @HttpCode(204)
  @AuthenticatedOnly('Probe for a 204, which is the shape logout and logout-all produce.')
  noContent(): void {
    executions += 1;
  }

  @Post('array-body')
  @AuthenticatedOnly('Probe for a top-level array, which jsonb accepts and the driver would not.')
  arrayBody(): number[] {
    executions += 1;
    return [1, 2, 3];
  }

  @Get('read')
  @AuthenticatedOnly('Probe: a read needs no key.')
  read(): { reached: true } {
    return { reached: true };
  }

  @Post('public-write')
  @Public('Probe for the unauthenticated path, which has no account to key a row by.')
  publicWrite(): { reached: true } {
    return { reached: true };
  }
}

describe('idempotency (SKILL.md section 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let account: TestAccount;
  let other: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp([IdempotencyProbeController]);
  });

  beforeEach(async () => {
    await truncateAll(db);
    executions = 0;
    releaseSlow = null;

    account = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Mark', network: 'MENS' }),
      roles: ['LEADER'],
    });
    other = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Manuel', network: 'MENS' }),
      roles: ['LEADER'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('refuses a state-changing request that carries no key', async () => {
    const response = await post('write', account).send({ value: 'a' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(executions).toBe(0);
  });

  it('refuses a key that is not a UUID', async () => {
    const response = await post('write', account)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ value: 'a' });

    expect(response.status).toBe(422);
    expect(executions).toBe(0);
  });

  it('replays the stored response and does not execute again', async () => {
    const key = randomUUID();

    const first = await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });
    expect(first.status).toBe(201);
    expect(executions).toBe(1);

    const repeat = await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });

    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual(first.body);
    // The whole point. A retry must never create a second record.
    expect(executions).toBe(1);
  });

  it('replays regardless of the order the client serialized the body in', async () => {
    // Nothing forbids a client reordering object keys on a retry, and several
    // JSON libraries do. Treating that as a different body would answer
    // IDEMPOTENCY_KEY_REUSED, which section 22 makes permanent -- turning an
    // ordinary retry into a dead end.
    const key = randomUUID();

    const first = await post('write', account)
      .set('Idempotency-Key', key)
      .send({ value: 'a', note: 'b' });
    expect(first.status).toBe(201);

    const repeat = await post('write', account)
      .set('Idempotency-Key', key)
      .send({ note: 'b', value: 'a' });

    expect(repeat.status).toBe(201);
    expect(executions).toBe(1);
  });

  it('answers IDEMPOTENCY_KEY_REUSED for the same key with a different body', async () => {
    const key = randomUUID();

    await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });

    const different = await post('write', account).set('Idempotency-Key', key).send({ value: 'b' });

    expect(different.status).toBe(409);
    // Not VALIDATION_FAILED: a client branching on that code would show a field
    // error for a replay (section 22).
    expect(different.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(executions).toBe(1);
  });

  it('answers REQUEST_IN_FLIGHT while the first request is still running', async () => {
    // The case the header exists to handle: a phone on an unreliable connection
    // resends before the first response arrives.
    const key = randomUUID();

    // Started but not awaited: the handler blocks until the test releases it, so
    // the key is genuinely claimed and unfinished while the retry arrives.
    //
    // The `.then()` is what dispatches it. A supertest `Test` is a thenable that
    // sends nothing until something subscribes, so holding the object alone
    // leaves the request unsent and the wait below times out against a handler
    // that was never entered.
    const slow = post('slow', account)
      .set('Idempotency-Key', key)
      .send({})
      .then((response) => response);

    // Waiting for the handler to be inside the endpoint proves the request is in
    // flight rather than assuming a sleep was long enough.
    await waitFor(() => releaseSlow !== null);

    const retry = await post('slow', account).set('Idempotency-Key', key).send({});

    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('REQUEST_IN_FLIGHT');
    // The retry did not execute the handler a second time.
    expect(executions).toBe(1);

    releaseSlow?.();
    await slow;
  });

  it('scopes a key to its account, so one account cannot claim another key', async () => {
    const key = randomUUID();

    const mine = await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });
    expect(mine.status).toBe(201);

    // A key is client-generated and therefore not a secret. If the namespace were
    // global, this request would receive the other account's stored response.
    const theirs = await post('write', other)
      .set('Idempotency-Key', key)
      .send({ value: 'different' });

    expect(theirs.status).toBe(201);
    expect(executions).toBe(2);
  });

  it('stores a 4xx, because a domain refusal is this request outcome', async () => {
    const key = randomUUID();

    const first = await post('fails-4xx', account).set('Idempotency-Key', key).send({});
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('INVARIANT_VIOLATION');

    const repeat = await post('fails-4xx', account).set('Idempotency-Key', key).send({});

    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('INVARIANT_VIOLATION');
    // Replayed rather than re-executed: a repeat of the same body is entitled to
    // the same answer.
    expect(executions).toBe(1);
  });

  it('releases the key on a 5xx, so the client may retry', async () => {
    // An unexpected failure rolls back and carries no decision. Storing it would
    // pin a transient failure to the key for a day with no way past it.
    const key = randomUUID();

    const first = await post('fails-5xx', account).set('Idempotency-Key', key).send({});
    expect(first.status).toBe(500);

    const retry = await post('fails-5xx', account).set('Idempotency-Key', key).send({});

    expect(retry.status).toBe(500);
    expect(executions).toBe(2);

    const rows = await db.selectFrom('idempotency_keys').select('key').execute();
    expect(rows).toHaveLength(0);
  });

  it('replays a 204 with its status and no body', async () => {
    // The shape logout and logout-all produce, which this ruling newly covers. A
    // replay answering 201 with an empty body would look like a success of a
    // different kind.
    const key = randomUUID();

    const first = await post('no-content', account).set('Idempotency-Key', key).send({});
    expect(first.status).toBe(204);

    const repeat = await post('no-content', account).set('Idempotency-Key', key).send({});

    expect(repeat.status).toBe(204);
    expect(executions).toBe(1);
  });

  it('stores a top-level array, which the driver would not have stored as JSON', async () => {
    // `response_body` is jsonb and the Json type permits an array, but no JSON
    // plugin is installed -- so handing the driver a JavaScript array renders a
    // PostgreSQL array literal, which does not parse as jsonb. The value is
    // serialized and cast instead.
    const key = randomUUID();

    const first = await post('array-body', account).set('Idempotency-Key', key).send({});
    expect(first.status).toBe(201);
    expect(first.body).toEqual([1, 2, 3]);

    const repeat = await post('array-body', account).set('Idempotency-Key', key).send({});

    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual([1, 2, 3]);
    expect(executions).toBe(1);
  });

  it('lets exactly one of two claims execute, with the loser refused', async () => {
    // `Promise.all` over two ordinary writes is not enough on its own: if the two
    // happen to serialize, both return 201, `executions` is still 1, and the case
    // passes against a read-then-write claim with no primary key involved. That is
    // the trap CLAUDE.md records for authorization case 7.
    //
    // The first claim is therefore held open inside the handler, so the second
    // arrives while the row is unambiguously IN_FLIGHT and the only thing that can
    // refuse it is the claim itself.
    const key = randomUUID();

    const first = post('slow', account)
      .set('Idempotency-Key', key)
      .send({})
      .then((response) => response);

    await waitFor(() => releaseSlow !== null);

    const second = await post('slow', account).set('Idempotency-Key', key).send({});

    // The loser is refused rather than executed, and is told to retry rather than
    // told never to.
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REQUEST_IN_FLIGHT');
    expect(executions).toBe(1);

    releaseSlow?.();
    expect((await first).status).toBe(201);

    // One row, and it holds the winner's response.
    const rows = await db
      .selectFrom('idempotency_keys')
      .select(['state', 'response_status'])
      .execute();
    expect(rows).toEqual([{ state: 'COMPLETED', response_status: 201 }]);
  });

  it('completes only its own claim, not one that replaced it', async () => {
    // A slow request whose lease expires loses the key to whoever takes it over.
    // Without a claim identity its completion would land on the new holder's
    // claim -- storing its own response against another request's work, and
    // silently discarding that request's own completion.
    const key = randomUUID();
    const accountId = account.id;

    const first = await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });
    expect(first.status).toBe(201);

    const claim = await db
      .selectFrom('idempotency_keys')
      .select('claim_id')
      .where('key', '=', key)
      .executeTakeFirstOrThrow();

    // The claim that request held, before another request takes the key over.
    const stale = claim.claim_id;

    // Simulate the takeover the lease permits: a new claim on the same key.
    await db
      .updateTable('idempotency_keys')
      .set({ state: 'IN_FLIGHT', response_status: null, response_body: null })
      .where('key', '=', key)
      .execute();

    const service = app.get(IdempotencyService);

    // The stale holder tries to finish. It must change nothing.
    await service.complete({
      key,
      accountId,
      claimId: stale,
      status: 200,
      body: { from: 'the stale claim' },
    });

    const after = await db
      .selectFrom('idempotency_keys')
      .select(['state', 'response_body'])
      .where('key', '=', key)
      .executeTakeFirstOrThrow();

    expect(after.state).toBe('IN_FLIGHT');
    expect(after.response_body).toBeNull();

    // And it releases nothing either.
    await service.release({ key, accountId, claimId: stale });
    expect(await db.selectFrom('idempotency_keys').select('key').execute()).toHaveLength(1);
  });

  it('leaves a completion the handler recorded in its own transaction', async () => {
    // The rule this pins: a write endpoint records its completion inside the
    // transaction that performs the write, so the write and the record of it
    // commit together. The interceptor's own call afterwards carries
    // `state = 'IN_FLIGHT'` and therefore matches nothing.
    //
    // If it did overwrite, the stored body would be the handler's return value
    // rather than the one the transaction recorded -- and the composition the
    // rule depends on would be silently absent.
    const key = randomUUID();

    const first = await post('records-its-own-completion', account)
      .set('Idempotency-Key', key)
      .send({});
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ recorded: true, from: 'the handler' });

    const stored = await db
      .selectFrom('idempotency_keys')
      .select(['state', 'response_status', 'response_body'])
      .where('key', '=', key)
      .executeTakeFirstOrThrow();

    expect(stored.state).toBe('COMPLETED');
    expect(stored.response_status).toBe(201);
    // The transaction's body, not the handler's.
    expect(stored.response_body).toEqual({ recorded: true, from: 'the transaction' });

    // And a retry replays what the transaction recorded.
    const repeat = await post('records-its-own-completion', account)
      .set('Idempotency-Key', key)
      .send({});
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual({ recorded: true, from: 'the transaction' });
    expect(executions).toBe(1);
  });

  it('reverts the record with the write when the transaction rolls back', async () => {
    // The half that proves `completeWithin` is genuinely inside the transaction.
    // Passing the pooled connection instead would leave the row COMPLETED here
    // while the write reverted -- a retry would then be replayed a success for a
    // record that does not exist, which is worse than the gap this closes.
    const key = randomUUID();

    const failed = await post('rolls-back', account).set('Idempotency-Key', key).send({});
    expect(failed.status).toBe(500);
    expect(executions).toBe(1);

    // The effect reverted.
    expect(await db.selectFrom('audit_log').select('id').execute()).toHaveLength(0);

    // And so did the record of it: a 5xx releases the claim, so the key is gone
    // and the client may retry.
    expect(await db.selectFrom('idempotency_keys').select('key').execute()).toHaveLength(0);

    // A retry therefore executes rather than replaying a success that never was.
    const retry = await post('rolls-back', account).set('Idempotency-Key', key).send({});
    expect(retry.status).toBe(500);
    expect(executions).toBe(2);
  });

  it('leaves reads alone', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/__idempotency-probe/read')
      .set('Authorization', `Bearer ${account.accessToken}`);

    expect(response.status).toBe(200);
  });

  it('leaves an unauthenticated write alone, which has no account to key a row by', async () => {
    // Section 22 keys the store by account, so a request with no account cannot
    // have a row. The exempt set is exactly section 7's closed unauthenticated
    // list, so widening it is an amendment rather than a controller decision.
    const response = await request(app.getHttpServer()).post(
      '/api/v1/__idempotency-probe/public-write',
    );

    expect(response.status).toBe(201);
  });

  it('records the key with the response it produced', async () => {
    const key = randomUUID();
    await post('write', account).set('Idempotency-Key', key).send({ value: 'a' });

    const row = await db
      .selectFrom('idempotency_keys')
      .select(['state', 'response_status', 'expires_at'])
      .where('key', '=', key)
      .executeTakeFirstOrThrow();

    expect(row.state).toBe('COMPLETED');
    expect(row.response_status).toBe(201);
    // Section 22: stored "for at least 24 hours".
    expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  function post(path: string, actor: TestAccount) {
    return request(app.getHttpServer())
      .post(`/api/v1/__idempotency-probe/${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`);
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the probe to be in flight');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
