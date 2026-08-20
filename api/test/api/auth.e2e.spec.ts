import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';

/**
 * The authentication skeleton of SKILL.md section 6: short-lived access tokens,
 * rotating refresh tokens, several concurrent sessions per account, and
 * account-wide revocation that takes effect immediately rather than when a token
 * happens to expire.
 */
describe('authentication (SKILL.md section 6)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let tokens: TokensService;
  let account: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    tokens = app.get(TokensService);
  });

  beforeEach(async () => {
    await truncateAll(db);

    const passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    account = await createAccount(app, db, { person: raymond, roles: ['LEADER'], passwordHash });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('sign-in', () => {
    it('issues an access token that lives fifteen minutes, and a refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: PASSWORD, device_label: 'Test phone' });

      expect(response.status).toBe(200);
      expect(response.body.token_type).toBe('Bearer');
      expect(response.body.expires_in).toBe(ACCESS_TOKEN_TTL_SECONDS);
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
      expect(typeof response.body.access_token).toBe('string');
      expect(typeof response.body.refresh_token).toBe('string');
    });

    it('answers a wrong password exactly as it answers an unknown address', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: 'not the password' });

      const unknownAccount = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.test', password: PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownAccount.body);
      expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('stores no token, only a hash of one', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: PASSWORD });

      const rows = await db.selectFrom('refresh_tokens').select('token_hash').execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(response.body.refresh_token);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('the caller session', () => {
    it('describes itself and the grants it carries', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.account_id).toBe(account.id);
      expect(response.body.person_id).toBe(account.personId);
      expect(response.body.capabilities).toContainEqual(
        expect.objectContaining({
          capability: 'people.view_subtree',
          scope_type: 'OWN_SUBTREE',
          source: 'role',
        }),
      );
    });
  });

  describe('refresh tokens rotate on use', () => {
    it('revokes the presented token and issues a new one', async () => {
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(response.status).toBe(200);
      expect(response.body.refresh_token).not.toBe(issued.token);

      const original = await db
        .selectFrom('refresh_tokens')
        .select(['revoked_at', 'replaced_by_id'])
        .where('id', '=', issued.id)
        .executeTakeFirstOrThrow();

      expect(original.revoked_at).not.toBeNull();
      expect(original.replaced_by_id).not.toBeNull();
    });

    it('treats a replayed token as a copy in circulation and revokes the account', async () => {
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(replay.status).toBe(401);

      // Not just this token: every session the account holds.
      const live = await db
        .selectFrom('refresh_tokens')
        .select('id')
        .where('account_id', '=', account.id)
        .where('revoked_at', 'is', null)
        .execute();

      expect(live).toHaveLength(0);
    });
  });

  describe('several devices at once', () => {
    it('signs out one device without touching the other', async () => {
      const phone = await tokens.issueRefreshToken(account.id, 'Test phone');
      const laptop = await tokens.issueRefreshToken(account.id, 'Test laptop');

      const signOut = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ refresh_token: phone.token });

      expect(signOut.status).toBe(204);

      const phoneRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: phone.token });
      expect(phoneRefresh.status).toBe(401);

      // A signed-out token presented again is a retry from a device that has
      // just signed out, not a copy in circulation. It is refused, and nothing
      // else is: rotation is what marks a token as reused, and this token was
      // never rotated.
      const marker = await db
        .selectFrom('accounts')
        .select('sessions_revoked_at')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();
      expect(marker.sessions_revoked_at).toBeNull();

      const laptopRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: laptop.token });
      expect(laptopRefresh.status).toBe(200);
    });
  });

  describe('account-wide revocation', () => {
    it('invalidates every session immediately, including access tokens already issued', async () => {
      const laptop = await tokens.issueRefreshToken(account.id, 'Test laptop');

      const before = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`);
      expect(before.status).toBe(200);

      const revoked = await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${account.accessToken}`);
      expect(revoked.status).toBe(204);

      // An access token carries no row of its own, so this is the check that makes
      // "immediately" true: sessions_revoked_at against the token's issued-at.
      const after = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`);
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('UNAUTHENTICATED');

      const laptopRefresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: laptop.token });
      expect(laptopRefresh.status).toBe(401);

      const marker = await db
        .selectFrom('accounts')
        .select('sessions_revoked_at')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();
      expect(marker.sessions_revoked_at).not.toBeNull();
    });
  });

  describe('the error envelope (SKILL.md section 22)', () => {
    it('rejects malformed input as VALIDATION_FAILED, with the fields at fault', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.fields).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
      );
    });
  });
});
