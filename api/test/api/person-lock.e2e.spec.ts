import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { DATABASE, type Db } from '../../src/database/database.module';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
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
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [personId]);

      const pending = attempt().then(
        () => undefined,
        // A refusal after the lock is acquired is fine and is not what this asserts.
        () => undefined,
      );

      let waiting = 0;
      const deadline = Date.now() + 15_000;

      while (Date.now() < deadline && waiting === 0) {
        const found = await holder.query<{ waiting: string }>(
          `SELECT count(*) AS waiting
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND NOT granted
              AND objsubid = 1
              AND classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
              AND objid::bigint = (hashtextextended($1, 0) & 4294967295)`,
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
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [mark.id]);

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
    // Through HTTP, because the ordering that matters on this path is lock before
    // check: validating the leader's Network first and locking afterwards leaves
    // the answer stale, and the write then fails at COMMIT as a constraint
    // violation rendered INTERNAL_ERROR rather than as an answer.
    await assertWaitsOnPersonKey(manuel.id, () =>
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
          pastoral_leader_id: manuel.id,
        }),
    );
  });

  it('PUT /people/{id}/sex locks both persons, in one call', async () => {
    // The correction takes both keys up front so the ordering guarantee holds
    // across the pair. Held on the *destination leader* here rather than on the
    // corrected person, so the case is not satisfied by the first key alone.
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
