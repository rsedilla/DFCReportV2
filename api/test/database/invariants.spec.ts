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

    it('passes a Network root, which has no leader to compare against', async () => {
      const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });

      await expect(assignTo(db, root.id, null)).resolves.toBeDefined();
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

  it('holds SENIOR_PASTOR to two accounts, as section 4 names two Persons', async () => {
    // The role carries Whole Church scope on people.manage_lifecycle,
    // people.manage_pastoral_assignment and audit.view. A third holder is the
    // widest authority in the church, handed to somebody the specification does
    // not name.
    const first = await accountFor(db, 'Oriel', 'MENS');
    const second = await accountFor(db, 'Geraldine', 'WOMENS');
    const third = await accountFor(db, 'Rico', 'MENS');

    await db
      .insertInto('account_roles')
      .values([
        { account_id: first, role: 'SENIOR_PASTOR' },
        { account_id: second, role: 'SENIOR_PASTOR' },
      ])
      .execute();

    await expect(
      db.insertInto('account_roles').values({ account_id: third, role: 'SENIOR_PASTOR' }).execute(),
    ).rejects.toThrow(/SENIOR_PASTOR/);

    // Revoking one makes room for another, which is how a succession happens.
    await db
      .updateTable('account_roles')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', first)
      .execute();

    await expect(
      db.insertInto('account_roles').values({ account_id: third, role: 'SENIOR_PASTOR' }).execute(),
    ).resolves.toBeDefined();
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
