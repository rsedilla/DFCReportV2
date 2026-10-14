import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
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
