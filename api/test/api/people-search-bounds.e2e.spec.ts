import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
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
 * A church-wide search is bounded and recorded (SKILL.md sections 8 and 21, decision
 * 0303): three characters, at most 20 people a request, 30 searches a minute per
 * account, and one audit entry per search that is answered. All four bind every
 * request sending `church_wide=true`, an administrator's included.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('church-wide search is bounded and recorded (decision 0303)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let mark: TestAccount;
  let manuel: TestAccount;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    const markPerson = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, markPerson.id, oriel.id);
    const manuelPerson = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuelPerson.id, oriel.id);

    mark = await createAccount(app, db, { person: markPerson, roles: ['LEADER'] });
    manuel = await createAccount(app, db, { person: manuelPerson, roles: ['LEADER'] });
    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  });

  afterAll(async () => {
    resetRateLimits(app);
    await app.close();
    await db.destroy();
  });

  const search = (actor: TestAccount, query: Record<string, string | number | boolean>) =>
    request(app.getHttpServer())
      .get('/api/v1/people')
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);

  const entries = () =>
    db
      .selectFrom('audit_log')
      .select(['actor_id', 'target_type', 'target_id', 'after'])
      .where('action', '=', 'directory.searched')
      .orderBy('occurred_at')
      .execute();

  /** Twenty-two more people sharing the fixture surname, so a page has more than 20. */
  const crowd = async () => {
    for (let n = 0; n < 22; n += 1) {
      await createPerson(db, { firstName: `Crowd${String(n).padStart(2, '0')}`, network: 'MENS' });
    }
  };

  describe('the page', () => {
    it('returns 20 with no limit, and pages on with the cursor', async () => {
      await crowd();

      const first = await search(mark, { q: 'Testfixture', church_wide: true });
      expect(first.status).toBe(200);
      expect(first.body.data).toHaveLength(20);
      expect(first.body.next_cursor).toEqual(expect.any(String));

      const next = await search(mark, {
        q: 'Testfixture',
        church_wide: true,
        cursor: first.body.next_cursor as string,
      });
      expect(next.status).toBe(200);
      expect(next.body.data.length).toBeGreaterThan(0);
    });

    it('refuses a limit above 20 rather than cutting it, an administrator included', async () => {
      for (const actor of [mark, admin]) {
        const response = await search(actor, { q: 'Testfixture', church_wide: true, limit: 21 });

        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.field).toBe('limit');
      }

      expect((await search(mark, { q: 'Testfixture', church_wide: true, limit: 20 })).status).toBe(
        200,
      );
    });

    it('leaves the searcher own scope at 50 by default and 200 at most', async () => {
      await crowd();

      const own = await search(admin, { q: 'Testfixture' });
      expect(own.status).toBe(200);
      expect(own.body.data.length).toBeGreaterThan(20);

      expect((await search(admin, { q: 'Testfixture', limit: 200 })).status).toBe(200);
    });
  });

  describe('the rate', () => {
    it('allows 30 church-wide searches a minute per account, then refuses as RATE_LIMITED', async () => {
      for (let n = 0; n < 30; n += 1) {
        expect((await search(mark, { q: 'Testfixture', church_wide: true })).status).toBe(200);
      }

      const refused = await search(mark, { q: 'Testfixture', church_wide: true });
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe('RATE_LIMITED');

      // The count is Mark's alone, and his own-scope search is not church-wide.
      expect((await search(manuel, { q: 'Testfixture', church_wide: true })).status).toBe(200);
      expect((await search(mark, { q: 'Testfixture' })).status).toBe(200);
    });

    it('binds an administrator too', async () => {
      for (let n = 0; n < 30; n += 1) {
        expect((await search(admin, { q: 'Testfixture', church_wide: true })).status).toBe(200);
      }

      expect((await search(admin, { q: 'Testfixture', church_wide: true })).status).toBe(429);
    });

    it('spends nothing on a search it refuses for its term or its limit', async () => {
      for (let n = 0; n < 35; n += 1) {
        const short = await search(mark, { q: 'Ma', church_wide: true });
        expect(short.status).toBe(422);
      }
      expect((await search(mark, { q: 'Testfixture', church_wide: true, limit: 50 })).status).toBe(
        422,
      );

      expect((await search(mark, { q: 'Testfixture', church_wide: true })).status).toBe(200);
    });
  });

  describe('the count', () => {
    it('spends nothing on a cursor it refuses', async () => {
      for (let n = 0; n < 31; n += 1) {
        const refused = await search(mark, {
          q: 'Testfixture',
          church_wide: true,
          cursor: 'not-a-cursor',
        });
        expect(refused.status).toBe(422);
      }

      expect((await search(mark, { q: 'Testfixture', church_wide: true })).status).toBe(200);
    });

    it('keeps each account on expiry timers of its own', async () => {
      // The stock storage cancels every expiry timer under a throttler name when any key
      // under it leaves its block. Under one shared name, one account waiting out its
      // block froze every other account's count, which a minute-long block keeps a test
      // from reaching, so the names are asserted instead.
      await search(mark, { q: 'Testfixture', church_wide: true }).expect(200);
      await search(manuel, { q: 'Testfixture', church_wide: true }).expect(200);

      const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
      const names = [
        ...(storage as unknown as { timeoutIds: Map<string, unknown> }).timeoutIds.keys(),
      ];
      expect(names).toEqual(
        expect.arrayContaining([
          `church-wide-search:${mark.id}`,
          `church-wide-search:${manuel.id}`,
        ]),
      );
      expect(names).not.toContain('church-wide-search');
    });
  });

  describe('the audit entry', () => {
    it('records each church-wide search: who, the term, and how many it returned', async () => {
      await crowd();

      const first = await search(mark, { q: 'Testfixture', church_wide: true });
      await search(mark, {
        q: 'Testfixture',
        church_wide: true,
        cursor: first.body.next_cursor as string,
      });
      await search(mark, { q: 'Manuel', church_wide: true });

      const written = await entries();
      expect(written).toHaveLength(3);
      for (const entry of written) {
        expect(entry).toMatchObject({
          actor_id: mark.id,
          target_type: 'account',
          target_id: mark.id,
        });
      }
      expect(written.map((entry) => entry.after)).toEqual([
        { term: 'Testfixture', returned: 20 },
        // Oriel, Mark, Manuel, Ester and the crowd of 22: 26 in all.
        { term: 'Testfixture', returned: 6 },
        { term: 'Manuel', returned: 1 },
      ]);
    });

    it('records an administrator church-wide search too', async () => {
      await search(admin, { q: 'Mark', church_wide: true }).expect(200);

      expect(await entries()).toEqual([
        {
          actor_id: admin.id,
          target_type: 'account',
          target_id: admin.id,
          after: { term: 'Mark', returned: 1 },
        },
      ]);
    });

    it('writes nothing for an own-scope search or a refused one', async () => {
      await search(mark, { q: 'Testfixture' }).expect(200);
      await search(mark, { q: 'Ma', church_wide: true }).expect(422);
      await search(mark, { q: 'Testfixture', church_wide: true, limit: 21 }).expect(422);

      for (let n = 0; n < 30; n += 1) {
        await search(mark, { q: 'Testfixture', church_wide: true }).expect(200);
      }
      await search(mark, { q: 'Testfixture', church_wide: true }).expect(429);

      expect(await entries()).toHaveLength(30);
    });
  });
});
