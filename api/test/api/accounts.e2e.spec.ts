import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp, outbox } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Provisioning, activation and password reset (SKILL.md section 6).
 *
 * **The token never appears in a response**, so every case that completes a flow
 * reads it from the captured outbox, exactly as the holder would read their inbox.
 * That is the point rather than an inconvenience: a test that could take the token
 * from the provisioning body would be passing against an API breaking section 6.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('accounts: provisioning, activation and reset (section 6)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let ester: TestPerson;

  const PASSWORD = 'a well chosen passphrase';

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    outbox(app).reset();

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    ester = await createPerson(db, { firstName: 'Ester', network: 'WOMENS' });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  function provision(
    body: Record<string, unknown>,
    account: TestAccount = admin,
    key: string = randomUUID(),
  ): request.Test {
    return request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  describe('provisioning', () => {
    it('creates the account, grants the role, and mails an activation token', async () => {
      const response = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'ADMIN',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        person_id: ester.id,
        status: 'PENDING_ACTIVATION',
        role: 'ADMIN',
      });

      // **No token, no password, nothing that sets one.** Section 6: an
      // administrator may not know or choose another user's password.
      expect(JSON.stringify(response.body)).not.toContain('token');

      const message = outbox(app).last('ACTIVATION');
      expect(message?.to.email).toBe('ester@example.test');
      expect(message?.token).toBeTruthy();

      // The role and the account are one transaction, so neither exists alone.
      const roles = await db
        .selectFrom('account_roles')
        .select(['role', 'granted_by'])
        .where('account_id', '=', response.body.id)
        .execute();

      expect(roles).toEqual([{ role: 'ADMIN', granted_by: admin.id }]);

      // Section 21 lists account creation and role changes separately, so each is
      // its own entry rather than one describing the request.
      const actions = await db
        .selectFrom('audit_log')
        .select('action')
        .where('target_id', '=', response.body.id)
        .execute();

      expect(actions.map((entry) => entry.action).sort()).toEqual([
        'account.created',
        'role.granted',
      ]);
    });

    it('refuses a LEADER account, because nothing can qualify one yet', async () => {
      // **The ruling this endpoint was blocked on.** A Leader account's
      // qualification is an active Cell leadership assignment (section 11), and
      // `cells` is Stage 3. Accepting it with the check deferred would detach
      // "leader" from "leads a Cell" for a whole stage.
      //
      // INVARIANT_VIOLATION rather than SCOPE_DENIED: the actor's authority is not
      // in question, and an Admin cannot do this either.
      const response = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'LEADER',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.role).toBe('LEADER');

      const accounts = await db
        .selectFrom('accounts')
        .select('id')
        .where('person_id', '=', ester.id)
        .execute();

      expect(accounts).toHaveLength(0);
      expect(outbox(app).sent).toHaveLength(0);
    });

    it('refuses a second account for one Person', async () => {
      // Section 6: one Person has at most one Account, whatever number of Cells
      // they lead. Refused rather than reused, which would silently re-invite
      // somebody whose account is already active.
      await provision({ person_id: ester.id, email: 'ester@example.test', role: 'ADMIN' });

      const again = await provision({
        person_id: ester.id,
        email: 'ester.second@example.test',
        role: 'ADMIN',
      });

      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('is refused to an actor without accounts.manage', async () => {
      const leader = await createAccount(app, db, {
        person: await createPerson(db, { firstName: 'Rico', network: 'MENS' }),
        roles: ['LEADER'],
      });

      const response = await provision(
        { person_id: ester.id, email: 'ester@example.test', role: 'ADMIN' },
        leader,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('replays a retry rather than provisioning twice', async () => {
      const key = randomUUID();
      const body = { person_id: ester.id, email: 'ester@example.test', role: 'ADMIN' };

      const first = await provision(body, admin, key);
      expect(first.status).toBe(201);

      const retry = await provision(body, admin, key);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);

      const accounts = await db
        .selectFrom('accounts')
        .select('id')
        .where('person_id', '=', ester.id)
        .execute();

      expect(accounts).toHaveLength(1);
    });
  });

  describe('activation', () => {
    async function provisionEster(): Promise<string> {
      await provision({ person_id: ester.id, email: 'ester@example.test', role: 'ADMIN' });
      const message = outbox(app).last('ACTIVATION');
      if (!message) {
        throw new Error('No activation email was captured.');
      }
      return message.token;
    }

    function activate(body: Record<string, unknown>): request.Test {
      return request(app.getHttpServer()).post('/api/v1/auth/activate').send(body);
    }

    it('sets the first password and makes the account signable-in', async () => {
      const token = await provisionEster();

      expect((await activate({ token, password: PASSWORD })).status).toBe(204);

      const signIn = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ester@example.test', password: PASSWORD });

      expect(signIn.status).toBe(200);
      expect(signIn.body.access_token).toBeTruthy();
    });

    it('is single-use, so a replayed link cannot set a second password', async () => {
      // **The mutation this fails against** is a read-then-write redemption, where
      // two requests presenting one token both pass the read. Section 6 makes
      // single-use a property rather than an intention.
      const token = await provisionEster();

      expect((await activate({ token, password: PASSWORD })).status).toBe(204);

      const replay = await activate({ token, password: 'a different passphrase' });
      expect(replay.status).toBe(422);
      expect(replay.body.error.code).toBe('VALIDATION_FAILED');

      // And the first password still works, so the replay changed nothing.
      const signIn = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ester@example.test', password: PASSWORD });

      expect(signIn.status).toBe(200);
    });

    it('refuses a password below the minimum, and sets nothing', async () => {
      const token = await provisionEster();

      const response = await activate({ token, password: 'short' });
      expect(response.status).toBe(422);

      // The token survives a refused attempt: a holder who typed something too
      // short must not have to ask for a new link.
      expect((await activate({ token, password: PASSWORD })).status).toBe(204);
    });

    it('refuses an unknown token the same way as a used one', async () => {
      const response = await activate({ token: 'not-a-real-token', password: PASSWORD });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('password reset', () => {
    function forgot(email: string): request.Test {
      return request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });
    }

    async function activeEster(): Promise<void> {
      await provision({ person_id: ester.id, email: 'ester@example.test', role: 'ADMIN' });
      const token = outbox(app).last('ACTIVATION')?.token;
      await request(app.getHttpServer())
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD });
      outbox(app).reset();
    }

    it('answers identically for an address that exists and one that does not', async () => {
      // Section 6: "Return the same forgot-password response whether or not the
      // email exists." The difference is only in what is mailed.
      await activeEster();

      const hit = await forgot('ester@example.test');
      const miss = await forgot('nobody@example.test');

      expect(hit.status).toBe(204);
      expect(miss.status).toBe(204);
      expect(hit.body).toEqual(miss.body);

      expect(outbox(app).sent).toHaveLength(1);
      expect(outbox(app).last('PASSWORD_RESET')?.to.email).toBe('ester@example.test');
    });

    it('replaces the password and ends every existing session', async () => {
      // **The half that is easy to omit.** Somebody resetting a password may be
      // doing it because a session is in hands that are not theirs, so section 6
      // makes this account-wide revocation rather than only a credential change.
      await activeEster();

      const before = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ester@example.test', password: PASSWORD });

      expect(before.status).toBe(200);

      await forgot('ester@example.test');
      const token = outbox(app).last('PASSWORD_RESET')?.token;

      const reset = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'an entirely new passphrase' });

      expect(reset.status).toBe(204);

      // The refresh token issued before the reset is dead.
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: before.body.refresh_token });

      expect(refresh.status).toBe(401);

      // The old password is gone and the new one works.
      const oldPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ester@example.test', password: PASSWORD });
      expect(oldPassword.status).toBe(401);

      const newPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ester@example.test', password: 'an entirely new passphrase' });
      expect(newPassword.status).toBe(200);
    });

    it('issuing a reset invalidates an outstanding one', async () => {
      // Section 6: "Issuing a new token of a purpose invalidates any outstanding
      // one of the same purpose for that account."
      await activeEster();

      await forgot('ester@example.test');
      const first = outbox(app).last('PASSWORD_RESET')?.token;

      await forgot('ester@example.test');
      const second = outbox(app).last('PASSWORD_RESET')?.token;

      expect(first).not.toBe(second);

      const stale = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: first, password: 'an entirely new passphrase' });

      expect(stale.status).toBe(422);

      const current = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: second, password: 'an entirely new passphrase' });

      expect(current.status).toBe(204);
    });

    it('answers 204 even when delivery fails, so the outcome is not an oracle', async () => {
      // **An error on the hit path and a success on the miss path is the same
      // disclosure the identical response exists to prevent**, wearing a different
      // hat. The failure is logged, not raised.
      await activeEster();
      outbox(app).failNext = true;

      const response = await forgot('ester@example.test');

      expect(response.status).toBe(204);
    });
  });
});
