import { sql } from 'kysely';
import { Client } from 'pg';

import { DATABASE, type Db } from '../../src/database/database.module';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestPerson } from '../setup/fixtures';

/**
 * The current tree in memory (SKILL.md section 24, decision 0321): the tests that section
 * names. A read on the application's pool may be answered from the copy; the same read on a
 * transaction always walks the database, which is how each case compares the two.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the current tree in memory (section 24, decision 0321)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let pool: Db;
  let hierarchy: HierarchyService;

  // raymond (Men's root) -> manuel, ben; manuel -> mark, nico; mark -> dante.
  // oriel (Women's root) -> grace. felix holds no row at all.
  let raymond: TestPerson;
  let manuel: TestPerson;
  let ben: TestPerson;
  let mark: TestPerson;
  let nico: TestPerson;
  let dante: TestPerson;
  let oriel: TestPerson;
  let grace: TestPerson;
  let felix: TestPerson;
  let everyone: TestPerson[];

  /** The same question asked of the database: a read on a transaction never uses the copy. */
  const fromDatabase = <T>(read: (executor: Db) => Promise<T>): Promise<T> =>
    pool.transaction().execute((trx) => read(trx));

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    pool = app.get<Db>(DATABASE);
    hierarchy = app.get(HierarchyService);
  });

  beforeEach(async () => {
    await truncateAll(db);
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    nico = await createPerson(db, { firstName: 'Nico', network: 'MENS' });
    dante = await createPerson(db, { firstName: 'Dante', network: 'MENS' });
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'WOMENS' });
    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    felix = await createPerson(db, { firstName: 'Felix', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, ben.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, nico.id, manuel.id);
    await assignTo(db, dante.id, mark.id);
    await assignTo(db, oriel.id, null);
    await assignTo(db, grace.id, oriel.id);
    everyone = [raymond, manuel, ben, mark, nico, dante, oriel, grace, felix];
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** A subtree compared as the database orders it: the person first, then by depth. */
  async function expectSameSubtree(person: TestPerson): Promise<void> {
    const memory = await hierarchy.subtreeOf(pool, person.id);
    const database = await fromDatabase((executor) => hierarchy.subtreeOf(executor, person.id));
    expect(memory[0]).toBe(database[0]);
    expect([...memory].sort()).toEqual([...database].sort());
    // By depth, as the database orders it: each person's distance below the seed, read
    // from the database walk upward, never decreases along the copy's answer.
    const depths: number[] = [];
    for (const id of memory) {
      const leaders = await fromDatabase((executor) => hierarchy.ancestorsOf(executor, id));
      depths.push(id === memory[0] ? 0 : leaders.indexOf(memory[0]) + 1);
    }
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  }

  it('answers every question exactly as the database walk does', async () => {
    for (const person of everyone) {
      await expectSameSubtree(person);
      expect(await hierarchy.ancestorsOf(pool, person.id)).toEqual(
        await fromDatabase((executor) => hierarchy.ancestorsOf(executor, person.id)),
      );
      for (const other of everyone) {
        for (const includeSelf of [true, false]) {
          expect(await hierarchy.isWithinSubtree(pool, person.id, other.id, { includeSelf })).toBe(
            await fromDatabase((executor) =>
              hierarchy.isWithinSubtree(executor, person.id, other.id, { includeSelf }),
            ),
          );
        }
      }
    }
    expect(await hierarchy.subtreeOf(pool, felix.id)).toEqual([felix.id]);
  });

  it('answers a repeated read from the copy, with no walk of the database', async () => {
    await hierarchy.subtreeOf(pool, raymond.id);

    const spy = jest.spyOn(Client.prototype, 'query');
    try {
      await hierarchy.subtreeOf(pool, raymond.id);
      await hierarchy.isWithinSubtree(pool, raymond.id, dante.id, { includeSelf: false });
      const statements = spy.mock.calls.map(([query]) =>
        typeof query === 'string' ? query : (query as { text: string }).text,
      );
      expect(statements.some((text) => /WITH RECURSIVE/i.test(text))).toBe(false);
      expect(statements.some((text) => /hierarchy_tree_version/.test(text))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('sees a change committed outside the API on the next answer', async () => {
    expect(await hierarchy.subtreeOf(pool, raymond.id)).not.toContain(felix.id);

    // The tests' own connection, which the application knows nothing about.
    await assignTo(db, felix.id, dante.id);

    expect(await hierarchy.subtreeOf(pool, raymond.id)).toContain(felix.id);
    expect(await hierarchy.ancestorsOf(pool, felix.id)).toEqual([
      dante.id,
      mark.id,
      manuel.id,
      raymond.id,
    ]);
  });

  it('sees a change committed through the application pool on the next answer', async () => {
    expect(await hierarchy.subtreeOf(pool, ben.id)).toEqual([ben.id]);

    await sql`
      INSERT INTO pastoral_assignments (person_id, leader_id, started_at)
      VALUES (${felix.id}::uuid, ${ben.id}::uuid, '2020-01-01T00:00:00+08:00')
    `.execute(pool);

    expect(await hierarchy.subtreeOf(pool, ben.id)).toEqual([ben.id, felix.id]);
  });

  it('sees a TRUNCATE followed by as many writes as before, with no request between', async () => {
    expect(await hierarchy.ancestorsOf(pool, dante.id)).toEqual([mark.id, manuel.id, raymond.id]);

    // Eight rows again, in a different shape: a counter that restarted would match.
    await sql`TRUNCATE pastoral_assignments`.execute(db);
    await assignTo(db, raymond.id, null);
    await assignTo(db, ben.id, raymond.id);
    await assignTo(db, manuel.id, ben.id);
    await assignTo(db, dante.id, ben.id);
    await assignTo(db, mark.id, dante.id);
    await assignTo(db, nico.id, raymond.id);
    await assignTo(db, oriel.id, null);
    await assignTo(db, grace.id, oriel.id);

    expect(await hierarchy.ancestorsOf(pool, dante.id)).toEqual([ben.id, raymond.id]);
    await expectSameSubtree(raymond);
  });

  it('answers from the database while the version is absent, and resumes after a write', async () => {
    await hierarchy.subtreeOf(pool, raymond.id);
    await sql`TRUNCATE hierarchy_tree_version`.execute(db);
    await sql`UPDATE pastoral_assignments SET ended_at = now() WHERE person_id = ${nico.id}::uuid`.execute(
      db,
    );

    expect(await hierarchy.subtreeOf(pool, manuel.id)).not.toContain(nico.id);
    expect(
      (await sql<{ n: number }>`SELECT count(*)::int AS n FROM hierarchy_tree_version`.execute(db))
        .rows[0].n,
    ).toBe(1);

    await assignTo(db, felix.id, ben.id);
    expect(await hierarchy.subtreeOf(pool, ben.id)).toContain(felix.id);
  });

  it('sees a change committed between two answers in a loop of reads', async () => {
    const reads = (async () => {
      for (let i = 0; i < 20; i += 1) {
        await hierarchy.subtreeOf(pool, raymond.id);
      }
    })();
    await assignTo(db, felix.id, nico.id);
    await reads;

    expect(await hierarchy.subtreeOf(pool, raymond.id)).toContain(felix.id);
  });

  it('reads the database inside a transaction, so a transaction sees its own write', async () => {
    await hierarchy.subtreeOf(pool, raymond.id);

    await pool
      .transaction()
      .execute(async (trx) => {
        await sql`
          INSERT INTO pastoral_assignments (person_id, leader_id, started_at)
          VALUES (${felix.id}::uuid, ${dante.id}::uuid, '2020-01-01T00:00:00+08:00')
        `.execute(trx);
        expect(await hierarchy.subtreeOf(trx, raymond.id)).toContain(felix.id);
        throw new Error('rollback');
      })
      .catch((error: Error) => {
        if (error.message !== 'rollback') throw error;
      });

    expect(await hierarchy.subtreeOf(pool, raymond.id)).not.toContain(felix.id);
  });

  /**
   * Section 5: advisory locks first, then row locks. The tree import writes a row and then
   * takes the next person's lock, so a version row locked at the write would put a row lock
   * before an advisory one and deadlock with a writer holding that person. The version is
   * moved at commit instead, after every other lock.
   */
  it('takes the version lock only at commit, so a write-then-lock transaction cannot deadlock', async () => {
    const olga = await createPerson(db, { firstName: 'Olga', network: 'MENS' });
    const importing = new Client({ connectionString: process.env.DATABASE_URL });
    const other = new Client({ connectionString: process.env.DATABASE_URL });
    await importing.connect();
    await other.connect();
    const insert = (client: Client, person: TestPerson, leader: TestPerson) =>
      client.query(
        `INSERT INTO pastoral_assignments (person_id, leader_id, started_at)
         VALUES ($1, $2, '2020-01-01T00:00:00+08:00')`,
        [person.id, leader.id],
      );
    try {
      for (const client of [importing, other]) {
        await client.query(`SET lock_timeout = '5s'`);
        await client.query('BEGIN');
      }
      await insert(importing, felix, dante);
      await other.query('SELECT pg_advisory_xact_lock(4242)');
      const otherDone = (async () => {
        await insert(other, olga, ben);
        await other.query('COMMIT');
      })();
      const importingDone = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await importing.query('SELECT pg_advisory_xact_lock(4242)');
        await importing.query('COMMIT');
      })();
      // Both awaited, so a failure in either is the one reported.
      const outcomes = await Promise.allSettled([importingDone, otherDone]);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason;
      }
    } finally {
      await importing.query('ROLLBACK').catch(() => undefined);
      await other.query('ROLLBACK').catch(() => undefined);
      await importing.end();
      await other.end();
    }

    expect(await hierarchy.subtreeOf(pool, ben.id)).toContain(olga.id);
    expect(await hierarchy.subtreeOf(pool, dante.id)).toContain(felix.id);
  });

  it('refuses walks over a cycle, and answers both roots', async () => {
    const paulo = await createPerson(db, { firstName: 'Paulo', network: 'MENS' });
    const quino = await createPerson(db, { firstName: 'Quino', network: 'MENS' });
    await assignTo(db, paulo.id, quino.id);
    await assignTo(db, quino.id, paulo.id);

    const reads: ((executor: Db) => Promise<unknown>)[] = [
      (executor: Db) => hierarchy.subtreeOf(executor, paulo.id),
      (executor: Db) => hierarchy.ancestorsOf(executor, quino.id),
      (executor: Db) =>
        hierarchy.isWithinSubtree(executor, raymond.id, paulo.id, { includeSelf: false }),
    ];
    for (const read of reads) {
      await expect(read(pool)).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
      await expect(fromDatabase(read)).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
    }

    await expectSameSubtree(raymond);
    await expectSameSubtree(oriel);
  });
});
