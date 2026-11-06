import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
import { ELEVATED_SESSION_DAYS, SESSION_DAYS, TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A session ends a fixed time after its sign-in, however often it is used: thirty days,
 * and seven for an `ADMIN` or `SENIOR_PASTOR` account (SKILL.md section 6, decision 0450).
 * Its own file because sign-in is limited to ten a minute. Names are invented.
 */
describe('session age (decision 0450)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let tokens: TokensService;
  let leader: TestAccount;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    tokens = app.get(TokensService);
  });

  beforeEach(async () => {
    await truncateAll(db);
    const passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    leader = await createAccount(app, db, { person: raymond, roles: ['LEADER'], passwordHash });
    const alma = await createPerson(db, { firstName: 'Alma', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: alma, roles: ['ADMIN'], passwordHash });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const rowFor = async (refreshToken: string) =>
    db
      .selectFrom('refresh_tokens')
      .select(['id', 'issued_at', 'expires_at', 'session_ends_at'])
      .where('id', '=', (await tokens.findRefreshToken(refreshToken))!.id)
      .executeTakeFirstOrThrow();

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: refreshToken });

  /** Moves a session's sign-in into the past, keeping the row's own checks true. */
  const signedInDaysAgo = async (refreshToken: string, days: number, limit: number) => {
    const id = (await tokens.findRefreshToken(refreshToken))!.id;
    const signedIn = new Date(Date.now() - days * DAY_MS);
    const ends = new Date(signedIn.getTime() + limit * DAY_MS);
    await db
      .updateTable('refresh_tokens')
      .set({ issued_at: signedIn, expires_at: ends, session_ends_at: ends })
      .where('id', '=', id)
      .execute();
  };

  it('gives a leader’s sign-in thirty days', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: leader.email, password: PASSWORD, session_kind: 'INSTALLED' })
      .expect(200);
    const row = await rowFor(response.body.refresh_token);

    expect(row.session_ends_at!.getTime() - row.issued_at.getTime()).toBe(SESSION_DAYS * DAY_MS);
    expect(row.expires_at.getTime()).toBeLessThanOrEqual(row.session_ends_at!.getTime());
  });

  it('gives an Admin’s sign-in seven days, and the refresh token no longer', async () => {
    const issued = await tokens.issueRefreshToken(admin.id, null, false);
    const row = await rowFor(issued.token);

    expect(row.session_ends_at!.getTime() - row.issued_at.getTime()).toBe(
      ELEVATED_SESSION_DAYS * DAY_MS,
    );
    expect(row.expires_at.getTime()).toBe(row.session_ends_at!.getTime());
  });

  it('carries the end unchanged through renewing, however often', async () => {
    const issued = await tokens.issueRefreshToken(leader.id, null, false);
    const first = await rowFor(issued.token);

    let token = issued.token;
    for (let i = 0; i < 3; i += 1) {
      token = (await refresh(token).expect(200)).body.refresh_token;
    }
    const last = await rowFor(token);

    expect(last.session_ends_at!.getTime()).toBe(first.session_ends_at!.getTime());
    expect(last.expires_at.getTime()).toBeLessThanOrEqual(last.session_ends_at!.getTime());
  });

  it('refuses to renew an installed-app session thirty days after its sign-in, and says why', async () => {
    const issued = await tokens.issueRefreshToken(leader.id, null, false);
    await signedInDaysAgo(issued.token, SESSION_DAYS + 1, SESSION_DAYS);

    const refused = await refresh(issued.token).expect(401);

    expect(refused.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'It has been 30 days since you signed in on this device. Sign in again.',
      details: { reason: 'SESSION_AGE', days: 30 },
    });
  });

  it('says seven days to an Admin', async () => {
    const issued = await tokens.issueRefreshToken(admin.id, null, false);
    await signedInDaysAgo(issued.token, ELEVATED_SESSION_DAYS + 1, ELEVATED_SESSION_DAYS);

    const refused = await refresh(issued.token).expect(401);

    expect(refused.body.error.details).toEqual({ reason: 'SESSION_AGE', days: 7 });
  });

  it('still renews a session one day short of its end', async () => {
    const issued = await tokens.issueRefreshToken(leader.id, null, false);
    await signedInDaysAgo(issued.token, SESSION_DAYS - 1, SESSION_DAYS);

    const renewed = await refresh(issued.token).expect(200);
    const row = await rowFor(renewed.body.refresh_token);

    // The replacement ends with the session, a day from now, not thirty.
    expect(row.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(DAY_MS);
  });

  it('refuses at the database a refresh token outliving its session', async () => {
    const issued = await tokens.issueRefreshToken(leader.id, null, false);
    const row = await rowFor(issued.token);

    await expect(
      db
        .updateTable('refresh_tokens')
        .set({ expires_at: new Date(row.session_ends_at!.getTime() + 1) })
        .where('id', '=', row.id)
        .execute(),
    ).rejects.toThrow(/refresh_tokens_expire_by_session_end/);
  });

  /** Ends a session a second ago, its token issued `issuedSecondsAgo` before now. */
  const endedJustNow = async (id: string, issuedSecondsAgo = 10) => {
    const now = Date.now();
    await db
      .updateTable('refresh_tokens')
      .set({
        issued_at: new Date(now - issuedSecondsAgo * 1000),
        expires_at: new Date(now - 1000),
        session_ends_at: new Date(now - 1000),
      })
      .where('id', '=', id)
      .execute();
  };

  it('is no reuse signal: another session on the account keeps renewing', async () => {
    const ended = await tokens.issueRefreshToken(leader.id, null, false);
    const other = await tokens.issueRefreshToken(leader.id, null, false);
    await signedInDaysAgo(ended.token, SESSION_DAYS + 1, SESSION_DAYS);

    await refresh(ended.token).expect(401);

    await refresh(other.token).expect(200);
  });

  it('answers a lost-response retry across the end as the end, and signs out no other device', async () => {
    const presented = await tokens.issueRefreshToken(leader.id, null, false);
    const other = await tokens.issueRefreshToken(leader.id, null, false);
    // Rotated, and its answer lost: the replacement was never received.
    const lost = (await refresh(presented.token).expect(200)).body.refresh_token as string;
    await endedJustNow((await tokens.findRefreshToken(lost))!.id);

    const retried = await refresh(presented.token).expect(401);

    expect(retried.body.error.details).toEqual({ reason: 'SESSION_AGE', days: 30 });
    await refresh(other.token).expect(200);
  });

  it('refuses, without spending it, a renewal that reaches the end while it waits', async () => {
    const issued = await tokens.issueRefreshToken(leader.id, null, false);
    const row = await rowFor(issued.token);
    await endedJustNow(row.id);

    // The rotation itself, as `refresh` calls it after checking an end not yet reached.
    await expect(
      tokens.rotateRefreshToken(row.id, leader.id, null, new Date(Date.now() - 10_000)),
    ).rejects.toMatchObject({ details: { reason: 'SESSION_AGE', days: 30 } });

    const after = await db
      .selectFrom('refresh_tokens')
      .select(['revoked_at', 'replaced_by_id'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ revoked_at: null, replaced_by_id: null });
  });

  it('keeps the end unchanged for the session a password change keeps', async () => {
    const signedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: leader.email, password: PASSWORD, session_kind: 'INSTALLED' })
      .expect(200);
    const before = await rowFor(signedIn.body.refresh_token);

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${signedIn.body.access_token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        current_password: PASSWORD,
        new_password: 'another-password-only-this-test-uses',
        refresh_token: signedIn.body.refresh_token,
      })
      .expect(204);

    const kept = await rowFor(signedIn.body.refresh_token);
    expect(kept.session_ends_at!.getTime()).toBe(before.session_ends_at!.getTime());
    await refresh(signedIn.body.refresh_token).expect(200);
  });
});
