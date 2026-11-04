import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
import { BROWSER_IDLE_MINUTES, TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';

/**
 * A browser session ends after a spell without activity, and a session begun in the
 * installed app keeps the thirty days (SKILL.md section 6, decision 0435). Its own file
 * because sign-in is limited to ten a minute. Names are invented.
 */
describe('idle sign-out (decision 0435)', () => {
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
    account = await createAccount(app, db, { person: raymond, roles: ['LEADER'], passwordHash });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const IDLE_MS = BROWSER_IDLE_MINUTES * 60 * 1000;

  const rowFor = async (refreshToken: string) =>
    db
      .selectFrom('refresh_tokens')
      .select(['id', 'issued_at', 'idle_expires_at', 'revoked_at'])
      .where('id', '=', (await tokens.findRefreshToken(refreshToken))!.id)
      .executeTakeFirstOrThrow();

  const signIn = (extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: PASSWORD, ...extra })
      .expect(200);

  it('gives a session begun in a browser, the default, an idle deadline', async () => {
    const response = await signIn();
    const row = await rowFor(response.body.refresh_token);

    expect(row.idle_expires_at).not.toBeNull();
    expect(row.idle_expires_at!.getTime() - row.issued_at.getTime()).toBe(IDLE_MS);
  });

  it('gives a session begun in the installed app none, and keeps it none on rotation', async () => {
    const response = await signIn({ session_kind: 'INSTALLED' });
    expect((await rowFor(response.body.refresh_token)).idle_expires_at).toBeNull();

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: response.body.refresh_token })
      .expect(200);
    expect((await rowFor(refreshed.body.refresh_token)).idle_expires_at).toBeNull();
  });

  it('renews a browser session for a fresh span from each rotation', async () => {
    const response = await signIn({ session_kind: 'BROWSER' });
    expect((await rowFor(response.body.refresh_token)).idle_expires_at).not.toBeNull();

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: response.body.refresh_token })
      .expect(200);
    const row = await rowFor(refreshed.body.refresh_token);

    expect(row.idle_expires_at!.getTime() - row.issued_at.getTime()).toBe(IDLE_MS);
  });

  it('refuses to renew a browser session past its deadline, and touches no other session', async () => {
    const idle = {
      body: { refresh_token: (await tokens.issueRefreshToken(account.id, null, true)).token },
    };
    const other = {
      body: { refresh_token: (await tokens.issueRefreshToken(account.id, null, false)).token },
    };
    const row = await rowFor(idle.body.refresh_token);
    // Gone quiet: issued two hours ago, its deadline a minute past.
    await db
      .updateTable('refresh_tokens')
      .set({
        issued_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        idle_expires_at: new Date(Date.now() - 60 * 1000),
      })
      .where('id', '=', row.id)
      .execute();

    const refused = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: idle.body.refresh_token });
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe('UNAUTHENTICATED');

    // An idle session ending is not a reuse signal: the other device is untouched.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: other.body.refresh_token })
      .expect(200);
  });

  it('refuses an unknown session kind', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: PASSWORD, session_kind: 'KIOSK' });

    expect(response.status).toBe(422);
    expect(response.body.error.details.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'session_kind' })]),
    );
  });

  /** Puts a refresh token's idle deadline a minute behind us, issued two hours ago. */
  const goQuiet = (id: string) =>
    db
      .updateTable('refresh_tokens')
      .set({
        issued_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        idle_expires_at: new Date(Date.now() - 60 * 1000),
      })
      .where('id', '=', id)
      .execute();

  it('does not serve a lost-response retry onto a replacement gone quiet', async () => {
    const issued = await tokens.issueRefreshToken(account.id, null, true);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: issued.token })
      .expect(200);
    await goQuiet((await tokens.findRefreshToken(rotated.body.refresh_token))!.id);

    // The first token again, inside the sixty seconds: a retry, but onto a session that
    // can no longer be renewed.
    const retried = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: issued.token });
    expect(retried.status).toBe(401);
  });

  it('keeps no idle session through a password change, and answers rather than failing', async () => {
    const quiet = await tokens.issueRefreshToken(account.id, null, true);
    await goQuiet(quiet.id);

    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        current_password: PASSWORD,
        new_password: 'a-second-password-only-this-test-uses',
        refresh_token: quiet.token,
      });
    expect(changed.status).toBe(204);

    // Not kept: revoked with every other session, since a refresh would not renew it.
    const row = await db
      .selectFrom('refresh_tokens')
      .select(['revoked_at'])
      .where('id', '=', quiet.id)
      .executeTakeFirstOrThrow();
    expect(row.revoked_at).not.toBeNull();
  });

  it('carries a kept browser session across a password change with a fresh deadline', async () => {
    const kept = await tokens.issueRefreshToken(account.id, null, true);

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        current_password: PASSWORD,
        new_password: 'a-second-password-only-this-test-uses',
        refresh_token: kept.token,
      })
      .expect(204);

    const row = await db
      .selectFrom('refresh_tokens')
      .select(['issued_at', 'idle_expires_at', 'revoked_at'])
      .where('id', '=', kept.id)
      .executeTakeFirstOrThrow();
    expect(row.revoked_at).toBeNull();
    // Dated past the change, its deadline moved with it rather than left behind its issue.
    expect(row.idle_expires_at!.getTime() - row.issued_at.getTime()).toBe(
      BROWSER_IDLE_MINUTES * 60 * 1000,
    );
  });
});
