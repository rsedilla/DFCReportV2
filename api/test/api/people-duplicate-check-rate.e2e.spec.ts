import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * `GET /api/v1/people/duplicate-candidates` allows sixty checks a minute to one account
 * (SKILL.md section 3, decision 0449). Add a Person runs it as a leader types, and it reads
 * the whole church, so the app-wide hundred and twenty was its only bound.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the duplicate check is limited to sixty a minute per account (decision 0449)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let first: TestAccount;
  let second: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    const one = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const two = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    await assignTo(db, root.id, null);
    await assignTo(db, one.id, root.id);
    await assignTo(db, two.id, root.id);
    first = await createAccount(app, db, { person: one, roles: ['LEADER'] });
    second = await createAccount(app, db, { person: two, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const check = (account: TestAccount, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/api/v1/people/duplicate-candidates')
      .query(query)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const names = { first_name: 'Juan', last_name: 'Dupfixture', sex: 'MALE' };

  it('answers sixty, refuses the sixty-first as RATE_LIMITED, and counts each account apart', async () => {
    for (let n = 0; n < 60; n += 1) {
      expect((await check(first, names)).status).toBe(200);
    }

    const refused = await check(first, names);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');

    expect((await check(second, names)).status).toBe(200);
  });

  it('spends nothing on a check it refuses for its query', async () => {
    for (let n = 0; n < 65; n += 1) {
      // No last name: refused before it is counted.
      expect((await check(first, { first_name: 'Juan', sex: 'MALE' })).status).toBe(422);
    }

    expect((await check(first, names)).status).toBe(200);
  });
});
