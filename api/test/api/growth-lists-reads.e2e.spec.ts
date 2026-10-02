import request from 'supertest';
import { Client } from 'pg';

import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { Capability } from '../../src/auth/authorization/capabilities';
import { filingFor } from '../../src/common/growth/growth-filing';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { PeopleReadService } from '../../src/people/people.read.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a page of a Growth list costs, and that its `may_file` flags did not move
 * (checklist row perf-growth-lists).
 *
 * Each row's flag walked the tree once or twice for that person; the list now reads each
 * filing capability's scope once. So a page costs the same number of queries however many
 * rows it holds, and every flag is still what the per-person check a save makes answers.
 *
 * Measured as queries over `pg`'s `Client.prototype.query`. Fixture names are invented
 * (CLAUDE.md, Secrets).
 */
describe('a Growth list page (perf-growth-lists)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let adminAccount: TestAccount;
  let admin: TestPerson;

  const tabs = [
    {
      path: 'suynl',
      capabilities: { confirm: Capability.SuynlConfirm, onBehalf: Capability.SuynlConfirmOnBehalf },
    },
    {
      path: 'training',
      capabilities: {
        confirm: Capability.TrainingConfirm,
        onBehalf: Capability.TrainingConfirmOnBehalf,
      },
    },
  ];

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    admin = await createPerson(db, { firstName: 'Ester', network: 'WOMENS' });
    adminAccount = await createAccount(app, db, { person: admin, roles: ['ADMIN'] });

    // Sixty disciples of Raymond's, every third leading one of their own, so some rows are
    // filed directly and some on behalf.
    for (let i = 0; i < 60; i += 1) {
      const person = await createPerson(db, { firstName: `Disciple${i}`, network: 'MENS' });
      await assignTo(db, person.id, raymond.id);
      if (i % 3 === 0) {
        const below = await createPerson(db, { firstName: `Below${i}`, network: 'MENS' });
        await assignTo(db, below.id, person.id);
      }
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function fetched(
    account: TestAccount,
    path: string,
  ): Promise<{ queries: number; body: { data: { person_id: string; may_file: boolean }[] } }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${account.accessToken}`);
    const queries = spy.mock.calls.length;
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { queries, body: response.body };
  }

  it.each(tabs)(
    '$path: a page of 50 costs the same number of queries as a page of 20',
    async (tab) => {
      const twenty = await fetched(raymondAccount, `/api/v1/${tab.path}/people?limit=20`);
      const fifty = await fetched(raymondAccount, `/api/v1/${tab.path}/people?limit=50`);

      expect(twenty.body.data).toHaveLength(20);
      expect(fifty.body.data).toHaveLength(50);
      expect(fifty.queries).toBe(twenty.queries);
    },
  );

  it.each(tabs)(
    '$path: every flag is what the per-person check a save makes answers',
    async (tab) => {
      const authorization = app.get(AuthorizationService);
      const hierarchy = app.get(HierarchyService);
      const people = app.get(PeopleReadService);

      for (const [account, person] of [
        [raymondAccount, raymond],
        [adminAccount, admin],
      ] as const) {
        const actor = { accountId: account.id, personId: person.id };
        const authority = await authorization.authorityFor(account.id);
        const page = await fetched(account, `/api/v1/${tab.path}/people?limit=200`);
        const ids = page.body.data.map((row) => row.person_id);
        const identities = await people.forDecisions(ids);
        const assignments = await hierarchy.assignmentsAsOf(db, ids, new Date());

        expect(ids.length).toBeGreaterThan(0);
        for (const row of page.body.data) {
          const filing = await filingFor(
            { authorization },
            db,
            actor,
            authority,
            tab.capabilities,
            row.person_id,
            identities.get(row.person_id),
            assignments.get(row.person_id),
          );
          expect([row.person_id, row.may_file]).toEqual([
            row.person_id,
            !(filing instanceof Error),
          ]);
        }
      }
    },
  );
});
