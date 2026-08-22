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

    it('permits zero open assignments, which is legitimate for a Network root', async () => {
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
    await db
      .updateTable('account_roles')
      .set({ revoked_at: new Date() })
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

      const blocked = b.query(
        'INSERT INTO account_roles (account_id, role, senior_pastor_slot) VALUES ($1, $2, 2)',
        [second, 'SENIOR_PASTOR'],
      );

      await a.query('COMMIT');
      await expect(blocked).rejects.toThrow(/account_roles_one_senior_pastor_per_slot/);
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

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
