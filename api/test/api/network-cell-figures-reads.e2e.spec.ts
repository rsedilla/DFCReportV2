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
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * What a branch's Cell figures cost (checklist row perf-network-cell-figures).
 *
 * `GET /leaders/{id}/cell-figures` read every Cell's meetings for the month, every recorded
 * meeting and every current Cell Leader in the church, and kept the branch's. Its cost
 * should follow the branch, not the church: Cells led outside the branch add nothing.
 *
 * Measured as rows fetched, summed over every query on `pg`'s `Client.prototype.query`.
 * The figures themselves are pinned in `network-figures.e2e.spec.ts`. Fixture names are
 * invented (CLAUDE.md, Secrets).
 */
describe('a branch’s Cell figures cost the same however many Cells are elsewhere (perf-network-cell-figures)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let juan: TestPerson;
  let raymondAccount: TestAccount;
  let weekday: number;
  let created: Date;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    const rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, rico.id, oriel.id);
    await assignTo(db, juan.id, rico.id);
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });

    // Meeting on today's weekday, so today's meeting has begun and counts as behind.
    const today = (
      await sql<{ today: string }>`
        SELECT to_char((now() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS today
      `.execute(db)
    ).rows[0].today;
    const [y, m, d] = today.split('-').map(Number);
    weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
    created = new Date(Date.UTC(y - 1, m - 1, 1));

    await createCell(db, { leader: raymond, dayOfWeek: weekday, createdAt: created });
    await createCell(db, { leader: manuel, dayOfWeek: weekday, createdAt: created });
    await createCell(db, { leader: juan, dayOfWeek: weekday, createdAt: created });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  async function fetched(): Promise<{ rows: number; body: Record<string, unknown> }> {
    const spy = jest.spyOn(Client.prototype, 'query');
    const response = await request(app.getHttpServer())
      .get(`/api/v1/leaders/${raymond.id}/cell-figures`)
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

  it('reads no more rows, and answers the same, when twenty Cells are added outside the branch', async () => {
    const small = await fetched();

    for (let i = 0; i < 20; i += 1) {
      await createCell(db, { leader: juan, dayOfWeek: weekday, createdAt: created });
    }
    const large = await fetched();

    expect(small.rows).toBeGreaterThan(0);
    expect(
      (small.body as { branch_meetings_behind: number }).branch_meetings_behind,
    ).toBeGreaterThan(0);
    expect(large.body).toEqual(small.body);
    expect(large.rows).toBe(small.rows);
  });
});
