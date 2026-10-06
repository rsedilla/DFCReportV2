import request from 'supertest';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/people` costs the same number of database queries whatever the page size
 * (checklist row perf-people-search).
 *
 * Each row was checked one at a time: its scope, then its leader's name, and for a row
 * outside scope its Network too, which is about four queries a row and two hundred for a
 * picker's page of fifty. A page is now answered from the scope the route already reads
 * and two batched lookups, so a page of forty costs what a page of five does.
 *
 * Counted on `pg`'s `Client.prototype.query`, which every pooled query passes through.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('people search queries do not grow with the page (perf-people-search)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let adminAccount: TestAccount;
  const inScope: string[] = [];
  const outOfScope: string[] = [];

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    inScope.length = 0;
    outOfScope.length = 0;

    // Men's: Oriel -> Raymond -> 20 disciples, and Oriel -> Rico -> 20 that Raymond does
    // not oversee, all under one surname so one term matches every one of them.
    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, rico.id, oriel.id);

    for (let i = 0; i < 20; i += 1) {
      const mine = await createPerson(db, {
        firstName: `Mine${String(i).padStart(2, '0')}`,
        lastName: 'Countfixture',
        network: 'MENS',
      });
      await assignTo(db, mine.id, raymond.id);
      inScope.push(mine.id);

      const theirs = await createPerson(db, {
        firstName: `Theirs${String(i).padStart(2, '0')}`,
        lastName: 'Countfixture',
        network: 'MENS',
      });
      await assignTo(db, theirs.id, rico.id);
      outOfScope.push(theirs.id);
    }

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, {
        firstName: 'Ester',
        lastName: 'Adminfixture',
        network: 'WOMENS',
      }),
      roles: ['ADMIN'],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function counted(
    actor: TestAccount,
    query: Record<string, string | number | boolean>,
  ): Promise<{ queries: number; rows: Record<string, unknown>[] }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get('/api/v1/people')
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);
    const queries = spy.mock.calls.length;
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { queries, rows: response.body.data as Record<string, unknown>[] };
  }

  it.each([
    ['a leader searching the church, as the pickers do', true],
    ['a leader searching their own scope, as the People screen does', false],
  ])('%s', async (_label, churchWide) => {
    // Unmeasured: builds the in-memory tree (decision 0321), so both counts below start warm.
    await counted(raymondAccount, { q: 'Countfixture', church_wide: churchWide, limit: 5 });
    const small = await counted(raymondAccount, {
      q: 'Countfixture',
      church_wide: churchWide,
      limit: 5,
    });
    const large = await counted(raymondAccount, {
      q: 'Countfixture',
      church_wide: churchWide,
      limit: 20,
    });

    expect(small.rows).toHaveLength(5);
    expect(large.rows).toHaveLength(20);
    expect(large.queries).toBe(small.queries);
  });

  it('an administrator, whose scope is the whole church', async () => {
    const small = await counted(adminAccount, { q: 'Countfixture', limit: 5 });
    const large = await counted(adminAccount, { q: 'Countfixture', limit: 40 });

    expect(large.rows).toHaveLength(40);
    expect(large.queries).toBe(small.queries);
  });

  it('gives full rows to a Network grant across its Network, and only there', async () => {
    // A Women's reader with no disciples, granted the Men's Network: every man is in scope
    // through the grant alone, and a woman outside her own subtree is not.
    const observer = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Olga', network: 'WOMENS' }),
      roles: ['LEADER'],
    });
    await db
      .insertInto('capability_grants')
      .values({
        account_id: observer.id,
        capability: 'people.view_subtree',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: adminAccount.id,
      })
      .execute();
    const woman = await createPerson(db, {
      firstName: 'Wanda',
      lastName: 'Countfixture',
      network: 'WOMENS',
    });

    const men = await counted(observer, { q: 'Theirs', church_wide: true, limit: 20 });
    expect(men.rows.map((row) => row.id)).toEqual(outOfScope);
    for (const row of men.rows) {
      expect(row).toMatchObject({ scope: 'FULL', direct_leader_name: 'Rico Testfixture' });
    }

    const women = await counted(observer, { q: 'Wanda', church_wide: true, limit: 20 });
    expect(women.rows).toEqual([
      expect.objectContaining({ id: woman.id, scope: 'IDENTITY_ONLY', network: 'WOMENS' }),
    ]);
  });

  it('still gives each row the fields its scope allows, with its leader and Network', async () => {
    const { rows } = await counted(raymondAccount, {
      q: 'Countfixture',
      church_wide: true,
      limit: 20,
    });
    // Ordered by name: the twenty "Mine" rows come before the twenty "Theirs" ones, so a
    // page of twenty holds only Raymond's; a separate search finds the rest.
    expect(rows.map((row) => row.id)).toEqual(inScope);
    for (const row of rows) {
      expect(row).toMatchObject({ scope: 'FULL', direct_leader_name: 'Raymond Testfixture' });
    }

    const rest = await request(app.getHttpServer())
      .get('/api/v1/people')
      .query({ q: 'Theirs', church_wide: true, limit: 20 })
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    const outside = rest.body.data as Record<string, unknown>[];
    expect(outside.map((row) => row.id)).toEqual(outOfScope);
    for (const row of outside) {
      expect(Object.keys(row).sort()).toEqual([
        'direct_leader_name',
        'full_name',
        'id',
        'member_id',
        'network',
        'scope',
        'sex',
      ]);
      expect(row).toMatchObject({
        scope: 'IDENTITY_ONLY',
        network: 'MENS',
        direct_leader_name: 'Rico Testfixture',
      });
    }
  });
});
