import request from 'supertest';
import { Client } from 'pg';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * What reading the whole Cells index costs (checklist row perf-cells-totals).
 *
 * Coverage by Cell reads every Cell in scope, following the cursor. Each request pays a
 * fixed cost for the reader's scope and the month before its rows, so the list is read 200
 * at a time rather than the default 50.
 *
 * Measured as queries and rows over `pg`'s `Client.prototype.query`. Fixture names are
 * invented (CLAUDE.md, Secrets).
 */
describe('reading the whole Cells index (perf-cells-totals)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let account: TestAccount;
  let month: string;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    account = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    for (let i = 0; i < 120; i += 1) {
      await createCell(db, { leader: raymond, dayOfWeek: (i % 7) + 1 });
    }

    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    month = `${today.slice(0, 7)}-01`;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function readAll(
    limit: number,
  ): Promise<{ requests: number; queries: number; rows: number; cells: number }> {
    let requests = 0;
    let queries = 0;
    let rows = 0;
    let cells = 0;
    let cursor: string | null = null;

    do {
      const spy = jest.spyOn(Client.prototype, 'query');
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await request(app.getHttpServer())
        .get(`/api/v1/cells?month=${month}&limit=${limit}${suffix}`)
        .set('Authorization', `Bearer ${account.accessToken}`);
      const counts = await Promise.all(
        spy.mock.results.map((result) =>
          Promise.resolve(result.value as unknown).then(
            (value) => (value as { rows?: unknown[] } | undefined)?.rows?.length ?? 0,
            () => 0,
          ),
        ),
      );
      spy.mockRestore();

      expect(response.status).toBe(200);
      requests += 1;
      queries += counts.length;
      rows += counts.reduce((sum, n) => sum + n, 0);
      cells += (response.body as { data: unknown[] }).data.length;
      cursor = (response.body as { next_cursor: string | null }).next_cursor;
    } while (cursor !== null);

    return { requests, queries, rows, cells };
  }

  it('reads the whole index in fewer queries 200 at a time than 50 at a time', async () => {
    const fifty = await readAll(50);
    const twoHundred = await readAll(200);

    expect(fifty.cells).toBe(120);
    expect(twoHundred.cells).toBe(120);
    expect(twoHundred.requests).toBe(1);
    expect(twoHundred.queries).toBeLessThan(fifty.queries);
  });
});
