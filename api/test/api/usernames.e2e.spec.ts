import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { AccountTokensService } from '../../src/auth/account-tokens.service';
import { PasswordService } from '../../src/auth/password.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

const PASSWORD = 'a long enough passphrase';

/**
 * Signing in with a username (SKILL.md sections 6, 7 and 21, decision 0337).
 *
 * Fixture names are invented (CLAUDE.md, Secrets): Rogelio Bayani Santiago suggests
 * `rbsantiago`.
 */
describe('usernames (decision 0337)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let rogelio: TestPerson;

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
    rogelio = await createPerson(db, {
      firstName: 'Rogelio',
      middleName: 'Bayani',
      lastName: 'Santiago',
      network: 'MENS',
    });
  });

  const server = () => request(app.getHttpServer());

  /** An active Leader account that can sign in with `PASSWORD`, optionally named. */
  async function active(person: TestPerson, username: string | null = null): Promise<TestAccount> {
    const account = await createAccount(app, db, {
      person,
      roles: ['LEADER'],
      passwordHash: await app.get(PasswordService).hash(PASSWORD),
    });
    if (username !== null) {
      await db.updateTable('accounts').set({ username }).where('id', '=', account.id).execute();
    }
    return account;
  }

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

  const usernameOf = async (accountId: string) =>
    (
      await db
        .selectFrom('accounts')
        .select('username')
        .where('id', '=', accountId)
        .executeTakeFirstOrThrow()
    ).username;

  describe('sign-in', () => {
    it('takes the username in any capitals, or the email address', async () => {
      const account = await active(rogelio, 'rbsantiago');

      for (const body of [
        { username: 'rbsantiago', password: PASSWORD },
        { username: ' RBSantiago ', password: PASSWORD },
        { email: account.email, password: PASSWORD },
      ]) {
        const response = await server().post('/api/v1/auth/login').send(body);
        expect(response.status).toBe(200);
        expect(response.body.access_token).toEqual(expect.any(String));
      }
    });

    it('answers a wrong username and a wrong password alike', async () => {
      await active(rogelio, 'rbsantiago');

      const wrongName = await server()
        .post('/api/v1/auth/login')
        .send({ username: 'nobodyhere', password: PASSWORD });
      const wrongPassword = await server()
        .post('/api/v1/auth/login')
        .send({ username: 'rbsantiago', password: 'not the right passphrase' });

      expect(wrongName.status).toBe(401);
      expect(wrongPassword.status).toBe(401);
      expect(wrongName.body).toEqual(wrongPassword.body);
    });

    it('refuses both an email address and a username, or neither', async () => {
      const account = await active(rogelio, 'rbsantiago');

      for (const body of [
        { email: account.email, username: 'rbsantiago', password: PASSWORD },
        { password: PASSWORD },
        // A null is an omitted key (decision 0199), never a 500.
        { email: null, password: PASSWORD },
        { username: null, password: PASSWORD },
        { email: null, username: null, password: PASSWORD },
      ]) {
        const response = await server().post('/api/v1/auth/login').send(body);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      // A null beside a real one is the real one alone.
      await server()
        .post('/api/v1/auth/login')
        .send({ email: null, username: 'rbsantiago', password: PASSWORD })
        .expect(200);
    });

    it('still asks an Admin signing in by username for the second step', async () => {
      const account = await createAccount(app, db, {
        person: rogelio,
        roles: ['ADMIN'],
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
      });
      await db
        .updateTable('accounts')
        .set({ username: 'rbsantiago' })
        .where('id', '=', account.id)
        .execute();

      const response = await server()
        .post('/api/v1/auth/login')
        .send({ username: 'rbsantiago', password: PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ second_step: 'CODE' });
      expect(response.body.access_token).toBeUndefined();
    });
  });

  describe('activation', () => {
    it('suggests a name without using the link, and sets it with the password, audited', async () => {
      const { accountId, token } = await pending(rogelio);

      const suggestion = await server()
        .post('/api/v1/auth/activate/username-suggestion')
        .send({ token });
      expect(suggestion.status).toBe(200);
      expect(suggestion.body).toEqual({ username: 'rbsantiago', taken: null });

      await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, username: 'RBSantiago' })
        .expect(204);

      expect(await usernameOf(accountId)).toBe('rbsantiago');
      const audit = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('action', '=', 'account.username_set')
        .execute();
      expect(audit).toEqual([{ before: { username: null }, after: { username: 'rbsantiago' } }]);
      await server()
        .post('/api/v1/auth/login')
        .send({ username: 'rbsantiago', password: PASSWORD })
        .expect(200);
    });

    it('activates without a username, as a client that predates them does, or with a null one', async () => {
      const { accountId, token } = await pending(rogelio);

      await server().post('/api/v1/auth/activate').send({ token, password: PASSWORD }).expect(204);
      expect(await usernameOf(accountId)).toBeNull();

      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      const second = await pending(other);
      await server()
        .post('/api/v1/auth/activate')
        .send({ token: second.token, password: PASSWORD, username: null })
        .expect(204);
      expect(await usernameOf(second.accountId)).toBeNull();
    });

    it('checks a name cut to make room for its number against the names already held', async () => {
      // A 30-letter suggestion: `l` + 29 letters of surname.
      const surname = 'Abcdefghijklmnopqrstuvwxyzabc';
      const person = await createPerson(db, {
        firstName: 'Lito',
        lastName: surname,
        network: 'MENS',
      });
      const base = `l${surname.toLowerCase()}`;
      expect(base).toHaveLength(30);
      const holder = await createPerson(db, {
        firstName: 'Lino',
        lastName: 'Cruz',
        network: 'MENS',
      });
      await active(holder, base);
      const second = await createPerson(db, {
        firstName: 'Lara',
        lastName: 'Cruz',
        network: 'WOMENS',
      });
      await active(second, `${base.slice(0, 29)}2`);
      const { token } = await pending(person);

      const suggestion = await server()
        .post('/api/v1/auth/activate/username-suggestion')
        .send({ token });

      expect(suggestion.body).toEqual({ username: `${base.slice(0, 29)}3`, taken: base });
    });

    it('moves a taken suggestion to the next free name, and says which was taken', async () => {
      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      await active(other, 'rbsantiago');
      const { token } = await pending(rogelio);

      const suggestion = await server()
        .post('/api/v1/auth/activate/username-suggestion')
        .send({ token });

      expect(suggestion.body).toEqual({ username: 'rbsantiago2', taken: 'rbsantiago' });
    });

    it('refuses a taken name without using the link, which then activates with another', async () => {
      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      await active(other, 'rbsantiago');
      const { accountId, token } = await pending(rogelio);

      const refused = await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, username: 'rbsantiago' });
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toMatchObject({ field: 'username' });
      expect(
        (
          await db
            .selectFrom('accounts')
            .select('status')
            .where('id', '=', accountId)
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe('PENDING_ACTIVATION');

      await server()
        .post('/api/v1/auth/activate')
        .send({ token, password: PASSWORD, username: 'rbsantiago2' })
        .expect(204);
    });

    it('answers an unusable link on the suggestion as activation does', async () => {
      const response = await server()
        .post('/api/v1/auth/activate/username-suggestion')
        .send({ token: 'not-a-token-anyone-issued' });

      expect(response.status).toBe(422);
      expect(response.body.error.details).toMatchObject({ field: 'token' });
    });
  });

  describe('the Account page', () => {
    const setOwn = (account: TestAccount, username: string) =>
      server()
        .post('/api/v1/auth/username')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ username });

    it('suggests, sets and changes the caller’s own name, freeing the old one', async () => {
      const account = await active(rogelio);

      const suggestion = await server()
        .get('/api/v1/auth/username-suggestion')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(suggestion.body).toEqual({ username: 'rbsantiago', taken: null });

      await setOwn(account, 'rbsantiago').expect(200);
      const me = await server()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(me.body.username).toBe('rbsantiago');

      await setOwn(account, 'rogelio7').expect(200);
      expect(await usernameOf(account.id)).toBe('rogelio7');

      // The old name is free at once.
      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      const otherAccount = await active(other);
      await setOwn(otherAccount, 'rbsantiago').expect(200);
    });

    it('refuses a taken name and a malformed one', async () => {
      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      await active(other, 'rbsantiago');
      const account = await active(rogelio);

      for (const name of ['rbsantiago', 'ab', '9lives', 'with space', 'name@example']) {
        const response = await setOwn(account, name);
        expect(response.status).toBe(422);
        expect(response.body.error.details).toMatchObject({ field: 'username' });
      }
    });

    it('allows ten suggestions a minute for an account, and refuses the eleventh', async () => {
      const account = await active(rogelio);
      const ask = () =>
        server()
          .get('/api/v1/auth/username-suggestion')
          .set('Authorization', `Bearer ${account.accessToken}`);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await ask().expect(200);
      }
      await ask().expect(429);
    });

    it('audits a change with the old name, and not the same name again', async () => {
      const account = await active(rogelio, 'rbsantiago');

      await setOwn(account, 'rogelio7').expect(200);
      await setOwn(account, 'rogelio7').expect(200);

      const audit = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('action', '=', 'account.username_set')
        .execute();
      expect(audit).toEqual([
        { before: { username: 'rbsantiago' }, after: { username: 'rogelio7' } },
      ]);
    });

    it('keeps the name of an account an administrator disables, so nobody else takes it', async () => {
      const account = await active(rogelio, 'rbsantiago');
      const adminPerson = await createPerson(db, { firstName: 'Adela', network: 'WOMENS' });
      const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });
      await server()
        .post(`/api/v1/accounts/${account.id}/disable`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);

      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      const response = await setOwn(await active(other), 'rbsantiago');

      expect(response.status).toBe(422);
      expect(await usernameOf(account.id)).toBe('rbsantiago');
    });

    it('shows an administrator the username on the person page', async () => {
      await active(rogelio, 'rbsantiago');
      const adminPerson = await createPerson(db, { firstName: 'Adela', network: 'WOMENS' });
      const admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

      const response = await server()
        .get(`/api/v1/accounts/for-person/${rogelio.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(response.body.account.username).toBe('rbsantiago');
    });
  });

  describe('the database', () => {
    it('holds the shape and one name per account as constraints', async () => {
      const first = await active(rogelio, 'rbsantiago');
      const other = await createPerson(db, {
        firstName: 'Ramil',
        lastName: 'Santiago',
        network: 'MENS',
      });
      const second = await active(other);

      await expect(
        db
          .updateTable('accounts')
          .set({ username: 'rbsantiago' })
          .where('id', '=', second.id)
          .execute(),
      ).rejects.toThrow(/accounts_username_key/);
      await expect(
        db
          .updateTable('accounts')
          .set({ username: 'RBSantiago' })
          .where('id', '=', first.id)
          .execute(),
      ).rejects.toThrow(/accounts_username_shape/);
    });
  });
});
