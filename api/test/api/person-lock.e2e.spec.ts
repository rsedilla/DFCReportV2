import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { sql } from 'kysely';

import { DATABASE, type Db } from '../../src/database/database.module';
import { lockPersonsWithin } from '../../src/database/person-lock';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { PeopleService } from '../../src/people/people.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp, EPOCH } from '../setup/fixtures';

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
 */
describe('the person lock is taken by every path that can strand an edge', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let manuel: TestPerson;
  let mark: TestPerson;
  let grace: TestPerson;
  let geraldine: TestPerson;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
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
   * The key is recomputed in SQL from the person id rather than passed in, so the
   * probe agrees with the implementation by construction — if the two ever diverge,
   * the probe stops finding a waiter and the case fails rather than passing quietly.
   */
  async function assertWaitsOnPersonKey(
    personId: string,
    attempt: () => Promise<unknown>,
  ): Promise<void> {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
        personId,
      ]);

      const pending = attempt().then(
        () => undefined,
        // A refusal after the lock is acquired is fine and is not what this asserts.
        () => undefined,
      );

      let waiting = 0;
      // Shorter than the lock timeout the code under test sets, because past that
      // the waiter is gone and no later poll can succeed. A deadline beyond it
      // would spend the difference failing.
      const deadline = Date.now() + 2_500;

      while (Date.now() < deadline && waiting === 0) {
        const found = await holder.query<{ waiting: string }>(
          `SELECT count(*) AS waiting
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND NOT granted
              AND objsubid = 1
              AND classid::bigint = ((hashtextextended($1::uuid::text, 0) >> 32) & 4294967295)
              AND objid::bigint = (hashtextextended($1::uuid::text, 0) & 4294967295)`,
          [personId],
        );

        waiting = Number(found.rows[0].waiting);
        if (waiting === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      expect(waiting).toBeGreaterThan(0);

      await holder.query('ROLLBACK');
      await pending;
    } finally {
      await holder.end();
    }
  }

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
      hierarchy.assertMayReparent({ personId: mark.id, roles: ['LEADER'] }, mark.id.toUpperCase()),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

    await expect(
      hierarchy.assertMayReparent(
        { personId: mark.id, roles: ['LEADER'] },
        manuel.id.toUpperCase(),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });

    // And it still permits what it should, so the case is not satisfied by a check
    // that refuses everything.
    await expect(
      hierarchy.assertMayReparent({ personId: manuel.id, roles: ['LEADER'] }, mark.id),
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
      pastoralLeaderId: manuel.id,
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
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
        mark.id,
      ]);

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

    const ordered = await sql<{ id: string; key: string }>`
      SELECT id, hashtextextended(id::uuid::text, 0) AS key
        FROM unnest(ARRAY[${sql.join([mark.id, grace.id])}]::text[]) AS id
       ORDER BY key
    `.execute(db);

    const lower = ordered.rows[0];
    const higher = ordered.rows[1];

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', [higher.key]);

      // Given in the order that would be wrong if the helper trusted its caller.
      const pending = database
        .transaction()
        .execute((trx) => lockPersonsWithin(trx, [higher.id, lower.id]))
        .then(
          () => undefined,
          () => undefined,
        );

      let held = 0;
      const deadline = Date.now() + 2_500;

      while (Date.now() < deadline && held === 0) {
        const found = await holder.query<{ held: string }>(
          `SELECT count(*) AS held
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND granted
              AND objsubid = 1
              AND classid::bigint = (($1::bigint >> 32) & 4294967295)
              AND objid::bigint = ($1::bigint & 4294967295)`,
          [lower.key],
        );

        held = Number(found.rows[0].held);
        if (held === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      expect(held).toBeGreaterThan(0);

      await holder.query('ROLLBACK');
      await pending;
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
