import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import request from 'supertest';

import { AccountTokensService } from '../../src/auth/account-tokens.service';
import { PRIVACY_NOTICE_VERSION } from '../../src/auth/privacy-notice.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

const PASSWORD = 'a long enough passphrase';

/**
 * The Privacy Notice tick (SKILL.md sections 6 and 24, decision 0496): at activation, once
 * signed in, on `/auth/me`, and on the Admin's read of an account.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('the Privacy Notice tick (decision 0496)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let rosalind: TestPerson;
  let teodoro: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);
    nameSeniorPastors(app, []);
    rosalind = await createPerson(db, {
      firstName: 'Rosalind',
      lastName: 'Macaraeg',
      network: 'WOMENS',
    });
    teodoro = await createPerson(db, {
      firstName: 'Teodoro',
      lastName: 'Villafuerte',
      network: 'MENS',
    });
  });

  const server = () => request(app.getHttpServer());

  const leader = (person: TestPerson) => createAccount(app, db, { person, roles: ['LEADER'] });

  const tick = (account: TestAccount, version: unknown, key: string = randomUUID()) =>
    server()
      .post('/api/v1/auth/privacy-notice')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ version });

  const me = async (account: TestAccount) =>
    (
      await server()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200)
    ).body;

  const rowsFor = (accountId: string) =>
    db
      .selectFrom('privacy_notice_acknowledgments')
      .selectAll()
      .where('account_id', '=', accountId)
      .execute();

  /** A pending account and its activation token. */
  async function pending(person: TestPerson): Promise<{ accountId: string; token: string }> {
    const email = `${person.firstName.toLowerCase()}.${randomUUID().slice(0, 8)}@example.test`;
    const account = await db
      .insertInto('accounts')
      .values({
        person_id: person.id,
        email,
        email_normalized: email,
        status: 'PENDING_ACTIVATION',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const minted = await db
      .transaction()
      .execute((trx) =>
        app.get(AccountTokensService).mintWithin(trx, account.id, 'ACTIVATION', 3_600_000),
      );
    return { accountId: account.id, token: minted.token };
  }

  describe('once signed in', () => {
    it('is not ticked until the holder ticks it, and then says when', async () => {
      const account = await leader(rosalind);

      expect((await me(account)).privacy_notice).toEqual({
        version: PRIVACY_NOTICE_VERSION,
        acknowledged_at: null,
      });

      const answer = await tick(account, PRIVACY_NOTICE_VERSION).expect(200);
      expect(answer.body).toEqual({
        version: PRIVACY_NOTICE_VERSION,
        acknowledged_at: expect.any(String),
      });

      expect((await me(account)).privacy_notice).toEqual({
        version: PRIVACY_NOTICE_VERSION,
        acknowledged_at: answer.body.acknowledged_at,
      });
    });

    it('keeps the first tick when ticked again', async () => {
      const account = await leader(rosalind);

      const first = await tick(account, PRIVACY_NOTICE_VERSION).expect(200);
      const second = await tick(account, PRIVACY_NOTICE_VERSION).expect(200);

      expect(second.body.acknowledged_at).toBe(first.body.acknowledged_at);
      expect(await rowsFor(account.id)).toHaveLength(1);
    });

    it('replays a retry with the same key', async () => {
      const account = await leader(rosalind);
      const key = randomUUID();

      const first = await tick(account, PRIVACY_NOTICE_VERSION, key).expect(200);
      const replay = await tick(account, PRIVACY_NOTICE_VERSION, key).expect(200);

      expect(replay.body).toEqual(first.body);
      expect(await rowsFor(account.id)).toHaveLength(1);
    });

    it('refuses any notice but the one in force, and keeps nothing', async () => {
      const account = await leader(rosalind);

      for (const version of ['2026-11-07', '2099-01-01', 'yesterday', '', null, 7]) {
        const response = await tick(account, version);
        expect([400, 422]).toContain(response.status);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await rowsFor(account.id)).toHaveLength(0);

      // Another notice's date names the field it came in (decision 0126).
      const stale = await tick(account, '2026-11-07');
      expect(stale.body.error.details.field).toBe('version');
    });

    it('ticks the caller’s own account only', async () => {
      const rosalindsAccount = await leader(rosalind);
      const teodorosAccount = await leader(teodoro);

      await tick(rosalindsAccount, PRIVACY_NOTICE_VERSION).expect(200);

      expect(await rowsFor(rosalindsAccount.id)).toHaveLength(1);
      expect(await rowsFor(teodorosAccount.id)).toHaveLength(0);
      expect((await me(teodorosAccount)).privacy_notice.acknowledged_at).toBeNull();
    });

    it('is refused without a session', async () => {
      await server()
        .post('/api/v1/auth/privacy-notice')
        .set('Idempotency-Key', randomUUID())
        .send({ version: PRIVACY_NOTICE_VERSION })
        .expect(401);
    });

    it('asks the Admin too, not Leaders alone', async () => {
      const admin = await createAccount(app, db, { person: rosalind, roles: ['ADMIN'] });

      expect((await me(admin)).privacy_notice.acknowledged_at).toBeNull();
      await tick(admin, PRIVACY_NOTICE_VERSION).expect(200);
      expect((await me(admin)).privacy_notice.acknowledged_at).toEqual(expect.any(String));
    });
  });

  describe('at activation', () => {
    it('keeps the tick in the transaction that sets the password', async () => {
      const { accountId, token } = await pending(rosalind);

      await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, privacy_notice_version: PRIVACY_NOTICE_VERSION })
        .expect(204);

      const rows = await rowsFor(accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0].notice_version).toBe(PRIVACY_NOTICE_VERSION);
    });

    it('still activates without one, and that account is asked later', async () => {
      const { accountId, token } = await pending(rosalind);

      await server().post('/api/v1/auth/activate').send({ token, password: PASSWORD }).expect(204);
      await server()
        .post('/api/v1/auth/activate')
        .send({
          token: (await pending(teodoro)).token,
          password: PASSWORD,
          privacy_notice_version: null,
        })
        .expect(204);

      expect(await rowsFor(accountId)).toHaveLength(0);
    });

    it('refuses another notice, sets no password, and leaves the link usable', async () => {
      const { accountId, token } = await pending(rosalind);

      const refused = await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, privacy_notice_version: '2026-11-07' });
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      expect(refused.body.error.details.field).toBe('privacy_notice_version');

      const account = await db
        .selectFrom('accounts')
        .select(['status', 'password_hash'])
        .where('id', '=', accountId)
        .executeTakeFirstOrThrow();
      expect(account).toEqual({ status: 'PENDING_ACTIVATION', password_hash: null });
      expect(await rowsFor(accountId)).toHaveLength(0);

      await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, privacy_notice_version: PRIVACY_NOTICE_VERSION })
        .expect(204);
      expect(await rowsFor(accountId)).toHaveLength(1);
    });
  });

  describe("on the Admin's read of an account", () => {
    it('says when the holder ticked it, or null', async () => {
      const ofAdmin = await createPerson(db, {
        firstName: 'Evangelina',
        lastName: 'Dumlao',
        network: 'WOMENS',
      });
      const admin = await createAccount(app, db, { person: ofAdmin, roles: ['ADMIN'] });
      const account = await leader(rosalind);

      const read = () =>
        server()
          .get(`/api/v1/accounts/for-person/${rosalind.id}`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200);

      expect((await read()).body.account.privacy_notice_acknowledged_at).toBeNull();

      const ticked = await tick(account, PRIVACY_NOTICE_VERSION).expect(200);
      expect((await read()).body.account.privacy_notice_acknowledged_at).toBe(
        ticked.body.acknowledged_at,
      );
    });
  });

  describe('the table', () => {
    it('refuses changing or removing a tick, and a notice that is not a date', async () => {
      const account = await leader(rosalind);
      await tick(account, PRIVACY_NOTICE_VERSION).expect(200);

      await expect(
        sql`UPDATE privacy_notice_acknowledgments SET acknowledged_at = now() - interval '1 day'`.execute(
          db,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(sql`DELETE FROM privacy_notice_acknowledgments`.execute(db)).rejects.toThrow(
        /append-only/,
      );
      await expect(
        db
          .insertInto('privacy_notice_acknowledgments')
          .values({ account_id: account.id, notice_version: 'today' })
          .execute(),
      ).rejects.toThrow(/privacy_notice_version_is_a_date/);
    });
  });
});
