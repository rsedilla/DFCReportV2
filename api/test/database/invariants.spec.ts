import { sql } from 'kysely';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson, EPOCH } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * The section 5 invariants, exercised against the database rather than against the
 * application.
 *
 * Service-layer checks are not sufficient on their own: the first data-fix script
 * written directly against the database bypasses every one of them. Every write
 * here goes straight to PostgreSQL, which is the point.
 */
describe('the database enforces the section 5 invariants', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('transaction isolation (section 24)', () => {
    it('runs at READ COMMITTED, which the after-the-lock decisions depend on', async () => {
      // Section 24 names it because correctness depends on it rather than merely
      // tolerating it. A reassignment takes the person lock and *then* decides
      // scope, invariant 4 and the floor; under READ COMMITTED each statement after
      // the lock takes a fresh snapshot and sees the transaction that held it
      // first. Under REPEATABLE READ the snapshot is taken by the transaction's
      // first statement — the key hashing inside the lock helper, before the lock —
      // and every check after it silently reverts to the state the request arrived
      // with, with nothing raised.
      //
      // Asserted inside a transaction, because that is where it governs, and read
      // from the server rather than from configuration this repository controls: a
      // deployment can set `default_transaction_isolation` and remove the guarantee
      // without touching any file here.
      const level = await db
        .transaction()
        .execute(
          async (trx) =>
            await sql<{ transaction_isolation: string }>`SHOW transaction_isolation`.execute(trx),
        );

      expect(level.rows[0].transaction_isolation).toBe('read committed');
    });
  });

  describe('invariant 3: at most one active pastoral assignment', () => {
    it('refuses a second open assignment for the same person', async () => {
      const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const other = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      await assignTo(db, person.id, leader.id);

      await expect(assignTo(db, person.id, other.id)).rejects.toThrow(
        /pastoral_assignments_one_active/,
      );
    });

    it('refuses the second of two concurrent writes', async () => {
      // A sequential test passes against application-layer checks alone and tells
      // you nothing about whether the index exists (docs/ROADMAP.md, Stage 2 risk).
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const first = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const second = await createPerson(db, { firstName: 'Rico', network: 'MENS' });

      const [a, b] = [await openClient(), await openClient()];

      try {
        await a.query('BEGIN');
        await b.query('BEGIN');

        await a.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [person.id, first.id, EPOCH],
        );

        // The second transaction blocks on the unique index until the first
        // commits, then fails. Both are in flight at once, which is the case the
        // index exists for.
        const blocked = b.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [person.id, second.id, EPOCH],
        );

        await a.query('COMMIT');
        await expect(blocked).rejects.toThrow(/pastoral_assignments_one_active/);
        await b.query('ROLLBACK');
      } finally {
        await a.end();
        await b.end();
      }

      const open = await db
        .selectFrom('pastoral_assignments')
        .select('id')
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toHaveLength(1);
    });

    it('gives a Network root a row of its own, carrying a null leader', async () => {
      // The name used to say "permits zero open assignments", which its own body
      // contradicted — the row is right here. Section 5 settled the two readings
      // on 2026-08-23: a root **is** a row with a null `leader_id`, and a Person
      // with no row at all is unassigned rather than a second root.
      const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
      await assignTo(db, root.id, null);

      const rows = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id'])
        .where('person_id', '=', root.id)
        .execute();

      expect(rows).toEqual([{ leader_id: null }]);
    });
  });

  describe('history is never deleted (principle 12)', () => {
    it('refuses a DELETE on each effective-dated table', async () => {
      // A DELETE was the one path around every constraint in the migration: both
      // same-Network triggers fire on insert and update, so removing a person's
      // current network row turns every open edge beneath them cross-Network
      // with nothing firing and nothing to revisit it.
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      await assignTo(db, person.id, leader.id);

      await expect(
        db.deleteFrom('network_assignments').where('person_id', '=', person.id).execute(),
      ).rejects.toThrow(/never deleted/);

      await expect(
        db.deleteFrom('pastoral_assignments').where('person_id', '=', person.id).execute(),
      ).rejects.toThrow(/never deleted/);

      await expect(
        db.deleteFrom('person_lifecycle').where('person_id', '=', person.id).execute(),
      ).rejects.toThrow(/never deleted/);
    });

    it('refuses a DELETE on the grant tables, which section 7 calls audit material', async () => {
      // "A grant is revoked by setting revoked_at, never by deleting the row. The
      // history of who could do what, and when, is part of the audit record."
      const account = await accountFor(db, 'Ester', 'WOMENS');

      await db.insertInto('account_roles').values({ account_id: account, role: 'ADMIN' }).execute();

      await db
        .insertInto('capability_grants')
        .values({
          account_id: account,
          capability: 'people.view_subtree',
          scope_type: 'WHOLE_CHURCH',
          read_only: true,
          reason: 'Exercising the no-delete rule.',
          granted_by: account,
        })
        .execute();

      await expect(
        db.deleteFrom('account_roles').where('account_id', '=', account).execute(),
      ).rejects.toThrow(/never deleted/);

      await expect(
        db.deleteFrom('capability_grants').where('account_id', '=', account).execute(),
      ).rejects.toThrow(/never deleted/);
    });

    it('leaves the row and the edge intact after a refused DELETE', async () => {
      const person = await createPerson(db, { firstName: 'Bea', network: 'WOMENS' });

      await expect(
        db.deleteFrom('network_assignments').where('person_id', '=', person.id).execute(),
      ).rejects.toThrow();

      const rows = await db
        .selectFrom('network_assignments')
        .select('network')
        .where('person_id', '=', person.id)
        .execute();

      expect(rows).toEqual([{ network: 'WOMENS' }]);
    });
  });

  describe('invariant 4: no self-assignment', () => {
    it('refuses a row pointing at itself, which would be a one-node cycle', async () => {
      const person = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      await expect(assignTo(db, person.id, person.id)).rejects.toThrow(
        /pastoral_assignments_no_self/,
      );
    });
  });

  describe('invariant 5: the edge does not cross Networks', () => {
    it('refuses a cross-Network edge, at commit', async () => {
      const leader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      const client = await openClient();
      try {
        await client.query('BEGIN');

        // The insert itself succeeds: the trigger is deferred to commit, so this
        // is where a per-statement trigger and a deferred one visibly differ.
        await client.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [person.id, leader.id, EPOCH],
        );

        await expect(client.query('COMMIT')).rejects.toThrow(/crosses Networks/);
      } finally {
        await client.end();
      }

      const rows = await db.selectFrom('pastoral_assignments').select('id').execute();
      expect(rows).toHaveLength(0);
    });

    it('refuses a Network change that would leave a person under a leader in their former Network', async () => {
      const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      await assignTo(db, person.id, leader.id);

      const changedAt = new Date('2026-03-01T00:00:00+08:00');
      const client = await openClient();

      try {
        await client.query('BEGIN');
        await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
          changedAt,
          person.id,
        ]);
        await client.query(
          'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
          [person.id, 'WOMENS', changedAt],
        );

        await expect(client.query('COMMIT')).rejects.toThrow(/crossing Networks/);
      } finally {
        await client.end();
      }
    });

    it('permits a Network change performed together with the reassignment it forces', async () => {
      // Section 4 requires exactly this: neither half can validly precede the
      // other, so the deferred trigger sees only the final state.
      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      await assignTo(db, person.id, mensLeader.id);

      const changedAt = new Date('2026-03-01T00:00:00+08:00');
      const client = await openClient();

      try {
        await client.query('BEGIN');
        await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
          changedAt,
          person.id,
        ]);
        await client.query(
          'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
          [person.id, 'WOMENS', changedAt],
        );
        await client.query(
          'UPDATE pastoral_assignments SET ended_at = $1 WHERE person_id = $2 AND ended_at IS NULL',
          [changedAt, person.id],
        );
        await client.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [person.id, womensLeader.id, changedAt],
        );

        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      const open = await db
        .selectFrom('pastoral_assignments')
        .select('leader_id')
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ leader_id: womensLeader.id }]);
    });

    it('refuses a Network change backdated before an assignment that begins after it', async () => {
      // records.backdate_effective_date lets Admin set an effective date in the
      // past, so an assignment can begin after the date a Network correction takes
      // effect. Considering only what was open at that date would let this commit
      // and leave a permanent cross-Network edge that no later write revisits.
      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      const assignedAt = new Date('2026-06-01T00:00:00+08:00');
      const correctedFrom = new Date('2026-04-01T00:00:00+08:00');

      await assignTo(db, person.id, mensLeader.id, assignedAt);

      const client = await openClient();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
          correctedFrom,
          person.id,
        ]);
        await client.query(
          'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
          [person.id, 'WOMENS', correctedFrom],
        );

        await expect(client.query('COMMIT')).rejects.toThrow(/crossing Networks/);
      } finally {
        await client.end();
      }
    });

    it('refuses a Network change that strands the person own disciples', async () => {
      // The leader_id half of the trigger's WHERE clause, which had no test at
      // all until now -- every other case here puts the corrected person on the
      // person_id side. That is the half whose absence from SKILL.md produced the
      // original backdate-floor defect, so it is pinned rather than described.
      //
      // Nothing about the disciple changes. The leader's Network is corrected,
      // and the edge beneath them becomes cross-Network with no row of the
      // disciple's own being written -- which is exactly why the check has to
      // reach downward as well as upward.
      const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const disciple = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      await assignTo(db, disciple.id, leader.id);

      const changedAt = new Date('2026-03-01T00:00:00+08:00');
      const client = await openClient();

      try {
        await client.query('BEGIN');
        await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
          changedAt,
          leader.id,
        ]);
        await client.query(
          'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
          [leader.id, 'WOMENS', changedAt],
        );

        await expect(client.query('COMMIT')).rejects.toThrow(/crossing Networks/);
      } finally {
        await client.end();
      }
    });

    it('passes a Network root, which has no leader to compare against', async () => {
      const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });

      await expect(assignTo(db, root.id, null)).resolves.toBeDefined();
    });

    it('refuses a Network change whose reassignment lands a moment later', async () => {
      // Section 4: the two carry one effective instant, and it is the same
      // instant. Separating them by a microsecond leaves the old edge open at the
      // effective date, where it is compared with the corrected Network in force
      // on one end and the old one on the other -- which is what it genuinely was
      // for that microsecond.
      //
      // This is the case an implementer meets as a constraint violation and is
      // tempted to "fix" by moving the timestamps further apart. Pinned so the
      // fix has to be the other one.
      const mensLeader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const womensLeader = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      await assignTo(db, person.id, mensLeader.id);

      const changedAt = new Date('2026-03-01T00:00:00+08:00');
      const aMomentLater = new Date(changedAt.getTime() + 1);
      const client = await openClient();

      try {
        await client.query('BEGIN');
        await client.query('UPDATE network_assignments SET ended_at = $1 WHERE person_id = $2', [
          changedAt,
          person.id,
        ]);
        await client.query(
          'INSERT INTO network_assignments (person_id, network, started_at) VALUES ($1, $2, $3)',
          [person.id, 'WOMENS', changedAt],
        );
        await client.query(
          'UPDATE pastoral_assignments SET ended_at = $1 WHERE person_id = $2 AND ended_at IS NULL',
          [aMomentLater, person.id],
        );
        await client.query(
          'INSERT INTO pastoral_assignments (person_id, leader_id, started_at) VALUES ($1, $2, $3)',
          [person.id, womensLeader.id, aMomentLater],
        );

        await expect(client.query('COMMIT')).rejects.toThrow(/crossing Networks/);
      } finally {
        await client.end();
      }
    });
  });

  describe('a row entered in error is closed at zero length (section 5)', () => {
    it('permits ended_at equal to started_at on every effective-dated table', async () => {
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
      const leader = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      // The correction section 5 prescribes: close the wrong row, open the right
      // one. The strict `>` this replaced allowed only closing it a moment later,
      // which records a non-zero period of a fact that was never true.
      await expect(
        db
          .updateTable('person_lifecycle')
          .set({ ended_at: EPOCH })
          .where('person_id', '=', person.id)
          .where('ended_at', 'is', null)
          .execute(),
      ).resolves.toBeDefined();

      await expect(
        db
          .updateTable('network_assignments')
          .set({ ended_at: EPOCH })
          .where('person_id', '=', person.id)
          .where('ended_at', 'is', null)
          .execute(),
      ).resolves.toBeDefined();

      const assignmentId = await assignTo(db, leader.id, null);
      await expect(
        db
          .updateTable('pastoral_assignments')
          .set({ ended_at: EPOCH })
          .where('id', '=', assignmentId)
          .execute(),
      ).resolves.toBeDefined();
    });

    it('still refuses a row that ends before it starts', async () => {
      // `>=` relaxes the boundary, not the ordering. A row ending before it began
      // is a defect at any width.
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      await expect(
        db
          .updateTable('network_assignments')
          .set({ ended_at: new Date(EPOCH.getTime() - 1) })
          .where('person_id', '=', person.id)
          .where('ended_at', 'is', null)
          .execute(),
      ).rejects.toThrow(/network_assignments_period_ordered/);
    });

    it('leaves a zero-length row invisible to network_as_of, at its own instant and after', async () => {
      // The property the ruling rests on. An as-of lookup asks for
      // `started_at <= t AND ended_at > t`, and no `t` satisfies both.
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      await db
        .updateTable('network_assignments')
        .set({ ended_at: EPOCH })
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();

      const client = await openClient();
      try {
        for (const at of [EPOCH, new Date(EPOCH.getTime() + 1), new Date()]) {
          const { rows } = await client.query<{ network: string | null }>(
            'SELECT network_as_of($1, $2) AS network',
            [person.id, at],
          );
          expect(rows[0].network).toBeNull();
        }
      } finally {
        await client.end();
      }
    });

    it('leaves the one-open-row index free, so the corrected row can be opened', async () => {
      // A zero-length row has `ended_at` set, and every one of those indexes is
      // partial over `ended_at IS NULL`. Closing a row in error therefore never
      // blocks opening the right one in its place.
      const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

      await db
        .updateTable('network_assignments')
        .set({ ended_at: EPOCH })
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();

      await expect(
        db
          .insertInto('network_assignments')
          .values({ person_id: person.id, network: 'WOMENS', started_at: EPOCH })
          .execute(),
      ).resolves.toBeDefined();

      const open = await db
        .selectFrom('network_assignments')
        .select('network')
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ network: 'WOMENS' }]);
    });
  });
});

describe('the database enforces the section 3 and section 7 rules it can', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('assigns a Member ID from the sequence and refuses to let it change', async () => {
    const person = await createPerson(db, { firstName: 'Mark', network: 'MENS' });

    const row = await db
      .selectFrom('persons')
      .select('member_id')
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();

    expect(row.member_id).toMatch(/^M-\d{6}$/);

    await expect(
      db
        .updateTable('persons')
        .set({ member_id: 'M-000001' })
        .where('id', '=', person.id)
        .execute(),
    ).rejects.toThrow(/immutable/);
  });

  it('holds SENIOR_PASTOR to the two slots section 4 implies', async () => {
    const first = await accountFor(db, 'Oriel', 'MENS');
    const second = await accountFor(db, 'Geraldine', 'WOMENS');
    const third = await accountFor(db, 'Rico', 'MENS');

    await db
      .insertInto('account_roles')
      .values([
        { account_id: first, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 },
        { account_id: second, role: 'SENIOR_PASTOR', senior_pastor_slot: 2 },
      ])
      .execute();

    // There is no third slot to occupy.
    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: third, role: 'SENIOR_PASTOR', senior_pastor_slot: 3 })
        .execute(),
    ).rejects.toThrow(/account_roles_slot_belongs_to_the_role/);

    // And neither of the two may be occupied twice.
    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: third, role: 'SENIOR_PASTOR', senior_pastor_slot: 2 })
        .execute(),
    ).rejects.toThrow(/account_roles_one_senior_pastor_per_slot/);

    // Revoking frees the slot, which is how a succession happens.
    //
    // `now()`, not `new Date()`: `granted_at` is stamped by the database, and
    // `account_roles_period_ordered` requires `revoked_at >= granted_at`. A
    // JavaScript timestamp compares two clocks, so when the database's runs
    // microseconds ahead the constraint fires and this step fails on the ordering
    // rather than on the cap it is testing. The same trap took out the guard's
    // revocation case, and this is its closest sibling — same constraint family,
    // same margin.
    await db
      .updateTable('account_roles')
      .set({ revoked_at: sql<Date>`now()` })
      .where('account_id', '=', second)
      .execute();

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: third, role: 'SENIOR_PASTOR', senior_pastor_slot: 2 })
        .execute(),
    ).resolves.toBeDefined();
  });

  it('refuses a third SENIOR_PASTOR under concurrent writes', async () => {
    // A unique index holds where a counting check does not: under READ COMMITTED
    // neither transaction would see the other's uncommitted row, so a count would
    // pass twice. This is authorization case 7 applied to the role cap, and it is
    // why the cap is an index rather than a trigger that counts.
    const holder = await accountFor(db, 'Oriel', 'MENS');
    const first = await accountFor(db, 'Ester', 'WOMENS');
    const second = await accountFor(db, 'Nora', 'WOMENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: holder, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
      .execute();

    const [a, b] = [await openClient(), await openClient()];

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await a.query(
        'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 2)',
        [first, 'SENIOR_PASTOR'],
      );

      // **Read before `b` is blocked, never after.** `pg` does not pipeline: a
      // query issued on a connection with a statement in flight sits in that
      // client's queue until the first one returns, so asking the blocked
      // connection for its own pid cannot be answered until the transaction it is
      // waiting on commits -- which is the line below. That deadlocks the case and,
      // on the Jest timeout, abandons both open transactions for the next
      // `TRUNCATE` to block on forever.
      const blockedPid = await backendPid(b);

      const blocked = settled(
        b.query(
          'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 2)',
          [second, 'SENIOR_PASTOR'],
        ),
      );

      // Observed rather than assumed. This case predates the governing-role rule
      // and had the same gap, so it is corrected with it rather than left as the
      // one instance of the class nobody looked for.
      expect(await waitUntilBlocked(a, blockedPid)).toBeGreaterThan(0);

      await a.query('COMMIT');
      expect((await blocked)?.message).toMatch(/account_roles_one_senior_pastor_per_slot/);
      await b.query('ROLLBACK');
    } finally {
      await a.end();
      await b.end();
    }

    const active = await db
      .selectFrom('account_roles')
      .select('id')
      .where('role', '=', 'SENIOR_PASTOR')
      .where('revoked_at', 'is', null)
      .execute();

    expect(active).toHaveLength(2);
  });

  /**
   * Grant one capability to an account, returning the insert promise unawaited so
   * a caller can observe it blocking.
   */
  function grant(
    accountId: string,
    capability:
      | 'roles.manage'
      | 'accounts.manage'
      | 'people.merge'
      | 'people.correct_sex'
      | 'settings.manage'
      | 'cell.approve_creation'
      | 'records.backdate_effective_date',
  ) {
    return db
      .insertInto('capability_grants')
      .values({
        account_id: accountId,
        capability,
        scope_type: 'WHOLE_CHURCH',
        scope_network: null,
        read_only: false,
        reason: 'Exercising the section 7 grant limit.',
        granted_by: accountId,
      })
      .execute();
  }

  it('refuses a grant-making capability to a Senior Pastor, both of them', async () => {
    // Section 7: `roles.manage` and `accounts.manage` are never held by an account
    // holding SENIOR_PASTOR, however granted. This is the route migration 0005's
    // index does not reach -- no ADMIN row exists here.
    const oriel = await accountFor(db, 'Oriel', 'MENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: oriel, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
      .execute();

    await expect(grant(oriel, 'roles.manage')).rejects.toThrow(/may not be granted/);
    await expect(grant(oriel, 'accounts.manage')).rejects.toThrow(/may not be granted/);
  });

  it('refuses SENIOR_PASTOR to an account that already makes grants', async () => {
    // The mirror, and the reason there are two triggers. Enforcing on grants alone
    // is walkable in this order: grant first, add the role second.
    const account = await accountFor(db, 'Ester', 'WOMENS');

    await grant(account, 'accounts.manage');

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: account, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
        .execute(),
    ).rejects.toThrow(/may not hold SENIOR_PASTOR/);
  });

  it('permits the withheld capabilities that are not grant-making', async () => {
    // **The half that makes this a line rather than a ban**, and the mutation that
    // matters: a rule widened to every capability the section 7 table withholds
    // would refuse these and pass every case above.
    //
    // `people.correct_sex` is here deliberately. A first version of this branch
    // filed it among the capabilities section 7 argues nowhere, which is false --
    // section 7 argues it on the same ground as `people.merge`, that it moves
    // totals for periods already reported. Neither is self-perpetuating, which is
    // why neither is refused.
    const oriel = await accountFor(db, 'Oriel', 'MENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: oriel, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
      .execute();

    // All five, not a sample. The TypeScript set is pinned exactly in
    // `grant-making.spec.ts`; this is the hand-kept SQL copy in `is_grant_making`,
    // which is the half that can drift, so it gets the exact assertion too.
    for (const capability of [
      'people.merge',
      'people.correct_sex',
      'records.backdate_effective_date',
      'settings.manage',
      'cell.approve_creation',
    ] as const) {
      await expect(grant(oriel, capability)).resolves.toBeDefined();
    }
  });

  it('lets a revoked grant free the account, which is how one is undone', async () => {
    const account = await accountFor(db, 'Ester', 'WOMENS');

    await grant(account, 'roles.manage');

    await db
      .updateTable('capability_grants')
      .set({ revoked_at: sql<Date>`now()` })
      .where('account_id', '=', account)
      .execute();

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: account, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
        .execute(),
    ).resolves.toBeDefined();
  });

  it('takes the account lock before it decides, which is what closes the race', async () => {
    // **The property, pinned directly, because the race itself cannot be observed
    // reliably.** Two transactions writing the role and the grant fire their
    // deferred triggers at COMMIT; each sees only its own state, so without a lock
    // both look, find nothing, and commit. Firing two and hoping to catch the
    // overlap passes against no lock at all nearly every run -- which is the
    // shape CLAUDE.md's 2026-08-23 person-lock ruling rejects.
    //
    // So a third connection holds `FOR NO KEY UPDATE` on the account, and the
    // assertion is that a commit which must take that lock **waits**. Remove the
    // PERFORM from the role-side trigger and nothing waits here; the grant side
    // has a case of its own below, because this one writes no grant and an earlier
    // version claimed it covered both.
    const account = await accountFor(db, 'Oriel', 'MENS');

    const [holder, writer] = [await openClient(), await openClient()];

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [account]);

      const writerPid = await backendPid(writer);

      await writer.query('BEGIN');
      await writer.query(
        'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 1)',
        [account, 'SENIOR_PASTOR'],
      );

      // The trigger is deferred, so the insert returns and the lock is taken by
      // the COMMIT. Dispatched unawaited, because it is expected to block.
      const commit = settled(writer.query('COMMIT'));

      expect(await waitUntilBlocked(holder, writerPid)).toBeGreaterThan(0);

      await holder.query('ROLLBACK');

      // Nothing conflicts once the lock is free, so the commit completes.
      expect(await commit).toBeNull();
    } finally {
      await holder.end();
      await writer.end();
    }

    const roles = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(roles).toEqual([{ role: 'SENIOR_PASTOR' }]);
  });

  it('takes the account lock on the grant side too', async () => {
    // The mirror of the case above, and it exists because the claim that one case
    // covered both triggers was false: that one writes only `account_roles`, so
    // deleting the PERFORM from the grant-side trigger left it green.
    const account = await accountFor(db, 'Ester', 'WOMENS');

    const [holder, writer] = [await openClient(), await openClient()];

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [account]);

      const writerPid = await backendPid(writer);

      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO capability_grants
           (account_id, capability, scope_type, read_only, reason, granted_by)
         VALUES ($1, 'roles.manage', 'WHOLE_CHURCH', false, 'Exercising the lock.', $1)`,
        [account],
      );

      const commit = settled(writer.query('COMMIT'));

      expect(await waitUntilBlocked(holder, writerPid)).toBeGreaterThan(0);

      await holder.query('ROLLBACK');

      // The account holds no SENIOR_PASTOR row, so nothing conflicts once the lock
      // is free and the grant stands.
      expect(await commit).toBeNull();
    } finally {
      await holder.end();
      await writer.end();
    }

    const grants = await db
      .selectFrom('capability_grants')
      .select('capability')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(grants).toEqual([{ capability: 'roles.manage' }]);
  });

  it('lets only one of two concurrent writers end up holding the pair', async () => {
    // Whichever commits second is refused; which one that is depends on timing and
    // is deliberately not asserted. What must hold either way is that the account
    // does not end up with both, which is the rule itself.
    const account = await accountFor(db, 'Ester', 'WOMENS');

    const [a, b] = [await openClient(), await openClient()];

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await a.query(
        'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 1)',
        [account, 'SENIOR_PASTOR'],
      );

      await b.query(
        `INSERT INTO capability_grants
           (account_id, capability, scope_type, read_only, reason, granted_by)
         VALUES ($1, 'roles.manage', 'WHOLE_CHURCH', false, 'Concurrent write.', $1)`,
        [account],
      );

      const commits = [settled(a.query('COMMIT')), settled(b.query('COMMIT'))];
      const failures = (await Promise.all(commits)).filter((error) => error !== null);

      expect(failures).toHaveLength(1);
      expect(failures[0]?.message).toMatch(/SENIOR_PASTOR|may not be granted/);
    } finally {
      await a.end();
      await b.end();
    }

    const held = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    const granted = await db
      .selectFrom('capability_grants')
      .select('capability')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(held.length === 0 || granted.length === 0).toBe(true);
  });

  it('refuses one account both ADMIN and SENIOR_PASTOR', async () => {
    // Section 7: an account holds at most one of the two. Effective authority is
    // the union of its roles' defaults and ADMIN's set is a superset, so the pair
    // is not a Senior Pastor who also administers -- it is an account holding
    // every capability, for which every exclusion section 7 writes for the role is
    // void, and which holds `roles.manage` and can therefore retain the pair and
    // revoke anybody else's roles.
    const account = await accountFor(db, 'Oriel', 'MENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: account, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
      .execute();

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: account, role: 'ADMIN', senior_pastor_slot: null })
        .execute(),
    ).rejects.toThrow(/account_roles_one_governing_role/);

    // And in the other order, because a partial unique index is symmetric and a
    // check written per-role would not be.
    const other = await accountFor(db, 'Ester', 'WOMENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: other, role: 'ADMIN', senior_pastor_slot: null })
      .execute();

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: other, role: 'SENIOR_PASTOR', senior_pastor_slot: 2 })
        .execute(),
    ).rejects.toThrow(/account_roles_one_governing_role/);
  });

  it('permits LEADER beside a governing role, and a revoked row frees it', async () => {
    // The half that makes the rule a limit rather than a ban. LEADER confers
    // strictly less than either governing role and carries none of the excluded
    // capabilities, so it escalates nothing -- an index over every role would
    // forbid this and pass every case above, which is the mutation that matters.
    const account = await accountFor(db, 'Oriel', 'MENS');

    await db
      .insertInto('account_roles')
      .values([
        { account_id: account, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 },
        { account_id: account, role: 'LEADER', senior_pastor_slot: null },
      ])
      .execute();

    // Revoking the governing row frees the account for the other, which is how a
    // handover is recorded -- section 7 revokes rather than deletes.
    await db
      .updateTable('account_roles')
      .set({ revoked_at: sql<Date>`now()` })
      .where('account_id', '=', account)
      .where('role', '=', 'SENIOR_PASTOR')
      .execute();

    await db
      .insertInto('account_roles')
      .values({ account_id: account, role: 'ADMIN', senior_pastor_slot: null })
      .execute();

    const active = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(active.map((row) => row.role).sort()).toEqual(['ADMIN', 'LEADER']);
  });

  it('refuses a second governing role under concurrent writes', async () => {
    // Under READ COMMITTED neither transaction sees the other's uncommitted row,
    // so anything that counts first and writes second admits both. Only an index
    // makes the second write wait.
    const account = await accountFor(db, 'Oriel', 'MENS');

    const [a, b] = [await openClient(), await openClient()];

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await a.query(
        'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 1)',
        [account, 'SENIOR_PASTOR'],
      );

      // Read before the insert blocks this connection -- see the sibling case.
      const blockedPid = await backendPid(b);

      const blocked = settled(
        b.query(
          'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, NULL)',
          [account, 'ADMIN'],
        ),
      );

      // **Observed, not assumed**, which is the whole difference between this and
      // the sequential case above. Dispatching the second write and committing the
      // first passes on a run where the server happens to reach the commit first,
      // and passes with no index at all.
      expect(await waitUntilBlocked(a, blockedPid)).toBeGreaterThan(0);

      await a.query('COMMIT');
      expect((await blocked)?.message).toMatch(/account_roles_one_governing_role/);
      await b.query('ROLLBACK');
    } finally {
      await a.end();
      await b.end();
    }

    const active = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(active).toEqual([{ role: 'SENIOR_PASTOR' }]);
  });

  it('refuses SENIOR_PASTOR with no slot at all', async () => {
    // The case that matters most, and the one every other test here misses by
    // supplying a slot. A CHECK fails only on FALSE and passes on NULL, so a
    // constraint written without an explicit IS NOT NULL accepts this row -- and
    // null slots never conflict in the partial unique index, because nulls are
    // distinct. The cap would then permit any number of Senior Pastors.
    const first = await accountFor(db, 'Oriel', 'MENS');
    const second = await accountFor(db, 'Geraldine', 'WOMENS');
    const third = await accountFor(db, 'Rico', 'MENS');

    await db
      .insertInto('account_roles')
      .values([
        { account_id: first, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 },
        { account_id: second, role: 'SENIOR_PASTOR', senior_pastor_slot: 2 },
      ])
      .execute();

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: third, role: 'SENIOR_PASTOR', senior_pastor_slot: null })
        .execute(),
    ).rejects.toThrow(/account_roles_slot_belongs_to_the_role/);

    const active = await db
      .selectFrom('account_roles')
      .select('id')
      .where('role', '=', 'SENIOR_PASTOR')
      .where('revoked_at', 'is', null)
      .execute();

    expect(active).toHaveLength(2);
  });

  it('refuses a role changed into SENIOR_PASTOR without taking a slot', async () => {
    // The count can rise by an UPDATE as well as an INSERT, which is the ground
    // the counting trigger covered and a constraint must cover too.
    const account = await accountFor(db, 'Manuel', 'MENS');

    await db.insertInto('account_roles').values({ account_id: account, role: 'LEADER' }).execute();

    await expect(
      db
        .updateTable('account_roles')
        .set({ role: 'SENIOR_PASTOR' })
        .where('account_id', '=', account)
        .execute(),
    ).rejects.toThrow(/account_roles_slot_belongs_to_the_role/);

    const active = await db
      .selectFrom('account_roles')
      .select('role')
      .where('account_id', '=', account)
      .where('revoked_at', 'is', null)
      .execute();

    expect(active).toEqual([{ role: 'LEADER' }]);
  });

  it('refuses a Senior Pastor giving up their slot while still holding the role', async () => {
    const account = await accountFor(db, 'Oriel', 'MENS');

    await db
      .insertInto('account_roles')
      .values({ account_id: account, role: 'SENIOR_PASTOR', senior_pastor_slot: 1 })
      .execute();

    await expect(
      db
        .updateTable('account_roles')
        .set({ senior_pastor_slot: null })
        .where('account_id', '=', account)
        .execute(),
    ).rejects.toThrow(/account_roles_slot_belongs_to_the_role/);

    const row = await db
      .selectFrom('account_roles')
      .select('senior_pastor_slot')
      .where('account_id', '=', account)
      .executeTakeFirstOrThrow();

    expect(row.senior_pastor_slot).toBe(1);
  });

  it('records who granted a role, and permits no actor only for a system action', async () => {
    // Section 7 marks nullability explicitly, and `account_roles.granted_by` is
    // nullable for exactly one case: the first Admin account, which no account
    // above it could have granted. Nothing in the schema can tell the two apart,
    // so the column is at least exercised both ways here rather than never.
    const admin = await accountFor(db, 'Ester', 'WOMENS');
    const leader = await accountFor(db, 'Rico', 'MENS');

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: admin, role: 'ADMIN', granted_by: null })
        .execute(),
    ).resolves.toBeDefined();

    await db
      .insertInto('account_roles')
      .values({ account_id: leader, role: 'LEADER', granted_by: admin })
      .execute();

    const row = await db
      .selectFrom('account_roles')
      .select('granted_by')
      .where('account_id', '=', leader)
      .executeTakeFirstOrThrow();

    expect(row.granted_by).toBe(admin);
  });

  it('refuses a slot on a role that is not SENIOR_PASTOR', async () => {
    const account = await accountFor(db, 'Manuel', 'MENS');

    await expect(
      db
        .insertInto('account_roles')
        .values({ account_id: account, role: 'LEADER', senior_pastor_slot: 1 })
        .execute(),
    ).rejects.toThrow(/account_roles_slot_belongs_to_the_role/);
  });

  it('refuses a read-only grant of a write capability', async () => {
    const person = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    const account = await db
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email: 'grants@example.test',
        email_normalized: 'grants@example.test',
        password_hash: 'placeholder',
        status: 'ACTIVE',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(
      db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: 'people.manage_pastoral_assignment',
          scope_type: 'WHOLE_CHURCH',
          read_only: true,
          reason: 'Exercising the read_only rule.',
          granted_by: account.id,
        })
        .execute(),
    ).rejects.toThrow(/capability_grants_read_only_is_a_read/);

    // The same grant as a real grant is accepted.
    await expect(
      db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: 'people.manage_pastoral_assignment',
          scope_type: 'WHOLE_CHURCH',
          read_only: false,
          reason: 'Exercising the read_only rule.',
          granted_by: account.id,
        })
        .execute(),
    ).resolves.toBeDefined();
  });
});

async function accountFor(
  db: Kysely<Database>,
  firstName: string,
  network: 'MENS' | 'WOMENS',
): Promise<string> {
  const person = await createPerson(db, { firstName, network });
  const email = `${firstName.toLowerCase()}.${person.id.slice(0, 8)}@example.test`;

  const account = await db
    .insertInto('accounts')
    .values({
      person_id: person.id,
      email,
      email_normalized: email,
      password_hash: 'placeholder',
      status: 'ACTIVE',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return account.id;
}

/**
 * The backend process id behind a client, for observing what it is waiting on.
 */
async function backendPid(client: Client): Promise<number> {
  const row = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  return row.rows[0].pid;
}

/**
 * Waits until `pid` is blocked on a lock, and answers how many it is waiting for.
 *
 * **Dispatching a conflicting statement is not the same as observing it block**,
 * and the difference decides whether a concurrency case pins anything. Firing the
 * second write and immediately committing the first passes on any run where the
 * server reaches the commit first — and passes with no index at all, because the
 * second write then simply succeeds and every assertion about the first
 * transaction's row still holds. The discriminating observation is a backend
 * waiting while the other transaction is still open, which is how SKILL.md
 * section 5's lock ordering is pinned in `person-lock.e2e.spec.ts`.
 *
 * **Two arguments, two rules, and the second is the one that bit.** The observer
 * must be a connection other than the blocked one, which is why callers pass the
 * transaction holding the conflicting row -- it is idle in its transaction and can
 * still answer a read. And the pid must be read from the blocked connection
 * *before* it is blocked: `pg` does not pipeline, so a query issued on a connection
 * with a statement in flight waits in that client's queue until the first returns,
 * and asking a blocked connection for its own pid therefore cannot be answered
 * until the transaction it waits on commits. The first version did exactly that and
 * deadlocked both cases.
 *
 * `person-lock.e2e.spec.ts` avoids the question by identifying the waiter by lock
 * *target* -- an advisory key it computes itself -- and never querying the blocked
 * connection at all. Reusing "poll pg_locks" without re-deriving how the waiter is
 * identified is section 25 rule 19, in the batch that cited that precedent.
 *
 * It counts any ungranted lock held by the pid rather than the specific index wait,
 * which is looser than the precedent's predicate and sufficient here: the
 * transactions are two statements long and hold nothing else contended.
 */
async function waitUntilBlocked(observer: Client, pid: number): Promise<number> {
  const deadline = Date.now() + 2_500;
  let waiting = 0;

  while (Date.now() < deadline && waiting === 0) {
    const found = await observer.query<{ waiting: string }>(
      'SELECT count(*) AS waiting FROM pg_locks WHERE pid = $1 AND NOT granted',
      [pid],
    );

    waiting = Number(found.rows[0].waiting);
    if (waiting === 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return waiting;
}

/**
 * The error a promise rejected with, or null where it resolved.
 *
 * Awaiting a rejection only *after* another statement can leave it unhandled if
 * that statement throws first, which takes down the run with a failure that names
 * neither test.
 */
async function settled(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: Error) => error,
  );
}

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
