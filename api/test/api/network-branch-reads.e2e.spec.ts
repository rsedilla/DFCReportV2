import request from 'supertest';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a page of the Network screen costs (checklist row perf-network-rewalk).
 *
 * Every page of a branch walks the whole branch, to count what is beneath each row, and
 * reads every direct disciple's name, to sort them. So a page of 200 costs what a page of
 * 20 does, and the screen reads 200 at once rather than walking again for each twenty.
 *
 * Measured as rows fetched, summed over every query on `pg`'s `Client.prototype.query`.
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a page of a branch costs the same at 20 and at 200 (perf-network-rewalk)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let raymondAccount: TestAccount;

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

    for (let i = 0; i < 45; i += 1) {
      const disciple = await createPerson(db, { firstName: `Disciple${i}`, network: 'MENS' });
      await assignTo(db, disciple.id, raymond.id);
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
    path: string,
  ): Promise<{ rows: number; body: { data: unknown[]; next_cursor: string | null } }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${raymondAccount.accessToken}`);
    const results = await Promise.all(
      spy.mock.results.map((result) =>
        Promise.resolve(result.value as unknown).then(
          (value) => (value as { rows?: unknown[] } | undefined)?.rows?.length ?? 0,
          () => 0,
        ),
      ),
    );
    spy.mockRestore();

    expect(response.status).toBe(200);
    return { rows: results.reduce((sum, rows) => sum + rows, 0), body: response.body };
  }

  it('reads as many rows for a page of 20 as for a page of 200', async () => {
    const twenty = await fetched('/api/v1/network/my-tree?limit=20');
    const all = await fetched('/api/v1/network/my-tree?limit=200');

    expect(twenty.body.data).toHaveLength(20);
    expect(all.body.data).toHaveLength(45);
    expect(all.body.next_cursor).toBeNull();
    expect(all.rows).toBe(twenty.rows);
  });

  it('so reading 45 twenty at a time costs three times what one page of 200 does', async () => {
    const all = await fetched('/api/v1/network/my-tree?limit=200');

    let rows = 0;
    let pages = 0;
    let cursor: string | null = null;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page = await fetched(`/api/v1/network/my-tree?limit=20${suffix}`);
      rows += page.rows;
      pages += 1;
      cursor = page.body.next_cursor;
    } while (cursor !== null);

    expect(pages).toBe(3);
    expect(rows).toBe(3 * all.rows);
  });
});
