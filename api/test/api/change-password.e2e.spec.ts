import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
import { TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
  outbox,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const OLD = 'the first long passphrase';
const NEW = 'a second long passphrase';

/**
 * Changing one's own password while signed in (SKILL.md section 6, decision 0351).
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('changing one’s own password (decision 0351)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let account: TestAccount;

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
    outbox(app).reset();
    const person = await createPerson(db, {
      firstName: 'Teodora',
      lastName: 'Malinao',
      network: 'WOMENS',
    });
    account = await createAccount(app, db, {
      person,
      roles: ['LEADER'],
      passwordHash: await app.get(PasswordService).hash(OLD),
    });
  });

  const server = () => request(app.getHttpServer());

  /** One device's session, from an ordinary sign-in. */
  async function signIn(password = OLD): Promise<{ access: string; refresh: string }> {
    const response = await server()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password });
    expect(response.status).toBe(200);
    return { access: response.body.access_token, refresh: response.body.refresh_token };
  }

  function change(
    device: { access: string; refresh: string },
    body: Partial<{ current_password: string; new_password: string; refresh_token: string }> = {},
    key = randomUUID(),
  ) {
    return server()
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${device.access}`)
      .set('Idempotency-Key', key)
      .send({
        current_password: OLD,
        new_password: NEW,
        refresh_token: device.refresh,
        ...body,
      });
  }

  const me = (access: string) =>
    server().get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);

  const refresh = (token: string) =>
    server().post('/api/v1/auth/refresh').send({ refresh_token: token });

  const audited = () =>
    db
      .selectFrom('audit_log')
      .select(['action', 'actor_id', 'target_id'])
      .where('action', '=', 'password.changed')
      .execute();

  it('refuses a wrong current password, naming the field, and changes nothing', async () => {
    const device = await signIn();

    const response = await change(device, { current_password: 'not the password at all' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.field).toBe('current_password');
    expect((await me(device.access)).status).toBe(200);
    await signIn(OLD);
    expect(await audited()).toHaveLength(0);
  });

  it('refuses a new password under twelve characters on the new_password field', async () => {
    const device = await signIn();

    const response = await change(device, { new_password: 'too short' });

    expect(response.status).toBe(422);
    expect(response.body.error.details.field).toBe('new_password');
    await signIn(OLD);
  });

  it('is refused without a session', async () => {
    const response = await server()
      .post('/api/v1/auth/password')
      .set('Idempotency-Key', randomUUID())
      .send({ current_password: OLD, new_password: NEW, refresh_token: 'x' });

    expect(response.status).toBe(401);
  });

  it('changes the password, ends every other session at once, and keeps this one', async () => {
    const here = await signIn();
    const elsewhere = await signIn();

    const response = await change(here);
    expect(response.status).toBe(204);

    // Every other device is out at once: its access token and its refresh token.
    expect((await me(elsewhere.access)).status).toBe(401);
    expect((await refresh(elsewhere.refresh)).status).toBe(401);

    // This device's access token predates the change too, so it refreshes, at once and
    // within the same second as the change, and the new token is honoured.
    expect((await me(here.access)).status).toBe(401);
    const renewed = await refresh(here.refresh);
    expect(renewed.status).toBe(200);
    expect((await me(renewed.body.access_token)).status).toBe(200);

    // The old password no longer signs in; the new one does.
    const old = await server()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: OLD });
    expect(old.status).toBe(401);
    await signIn(NEW);

    expect(await audited()).toEqual([
      { action: 'password.changed', actor_id: account.id, target_id: account.id },
    ]);
  });

  it('emails the holder that it changed, with no token', async () => {
    const device = await signIn();

    await change(device).expect(204);

    const notice = outbox(app).last('PASSWORD_CHANGED');
    expect(notice?.to.email).toBe(account.email);
    expect(notice).not.toHaveProperty('token');
  });

  it('answers a retry with the same key once, and audits once', async () => {
    const device = await signIn();
    const key = randomUUID();

    await change(device, {}, key).expect(204);
    // A client whose answer was lost finds its access token refused, renews it from the
    // session the change kept, and sends the same body with the same key.
    const renewed = await refresh(device.refresh);
    await change({ access: renewed.body.access_token, refresh: device.refresh }, {}, key).expect(
      204,
    );

    expect(await audited()).toHaveLength(1);
    expect(outbox(app).sent.filter((sent) => sent.kind === 'PASSWORD_CHANGED')).toHaveLength(1);
  });

  it('keeps no session when the refresh token sent is not this account’s live one', async () => {
    const here = await signIn();

    await change(here, { refresh_token: 'not a token this account holds' }).expect(204);

    expect((await refresh(here.refresh)).status).toBe(401);
    await signIn(NEW);
  });

  it('does not serve a copy of the token the kept session replaced as a retry', async () => {
    const before = await signIn();
    // This device renews, so `before.refresh` is spent and its replacement is never used
    // until the change keeps it: the retry window's signature, held by a copy.
    const renewed = await refresh(before.refresh);
    const here = { access: renewed.body.access_token, refresh: renewed.body.refresh_token };

    await change(here).expect(204);

    expect((await refresh(before.refresh)).status).toBe(401);
  });

  it('does not keep a session an earlier revocation already ended', async () => {
    const stale = await signIn();
    // The sign-in race of decision 0079: a row still live, issued before the marker.
    await db
      .updateTable('accounts')
      .set({ sessions_revoked_at: new Date(Date.now() + 5) })
      .where('id', '=', account.id)
      .execute();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const access = app.get(TokensService).issueAccessToken(account.id, account.personId);

    await change({ access, refresh: stale.refresh }).expect(204);

    expect((await refresh(stale.refresh)).status).toBe(401);
  });

  it('does not keep a session from before the second step the account owes', async () => {
    const adminPerson = await createPerson(db, {
      firstName: 'Leonora',
      lastName: 'Bacolod',
      network: 'WOMENS',
    });
    const admin = await createAccount(app, db, {
      person: adminPerson,
      roles: ['ADMIN'],
      passwordHash: await app.get(PasswordService).hash(OLD),
    });
    const tokens = app.get(TokensService);
    const early = await tokens.issueRefreshToken(admin.id, null);
    // The step set up after that session was issued, so a refresh refuses it (decision 0302).
    await db
      .updateTable('second_steps')
      .set({ set_up_at: new Date(Date.now() + 5) })
      .where('account_id', '=', admin.id)
      .execute();
    // Into the next whole second, so the guard reads this access token as after the setup.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const access = tokens.issueAccessToken(admin.id, admin.personId);

    await change({ access, refresh: early.token }).expect(204);

    expect((await refresh(early.token)).status).toBe(401);
  });

  describe('a wrong current password counts in the sign-in pause (decision 0448)', () => {
    const WRONG = 'not the password at all';

    const login = (password: string) =>
      server().post('/api/v1/auth/login').send({ email: account.email, password });

    const changeEmail = (device: { access: string }, currentPassword: string) =>
      server()
        .post('/api/v1/auth/email')
        .set('Authorization', `Bearer ${device.access}`)
        .set('Idempotency-Key', randomUUID())
        .send({ new_email: 'teodora.new@example.invalid', current_password: currentPassword });

    const pauses = () =>
      db
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'target_id', 'after'])
        .where('action', 'in', ['sign_in.paused', 'current_password.paused'])
        .execute();

    /** An active Admin, who is told about a pause. */
    async function anAdmin() {
      const person = await createPerson(db, {
        firstName: 'Leonora',
        lastName: 'Bacolod',
        network: 'WOMENS',
      });
      return createAccount(app, db, { person, roles: ['ADMIN'] });
    }

    async function tenWrong(device: { access: string; refresh: string }) {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await change(device, { current_password: WRONG });
      }
    }

    /** The alert is sent without being awaited, so it is waited for. */
    async function alertsSent(kind: 'CURRENT_PASSWORD_PAUSED' | 'SIGN_IN_PAUSED') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return outbox(app).sent.filter((sent) => sent.kind === kind);
    }

    it('pauses at the tenth, refuses the right one while it lasts, and pauses sign-in too', async () => {
      const device = await signIn();

      for (let attempt = 1; attempt <= 9; attempt += 1) {
        const wrong = await change(device, { current_password: WRONG });
        expect(wrong.status).toBe(422);
      }
      const tenth = await change(device, { current_password: WRONG });
      expect(tenth.status).toBe(429);
      expect(tenth.body.error.code).toBe('RATE_LIMITED');
      expect(tenth.body.error.details.reason).toBe('SIGN_IN_PAUSED');
      expect(Date.parse(tenth.body.error.details.paused_until)).toBeGreaterThan(Date.now());
      expect(tenth.body.error.message).toBe(
        'Paused for 15 minutes after 10 wrong passwords. Signing in with your email address is paused too; this device stays signed in.',
      );

      // Clear of the route's own per-minute limit, so what answers is the pause.
      resetRateLimits(app);
      const right = await change(device, { current_password: OLD });
      expect(right.status).toBe(429);
      expect(right.body.error.details.reason).toBe('SIGN_IN_PAUSED');

      const signedIn = await login(OLD);
      expect(signedIn.status).toBe(429);
      expect(signedIn.body.error.details.reason).toBe('SIGN_IN_PAUSED');

      // This device stays signed in, and the pause has its own entry naming the signed-in
      // account (owner, 2026-11-06).
      expect((await me(device.access)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const recorded = await pauses();
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        action: 'current_password.paused',
        actor_id: account.id,
        target_id: account.id,
      });
      expect(recorded[0].after).toMatchObject({ name: `email:${account.email.toLowerCase()}` });
      expect(await audited()).toHaveLength(0);
    });

    it('tells each Admin in its own words that a signed-in session was guessing', async () => {
      const admin = await anAdmin();
      const device = await signIn();

      await tenWrong(device);

      const sent = await alertsSent('CURRENT_PASSWORD_PAUSED');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: { email: admin.email }, email: account.email });
      expect(await alertsSent('SIGN_IN_PAUSED')).toHaveLength(0);
    });

    it('is not hidden by a sign-in alert already sent that day', async () => {
      await anAdmin();
      // Strangers paused the address at sign-in this morning, and the Admin was told.
      await db
        .insertInto('sign_in_pause_alerts')
        .values({ account_id: account.id, kind: 'PASSWORD' })
        .execute();
      const device = await signIn();

      await tenWrong(device);

      expect(await alertsSent('CURRENT_PASSWORD_PAUSED')).toHaveLength(1);
    });

    it('shares one count with sign-in and with the email form', async () => {
      const device = await signIn();

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect((await login(WRONG)).status).toBe(401);
      }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expect((await change(device, { current_password: WRONG })).status).toBe(422);
      }
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        expect((await changeEmail(device, WRONG)).status).toBe(422);
      }

      const tenth = await changeEmail(device, WRONG);
      expect(tenth.status).toBe(429);
      expect(tenth.body.error.details.reason).toBe('SIGN_IN_PAUSED');
    });

    it('starts the count again on a right one, as sign-in does', async () => {
      const device = await signIn();

      for (let attempt = 1; attempt <= 9; attempt += 1) {
        expect((await changeEmail(device, WRONG)).status).toBe(422);
      }
      expect((await changeEmail(device, OLD)).status).toBe(204);
      // Clear of the route's own per-minute limit, so what answers is the count.
      resetRateLimits(app);
      expect((await changeEmail(device, WRONG)).status).toBe(422);
    });

    it('does not keep the pause against the key, so the same body works once it ends', async () => {
      const device = await signIn();
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await change(device, { current_password: WRONG });
      }
      resetRateLimits(app);
      const key = randomUUID();
      expect((await change(device, {}, key)).status).toBe(429);

      // The pause ends.
      await db.deleteFrom('sign_in_pauses').execute();
      resetRateLimits(app);

      expect((await change(device, {}, key)).status).toBe(204);
      expect(await audited()).toHaveLength(1);
    });
  });

  it('does not keep another account’s session', async () => {
    const here = await signIn();
    const otherPerson = await createPerson(db, {
      firstName: 'Ernesto',
      lastName: 'Dumalagan',
      network: 'MENS',
    });
    const other = await createAccount(app, db, {
      person: otherPerson,
      roles: ['LEADER'],
      passwordHash: await app.get(PasswordService).hash(OLD),
    });
    const theirs = await server()
      .post('/api/v1/auth/login')
      .send({ email: other.email, password: OLD });

    await change(here, { refresh_token: theirs.body.refresh_token }).expect(204);

    // Mine is gone, theirs is untouched.
    expect((await refresh(here.refresh)).status).toBe(401);
    expect((await refresh(theirs.body.refresh_token)).status).toBe(200);
  });
});
