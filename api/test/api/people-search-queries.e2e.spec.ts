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

  let oriel: TestPerson;
  let rico: TestPerson;
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
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
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

  // A Leader no longer searches the church (decision 0389): the pickers search the
  // searcher's own scope, and Who ran it adds the leaders above them.
  it.each([
    ['a leader searching their own scope, as the pickers and the People screen do', {}],
    ['a leader searching their scope and their upline, as Who ran it does', { upline: true }],
  ])('%s', async (_label, extra: Record<string, boolean>) => {
    // Unmeasured: builds the in-memory tree (decision 0321), so both counts below start warm.
    await counted(raymondAccount, { q: 'Countfixture', ...extra, limit: 5 });
    const small = await counted(raymondAccount, {
      q: 'Countfixture',
      ...extra,
      limit: 5,
    });
    const large = await counted(raymondAccount, {
      q: 'Countfixture',
      ...extra,
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

  it('an administrator searching church-wide, the one actor still allowed to', async () => {
    const small = await counted(adminAccount, { q: 'Countfixture', church_wide: true, limit: 5 });
    const large = await counted(adminAccount, {
      q: 'Countfixture',
      church_wide: true,
      limit: 20,
    });

    expect(large.rows).toHaveLength(20);
    expect(large.queries).toBe(small.queries);
  });

  it('an upline search of a long chain, whose rows are identity-only', async () => {
    // Rico -> Chain01 -> ... -> Chain06 -> Deep: every Chain leader is above Deep and outside
    // his scope, so each comes back with five fields, its leader's name and its Network,
    // and a page of seven costs what a page of two does.
    let above = rico.id;
    const chain: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const link = await createPerson(db, {
        firstName: `Chain${String(i).padStart(2, '0')}`,
        lastName: 'Chainfixture',
        network: 'MENS',
      });
      await assignTo(db, link.id, above);
      chain.push(link.id);
      above = link.id;
    }
    const deep = await createPerson(db, {
      firstName: 'Deep',
      lastName: 'Chainfixture',
      network: 'MENS',
    });
    await assignTo(db, deep.id, above);
    const deepAccount = await createAccount(app, db, { person: deep, roles: ['LEADER'] });

    await counted(deepAccount, { q: 'Chainfixture', upline: true, limit: 2 });
    const small = await counted(deepAccount, { q: 'Chainfixture', upline: true, limit: 2 });
    const large = await counted(deepAccount, { q: 'Chainfixture', upline: true, limit: 7 });

    expect(small.rows).toHaveLength(2);
    expect(large.rows.map((row) => row.id)).toEqual([...chain, deep.id]);
    expect(large.queries).toBe(small.queries);

    large.rows.slice(0, 6).forEach((row, i) => {
      expect(row).toMatchObject({
        scope: 'IDENTITY_ONLY',
        network: 'MENS',
        direct_leader_name: i === 0 ? 'Rico Testfixture' : `Chain0${i} Chainfixture`,
      });
    });
    expect(large.rows[6]).toMatchObject({ id: deep.id, scope: 'FULL' });
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

    const men = await counted(observer, { q: 'Theirs', limit: 20 });
    expect(men.rows.map((row) => row.id)).toEqual(outOfScope);
    for (const row of men.rows) {
      expect(row).toMatchObject({ scope: 'FULL', direct_leader_name: 'Rico Testfixture' });
    }

    // Outside the grant and her own subtree, so not on her search at all.
    const women = await counted(observer, { q: 'Wanda', limit: 20 });
    expect(women.rows).toEqual([]);

    // A Network grant is not Whole Church, so it may not search the church (decision 0389).
    const wide = await request(app.getHttpServer())
      .get('/api/v1/people')
      .query({ q: 'Wanda', church_wide: true })
      .set('Authorization', `Bearer ${observer.accessToken}`);
    expect(wide.status).toBe(403);
    expect(wide.body.error.code).toBe('SCOPE_DENIED');
    expect(JSON.stringify(wide.body)).not.toContain(woman.id);
  });

  it('still gives each row the fields its scope allows, with its leader and Network', async () => {
    const { rows } = await counted(raymondAccount, {
      q: 'Countfixture',
      limit: 20,
    });
    // His own scope holds the twenty "Mine" rows and none of Rico's "Theirs".
    expect(rows.map((row) => row.id)).toEqual(inScope);
    for (const row of rows) {
      expect(row).toMatchObject({ scope: 'FULL', direct_leader_name: 'Raymond Testfixture' });
    }

    // The one way a Leader's search returns somebody outside his scope is the upline
    // (decision 0389): Oriel, above him, with five fields and his Network.
    const rest = await request(app.getHttpServer())
      .get('/api/v1/people')
      .query({ q: 'Oriel', upline: true, limit: 20 })
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    const outside = rest.body.data as Record<string, unknown>[];
    expect(outside.map((row) => row.id)).toEqual([oriel.id]);
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
      // A Network root, so no leader to name.
      expect(row).toMatchObject({
        scope: 'IDENTITY_ONLY',
        network: 'MENS',
        direct_leader_name: null,
      });
    }
  });
});
