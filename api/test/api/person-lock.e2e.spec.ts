import { randomUUID } from 'node:crypto';

import { Body, Controller, Param, Post, Query } from '@nestjs/common';

import { AuthenticatedOnly } from '../../src/auth/authorization/authorization.decorators';

import { Client } from 'pg';
import request from 'supertest';

import { DATABASE, type Db } from '../../src/database/database.module';
import { lockPersonsWithin } from '../../src/database/person-lock';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { PeopleService } from '../../src/people/people.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp, EPOCH } from '../setup/fixtures';
import {
  countAdvisoryHolders,
  countAdvisoryWaiters,
  countWhileInFlight,
  holdPersonLock,
  personLockKey,
  track,
} from '../setup/concurrency';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The person lock, asserted **per site** (SKILL.md section 5, Database enforcement).
 *
 * There are four places that must take it, and one end-to-end case cannot pin more
 * than the first lock the request happens to reach. The correction locks both of
 * its persons up front, so a test driving `PUT /people/{id}/sex` blocks there and
 * would still pass with the lock deleted from `networks.changeWithin` and from
 * both `hierarchy` writers. Each site therefore gets a case that calls it directly.
 *
 * **The evidence is a positive probe, not an elapsed timer.** Asserting "the
 * request has not finished after N milliseconds" is flaky-green: on a slow runner
 * an unblocked request is also unfinished at N. These poll `pg_locks` for a request
 * waiting on *this person's key*, which is true only if the code under test asked
 * for that lock, and which fails by timing out if it never does.
 *
 * Fixture names and dates are invented (CLAUDE.md, Secrets).
 *
 * **This file carries a second subject**, which its title does not cover and
 * which is here rather than in its own file because it needs this one's
 * fixtures and app: the identifier boundary's global-ness (section 7), pinned by
 * the probe controller below and by the case that drives it. That case is the
 * only one in the suite that fails if the boundary regresses to being opt-in.
 */
/**
 * A route that opts into nothing.
 *
 * It exists to be written the way somebody adding a route next month would write
 * one — no pipe, no decorator, no knowledge that identifiers are canonicalized —
 * so that the global boundary is what has to hold. `@AuthenticatedOnly` because it
 * touches no church data and reads only what it was handed.
 */
@Controller('__identifier-probe')
class IdentifierProbeController {
  @Post(':id')
  @AuthenticatedOnly('A test probe that reads back what it was handed.')
  seen(
    // **Object bindings, deliberately.** `@Param('id')` and `@Query('filter_id')`
    // are handed a bare string and pass whether or not the walk handles the
    // objects Express actually builds — which are null-prototype, and which the
    // first version of this pipe silently skipped.
    @Param() params: { id: string },
    @Query() query: { filter_id: string },
    @Body() body: { nested: { ids: string[] }; password: string },
  ): { param: string; query: string; body: string; password: string } {
    return {
      param: params.id,
      query: query.filter_id,
      body: body.nested.ids[0],
      password: body.password,
    };
  }
}

describe('the person lock, and the identifier boundary that needs the same fixtures', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let manuel: TestPerson;
  let mark: TestPerson;
  let grace: TestPerson;
  let geraldine: TestPerson;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp([IdentifierProbeController]);
  });

  beforeEach(async () => {
    await truncateAll(db);

    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });

    await assignTo(db, manuel.id, null);
    await assignTo(db, geraldine.id, null);
    await assignTo(db, mark.id, manuel.id, EPOCH);
    await assignTo(db, grace.id, geraldine.id, EPOCH);

    admin = await createAccount(app, db, { person: manuel, roles: ['ADMIN'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /**
   * Holds this person's advisory key, runs `attempt`, and asserts it comes to wait
   * on that same key. Releases, then lets `attempt` finish.
   *
   * The key is computed in SQL from the person id rather than in JavaScript, and the
   * computation lives once, in `test/setup/concurrency.ts`, rather than being spelled
   * out here.
   *
   * **That is not a construction guarantee, and the sentence this replaces called it
   * one.** Computing in SQL gives agreement only if the two expressions match, and the
   * one surviving copy can still drift from `lockPersonsWithin` — a mutation confirms
   * it. What agreement there is comes from the case below, which checks it.
   *
   * *The sentence this replaces claimed the construction guarantee for a copy, and there
   * were twenty-four copies across seven files. What a copy cannot promise is that the
   * others agree with it — and a drifted probe reports the same zero as a lock that was
   * never taken, so the failure names nothing, which is a diagnosis problem rather than
   * a silent one.* The case below pins the one remaining computation against the key the
   * implementation is observed to take, which is the part a shared helper cannot promise
   * on its own.
   */
  async function assertWaitsOnPersonKey(
    personId: string,
    attempt: () => Promise<unknown>,
  ): Promise<void> {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();

    try {
      await holder.query('BEGIN');
      const key = await holdPersonLock(holder, personId);

      // Watched rather than awaited: a refusal after the lock is acquired is fine
      // and is not what this asserts.
      const inFlight = track(attempt());

      // **Bounded by the attempt rather than by a wall clock**
      // (`test/setup/concurrency.ts`). The budget this replaces ran from dispatch,
      // and the request's pre-lock work — round trip, token, guard reads, subtree
      // walk — can outrun it under load, failing while the system is correct.
      const waiting = await countWhileInFlight(
        () => countAdvisoryWaiters(holder, key),
        inFlight,
        'a waiter on the person key',
      );

      expect(waiting).toBeGreaterThan(0);

      await holder.query('ROLLBACK');
      await inFlight.done;
    } finally {
      await holder.end();
    }
  }

  it('canonicalizes a path identifier on a route that never opted in', async () => {
    // **This is what "structural" means, and it is the only case that can fail if
    // the boundary goes back to being opt-in.** The probe route below is written
    // the way any new route would be — bare `@Param`, `@Query` and `@Body`, no
    // pipe, no `@Transform`, nobody having remembered anything — and it must still
    // see the canonical form in all three. The body identifier is nested inside an
    // array inside an object, because that is where a real one turns up, and the
    // bindings are objects because that is what Express hands over.
    //
    // Every other identifier case passes if *either* layer is present, so none of
    // them notices the boundary regressing to a per-parameter opt-in.
    const upper = mark.id.toUpperCase();

    const response = await request(app.getHttpServer())
      .post(`/api/v1/__identifier-probe/${upper}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      // A POST is state-changing, so section 22 requires the header on it — which
      // the probe inherits without asking, exactly as it inherits the pipe. The
      // first version of this case omitted it and was answered 422.
      .set('Idempotency-Key', randomUUID())
      .query({ filter_id: upper })
      // UUID-shaped on purpose: the credential is the case that decides the rule
      // is about field names rather than value shapes.
      .send({ nested: { ids: [upper] }, password: upper });

    expect(response.status).toBe(201);

    // All three, because a client supplies identifiers in all three and the rule
    // says "always". Path and query were opt-in before; the body needed a
    // decorator per field.
    expect(response.body.param).toBe(mark.id);
    expect(response.body.query).toBe(mark.id);
    expect(response.body.body).toBe(mark.id);

    // **And a credential is untouched, though it is UUID-shaped.** Canonicalizing
    // by value shape would lowercase it and lock that account out permanently,
    // with nothing to diagnose. This is what pins the rule being about the name.
    expect(response.body.password).toBe(upper);
  });

  it('normalizes identifiers in the authority check itself, not only at the boundary', async () => {
    // **The two layers are pinned separately on purpose.** Every end-to-end case
    // passes if *either* the pipe or `sameId` is present, so together they pin the
    // disjunction and neither half alone. Section 7 requires both: "any comparison
    // that decides authority normalizes again rather than trusting that they
    // were." This calls the check directly, which is what a caller that forgot the
    // pipe looks like — and what the reassignment endpoint will look like if it
    // wires its own route differently.
    const hierarchy = app.get(HierarchyService);

    await expect(
      hierarchy.assertMayReparent(
        db,
        { personId: mark.id, roles: ['LEADER'] },
        mark.id.toUpperCase(),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

    await expect(
      hierarchy.assertMayReparent(
        db,
        { personId: mark.id, roles: ['LEADER'] },
        manuel.id.toUpperCase(),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

    // And it still permits what it should, so the case is not satisfied by a check
    // that refuses everything.
    await expect(
      hierarchy.assertMayReparent(db, { personId: manuel.id, roles: ['LEADER'] }, mark.id),
    ).resolves.toBeUndefined();
  });

  it('normalizes a duplicate acknowledgement in the service, not only in the DTO', async () => {
    // The other half of the same rule, on the path where the failure is a
    // permanent block rather than an escalation (section 3). Called through the
    // service so the DTO transform is not in the way.
    const people = app.get(PeopleService);
    const idempotency = app.get(IdempotencyService);

    // A real claim, because `completeWithin` throws when it matches no row — a
    // fabricated one would fail this case for a reason that has nothing to do with
    // identifiers.
    async function mintClaim(): Promise<{ key: string; accountId: string; claimId: string }> {
      const key = randomUUID();
      const claimed = await idempotency.claim({
        key,
        accountId: admin.id,
        fingerprint: randomUUID(),
      });

      if (claimed.outcome !== 'claimed') {
        throw new Error(`Expected a fresh key to be claimable, got ${claimed.outcome}.`);
      }

      return { key, accountId: admin.id, claimId: claimed.claimId };
    }

    const input = {
      firstName: 'Mario',
      lastName: 'Delacruz',
      birthDate: '1991-07-19',
      sex: 'MALE' as const,
      civilStatus: 'SINGLE' as const,
      placement: { kind: 'UNDER' as const, pastoralLeaderId: manuel.id },
      acknowledgedDuplicateIds: [] as string[],
    };

    const actor = { accountId: admin.id, personId: manuel.id };

    const first = await people.create(input, actor, await mintClaim(), () => Promise.resolve(true));

    // Uppercase, as a client that round-tripped the candidate ids would send them.
    // Compared raw, the gate is never satisfied and this Person can never be
    // created at all (section 3).
    await expect(
      people.create(
        { ...input, acknowledgedDuplicateIds: [String(first.id).toUpperCase()] },
        actor,
        await mintClaim(),
        () => Promise.resolve(true),
      ),
    ).resolves.toMatchObject({ scope: 'FULL' });
  });

  it('gives up after the lock timeout, and releases the idempotency key', async () => {
    // **The second assertion is the one that matters**, and it is why the code is a
    // 5xx rather than a 409. Section 22 stores a 4xx against the key and releases
    // it on a 5xx, because the first is a decision and the second is not.
    // Contention reached no decision, so storing it would answer every later retry
    // of that key with the same transient failure for the whole retention — the
    // dead end the release rule exists to prevent.
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();

    const key = randomUUID();
    const body = {
      sex: 'FEMALE',
      reason: 'Sex entered in error at encoding.',
      pastoral_leader_id: grace.id,
    };

    try {
      await holder.query('BEGIN');
      await holdPersonLock(holder, mark.id);

      const refused = await request(app.getHttpServer())
        .put(`/api/v1/people/${mark.id}/sex`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body);

      expect(refused.status).toBe(503);
      expect(refused.body.error.code).toBe('RESOURCE_BUSY');

      await holder.query('ROLLBACK');

      // The same key again. If the failure had been stored, this replays the 503
      // forever; released, it executes and succeeds.
      const retried = await request(app.getHttpServer())
        .put(`/api/v1/people/${mark.id}/sex`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body);

      expect(retried.status).toBe(200);
      expect(retried.body.network).toBe('WOMENS');
    } finally {
      await holder.end();
    }
  });

  it('networks.changeWithin locks the person whose Network is changing', async () => {
    const networks = app.get(NetworksService);
    const database = app.get<Db>(DATABASE);

    await assertWaitsOnPersonKey(mark.id, () =>
      database.transaction().execute((trx) =>
        networks.changeWithin(trx, {
          personId: mark.id,
          toNetwork: 'WOMENS',
          effectiveAt: new Date(),
          backdated: false,
          actorId: admin.id,
          reason: 'Fixture: exercising the lock, not the correction.',
        }),
      ),
    );
  });

  it('hierarchy.openAssignmentWithin locks the leader it attaches to', async () => {
    const hierarchy = app.get(HierarchyService);
    const database = app.get<Db>(DATABASE);
    const newcomer = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

    await assertWaitsOnPersonKey(manuel.id, () =>
      database.transaction().execute((trx) =>
        hierarchy.openAssignmentWithin(trx, {
          personId: newcomer.id,
          leaderId: manuel.id,
          startedAt: new Date(),
        }),
      ),
    );
  });

  it('hierarchy.reassignWithin locks the leader it moves to', async () => {
    const hierarchy = app.get(HierarchyService);
    const database = app.get<Db>(DATABASE);
    const sibling = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, sibling.id, manuel.id, EPOCH);

    await assertWaitsOnPersonKey(mark.id, () =>
      database.transaction().execute((trx) =>
        hierarchy.reassignWithin(trx, {
          personId: sibling.id,
          leaderId: mark.id,
          effectiveAt: new Date(),
        }),
      ),
    );
  });

  it('POST /people locks the pastoral leader before validating them', async () => {
    // **The leader is deliberately invalid**, which is what makes this about the
    // ordering rather than about the lock. Validated before the lock — the shape
    // this path used to have — the request refuses immediately on the archived
    // leader and never waits. Validated after it, it blocks first, which is what
    // the probe sees. A valid leader would produce a waiter under either order and
    // pin nothing.
    const archived = await createPerson(db, {
      firstName: 'Rico',
      network: 'MENS',
      archived: true,
    });

    await assertWaitsOnPersonKey(archived.id, () =>
      request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          first_name: 'Nena',
          last_name: 'Testfixture',
          birth_date: '1990-04-11',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
          pastoral_leader_id: archived.id,
        }),
    );
  });

  it('computes the key the implementation actually takes', async () => {
    // **The pin the shared helper needs and cannot give itself.** Twenty-four copies of
    // the key expression were replaced by one in `test/setup/concurrency.ts`, which
    // removes the risk that seven files drift apart and leaves the risk that the one
    // remaining copy drifts from `lockPersonsWithin`.
    //
    // **It is not the only case that would fail if they diverged — it is the only one
    // that would say so.** Nine of the eleven cases here take a person lock and eight go
    // red on a divergence; the ninth takes one that nothing observes. What none of the
    // eight does is name the key, because each fails against its own assertion. This one
    // compares the two keys, so the fault has a name.
    //
    // *Three earlier versions of this comment described *how* the eight fail — silently,
    // then as a twenty-second hang, then in three seconds — and all three were wrong,
    // because the eight do not fail alike. The claim is now the one that holds across
    // them, and the timings are left to whoever reads a failure.*
    //
    // **The canonicalization is pinned on both sides, and the first version pinned it on
    // neither.** `hashtextextended` is case-sensitive while a `uuid` comparison is not,
    // so `::uuid::text` is what makes one identifier one lock however a client spells it
    // — the hazard `person-lock.ts` names, and iOS emits uppercase UUIDs by default.
    // Handing both sides the same lowercase string agrees whether or not either
    // canonicalizes: measured against this database, `hashtextextended($1::text, 0)` and
    // `hashtextextended($1, 0)` return the *identical* key to the implementation for a
    // lowercase id. So dropping the cast from either side went unnoticed, and a mutation
    // run against the first version confirmed it. The two assertions below hand the two
    // sides different spellings, one each way.
    const database = app.get<Db>(DATABASE);
    const probe = new Client({ connectionString: process.env.DATABASE_URL });
    await probe.connect();

    // Released by the test rather than by a timer, so nothing here races a clock.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const inTransaction = track(
      database.transaction().execute(async (trx) => {
        // Uppercase deliberately: see the canonicalization paragraph above.
        await lockPersonsWithin(trx, [mark.id.toUpperCase()]);
        await held;
      }),
    );

    try {
      const key = await personLockKey(probe, mark.id);

      // **The helper canonicalizes.** Two spellings of one identifier must reach one
      // key; without the `::uuid` cast they do not, and nothing else here would notice.
      expect(await personLockKey(probe, mark.id.toUpperCase())).toBe(key);

      // Bounded by the attempt, like every other probe here — but unlike the others,
      // **nothing bounds the attempt itself**: the transaction above waits on `held`
      // rather than on a lock, so if this poll never finds the key it reaches
      // `countWhileInFlight`'s backstop rather than settling, and throws there inside
      // the case timeout.
      //
      // *That is a property of this case, not an account of what a divergence does to
      // it. The canonicalization drift the paragraph above describes is caught by the
      // assertion two lines up and never reaches this poll at all.*
      //
      // **The implementation canonicalizes**, which this pins because the transaction
      // above was given the *uppercase* spelling while `key` was computed from the
      // lowercase one. Drop the cast inside `lockPersonsWithin` and it locks the hash of
      // an uppercase string, which is not this key, and no holder is ever found.
      const holders = await countWhileInFlight(
        () => countAdvisoryHolders(probe, key),
        inTransaction,
        "the implementation to hold the helper's key",
      );

      expect(holders).toBeGreaterThan(0);
    } finally {
      // **Released in `finally`, and the first version of this case released it after
      // the assertion.** That leaks on any failure: the transaction never resolves, its
      // backend sits `idle in transaction` holding the advisory lock, and jest hangs on
      // an open handle rather than reporting the failure. Found by running the mutation
      // below — which is the point of running one, since a case that hangs instead of
      // failing tells you nothing about what it was checking.
      release();
      await inTransaction.done;
      await probe.end();
    }
  });

  it('takes several keys in ascending key order, whatever order it was given them', async () => {
    // The ordering rule of section 5, which nothing pinned: it is what stops two
    // callers acquiring the same pair in opposite orders and deadlocking, with
    // PostgreSQL rather than us choosing the victim.
    //
    // Asserted by holding the **higher** of the two keys. Ordered, the call takes
    // the lower key first and is therefore *holding* it while it waits; unordered,
    // an argument list beginning with the higher key blocks immediately and holds
    // nothing. So the discriminating observation is a granted lock, not a waiting
    // one.
    const database = app.get<Db>(DATABASE);

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();

    const keyed = await Promise.all(
      [mark, grace].map(async (person) => ({
        id: person.id,
        key: await personLockKey(holder, person.id),
      })),
    );

    // Sorted here rather than by `ORDER BY key` in SQL, because the keys are what is
    // being compared and `personLockKey` returns them one at a time. `BigInt` rather
    // than a numeric sort: the key is a signed 64-bit value and `Number` loses
    // precision above 2^53, which would order two keys wrongly and pick the wrong one
    // to hold — silently, since the case would then assert against the other lock.
    const [lower, higher] = [...keyed].sort((a, b) => (BigInt(a.key) < BigInt(b.key) ? -1 : 1));

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', [higher.key]);

      // Given in the order that would be wrong if the helper trusted its caller.
      const inFlight = track(
        database.transaction().execute((trx) => lockPersonsWithin(trx, [higher.id, lower.id])),
      );

      // Same bound as the helper above, and for the same reason.
      const held = await countWhileInFlight(
        () => countAdvisoryHolders(holder, lower.key),
        inFlight,
        'the lower key to be held',
      );

      expect(held).toBeGreaterThan(0);

      await holder.query('ROLLBACK');
      await inFlight.done;
    } finally {
      await holder.end();
    }
  });

  it('PUT /people/{id}/sex reaches the destination leader key too', async () => {
    // Named for what it pins and no more. `reassignWithin` takes the destination
    // leader's key on its own, so this stays green with the correction's up-front
    // two-key call removed — that call exists for the ordering guarantee, which is
    // pinned by the case above rather than by this one.
    await assertWaitsOnPersonKey(grace.id, () =>
      request(app.getHttpServer())
        .put(`/api/v1/people/${mark.id}/sex`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        }),
    );
  });
});
