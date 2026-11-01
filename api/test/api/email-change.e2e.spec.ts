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
import type { OutboundEmail } from '../../src/email/email.port';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'the first long passphrase';
const FRESH = 'a second long passphrase';

/**
 * Changing the email of an account in use, both ways (SKILL.md section 6, decision 0415).
 *
 * Fixture names and addresses are invented (CLAUDE.md, Secrets).
 */
describe('changing the email of an account in use (decision 0415)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let admin: TestAccount;
  let holder: TestAccount;

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
    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    holder = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Teodora', network: 'WOMENS' }),
      roles: ['LEADER'],
      passwordHash: await app.get(PasswordService).hash(PASSWORD),
    });
  });

  const server = () => request(app.getHttpServer());

  /** A message sent after the commit, without awaiting it, by the time it has gone. */
  async function sentEmail<K extends OutboundEmail['kind']>(
    kind: K,
  ): Promise<Extract<OutboundEmail, { kind: K }>> {
    for (let i = 0; i < 50; i += 1) {
      const found = outbox(app).last(kind);
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No ${kind} email was captured.`);
  }

  async function signIn(email: string, password = PASSWORD) {
    return server().post('/api/v1/auth/login').send({ email, password });
  }

  async function storedAccount(id: string) {
    return db
      .selectFrom('accounts')
      .select(['email', 'email_normalized', 'status', 'password_hash'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  const audited = (action: 'account.email_changed' | 'account.email_replaced') =>
    db
      .selectFrom('audit_log')
      .select(['actor_id', 'target_id', 'before', 'after'])
      .where('action', '=', action)
      .execute();

  describe('by its holder, on their Account page', () => {
    function ask(
      body: Partial<{ new_email: string; current_password: string }> = {},
      account: TestAccount = holder,
      key = randomUUID(),
    ) {
      return server()
        .post('/api/v1/auth/email')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ new_email: 'Teodora.New@Example.test', current_password: PASSWORD, ...body });
    }

    const confirm = (token: string | undefined) =>
      server().post('/api/v1/auth/email/confirm').send({ token });

    it('changes nothing until the link sent to the new address is confirmed', async () => {
      await ask().expect(204);

      const link = await sentEmail('EMAIL_CHANGE');
      expect(link.to.email).toBe('Teodora.New@Example.test');
      expect((await storedAccount(holder.id)).email).toBe(holder.email);
      expect(await audited('account.email_changed')).toEqual([]);

      const confirmed = await confirm(link.token);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toEqual({ email: 'Teodora.New@Example.test' });

      const stored = await storedAccount(holder.id);
      expect(stored.email).toBe('Teodora.New@Example.test');
      expect(stored.email_normalized).toBe('teodora.new@example.test');
      expect(stored.status).toBe('ACTIVE');

      // The holder made the change, so their sessions are kept and the password stands.
      await server()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${holder.accessToken}`)
        .expect(200);
      expect((await signIn('teodora.new@example.test')).status).toBe(200);

      expect(await audited('account.email_changed')).toEqual([
        {
          actor_id: holder.id,
          target_id: holder.id,
          before: { email: holder.email },
          after: { email: 'Teodora.New@Example.test' },
        },
      ]);

      const notice = await sentEmail('EMAIL_CHANGED');
      expect(notice.to.email).toBe(holder.email);
      expect(notice.byAdministrator).toBe(false);
      expect(notice).not.toHaveProperty('token');
    });

    it('works once: the same link a second time is refused', async () => {
      await ask().expect(204);
      const link = await sentEmail('EMAIL_CHANGE');

      await confirm(link.token).expect(200);
      const again = await confirm(link.token);

      expect(again.status).toBe(422);
      expect(again.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a wrong current password, and sends nothing', async () => {
      const response = await ask({ current_password: 'not the right passphrase' });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('current_password');
      expect(outbox(app).sent.filter((sent) => sent.kind === 'EMAIL_CHANGE')).toEqual([]);
    });

    it('refuses the address the account already has', async () => {
      const response = await ask({ new_email: holder.email.toUpperCase() });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('does not say at the request that another account holds the address, and refuses it at the link', async () => {
      // Answered as any other request, so a signed-in person learns nothing about the address.
      await ask({ new_email: admin.email }).expect(204);
      const link = await sentEmail('EMAIL_CHANGE');

      const confirmed = await confirm(link.token);

      expect(confirmed.status).toBe(409);
      expect(confirmed.body.error.code).toBe('INVARIANT_VIOLATION');
      expect((await storedAccount(holder.id)).email).toBe(holder.email);
    });

    it('asking again replaces the earlier link', async () => {
      await ask({ new_email: 'first@example.test' }).expect(204);
      const first = await sentEmail('EMAIL_CHANGE');
      outbox(app).reset();
      await ask({ new_email: 'second@example.test' }).expect(204);
      const second = await sentEmail('EMAIL_CHANGE');

      expect((await confirm(first.token)).status).toBe(422);
      await confirm(second.token).expect(200);
      expect((await storedAccount(holder.id)).email).toBe('second@example.test');
    });

    it('stops a reset link already mailed to the old address from working', async () => {
      await server().post('/api/v1/auth/forgot-password').send({ email: holder.email });
      const reset = await sentEmail('PASSWORD_RESET');
      await ask().expect(204);
      await confirm((await sentEmail('EMAIL_CHANGE')).token).expect(200);

      const redeemed = await server()
        .post('/api/v1/auth/reset-password')
        .send({ token: reset.token, password: FRESH });

      expect(redeemed.status).toBe(422);
    });

    it('ends a pending link when the password is reset, so taking the account back sticks', async () => {
      await ask({ new_email: 'attacker@example.test' }).expect(204);
      const link = await sentEmail('EMAIL_CHANGE');
      await server().post('/api/v1/auth/forgot-password').send({ email: holder.email });
      const reset = await sentEmail('PASSWORD_RESET');
      await server()
        .post('/api/v1/auth/reset-password')
        .send({ token: reset.token, password: FRESH })
        .expect(200);

      expect((await confirm(link.token)).status).toBe(422);
      expect((await storedAccount(holder.id)).email).toBe(holder.email);
    });

    it('ends a pending link when the password is changed while signed in', async () => {
      await ask({ new_email: 'attacker@example.test' }).expect(204);
      const link = await sentEmail('EMAIL_CHANGE');
      const device = await signIn(holder.email);
      await server()
        .post('/api/v1/auth/password')
        .set('Authorization', `Bearer ${device.body.access_token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          current_password: PASSWORD,
          new_password: FRESH,
          refresh_token: device.body.refresh_token,
        })
        .expect(204);

      expect((await confirm(link.token)).status).toBe(422);
      expect((await storedAccount(holder.id)).email).toBe(holder.email);
    });

    it('answers requests sent at once with success or a retry, never a server error', async () => {
      const answers = await Promise.all(
        Array.from({ length: 6 }, (_, i) => ask({ new_email: `at-once-${i}@example.test` })),
      );

      for (const answer of answers) {
        expect([204, 503]).toContain(answer.status);
        if (answer.status === 503) {
          expect(answer.body.error.code).toBe('RESOURCE_BUSY');
        }
      }
    });

    it('fails for an account disabled since the link was sent', async () => {
      await ask().expect(204);
      const link = await sentEmail('EMAIL_CHANGE');
      await db
        .updateTable('accounts')
        .set({ status: 'DISABLED' })
        .where('id', '=', holder.id)
        .execute();

      const confirmed = await confirm(link.token);

      expect(confirmed.status).toBe(422);
      expect((await storedAccount(holder.id)).email).toBe(holder.email);
    });

    it('refuses a request without a session', async () => {
      const response = await server()
        .post('/api/v1/auth/email')
        .set('Idempotency-Key', randomUUID())
        .send({ new_email: 'nobody@example.test', current_password: PASSWORD });

      expect(response.status).toBe(401);
    });

    it('replays a retry rather than sending a second link', async () => {
      const key = randomUUID();
      await ask({}, holder, key).expect(204);
      await sentEmail('EMAIL_CHANGE');
      const sentBefore = outbox(app).sent.length;

      await ask({}, holder, key).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(outbox(app).sent.length).toBe(sentBefore);
    });
  });

  describe('by an administrator, for someone who has lost the mailbox', () => {
    function change(
      accountId: string,
      body: Record<string, unknown>,
      account: TestAccount = admin,
      key = randomUUID(),
    ) {
      return server()
        .post(`/api/v1/accounts/${accountId}/email`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', key)
        .send(body);
    }

    it('starts the account over at the new address, and tells the old one', async () => {
      const before = await signIn(holder.email);
      expect(before.status).toBe(200);

      const response = await change(holder.id, {
        email: 'Teodora.Found@Example.test',
        restart: true,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: holder.id,
        email: 'Teodora.Found@Example.test',
        status: 'PENDING_ACTIVATION',
      });

      const stored = await storedAccount(holder.id);
      expect(stored.status).toBe('PENDING_ACTIVATION');
      expect(stored.password_hash).toBeNull();

      // Signed out everywhere, and the old password no longer works.
      expect(
        (
          await server()
            .post('/api/v1/auth/refresh')
            .send({ refresh_token: before.body.refresh_token })
        ).status,
      ).toBe(401);
      expect((await signIn('teodora.found@example.test')).status).toBe(401);

      const activation = await sentEmail('ACTIVATION');
      expect(activation.to.email).toBe('Teodora.Found@Example.test');
      const notice = await sentEmail('EMAIL_CHANGED');
      expect(notice.to.email).toBe(holder.email);
      expect(notice.byAdministrator).toBe(true);

      await server()
        .post('/api/v1/auth/activate')
        .send({ token: activation.token, password: FRESH })
        .expect(204);
      expect((await signIn('teodora.found@example.test', FRESH)).status).toBe(200);

      expect(await audited('account.email_replaced')).toEqual([
        {
          actor_id: admin.id,
          target_id: holder.id,
          before: { email: holder.email, status: 'ACTIVE' },
          after: { email: 'Teodora.Found@Example.test', status: 'PENDING_ACTIVATION' },
        },
      ]);
    });

    it('refuses an account in use when the request does not say it starts over', async () => {
      const response = await change(holder.id, { email: 'teodora.found@example.test' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect((await storedAccount(holder.id)).status).toBe('ACTIVE');
    });

    it('kills a link the holder asked for before the change', async () => {
      await server()
        .post('/api/v1/auth/email')
        .set('Authorization', `Bearer ${holder.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ new_email: 'elsewhere@example.test', current_password: PASSWORD })
        .expect(204);
      const link = await sentEmail('EMAIL_CHANGE');

      await change(holder.id, { email: 'teodora.found@example.test', restart: true }).expect(200);

      expect(
        (await server().post('/api/v1/auth/email/confirm').send({ token: link.token })).status,
      ).toBe(422);
      expect((await storedAccount(holder.id)).email).toBe('teodora.found@example.test');
    });

    it('refuses the administrator’s own account', async () => {
      const response = await change(admin.id, { email: 'nora.new@example.test', restart: true });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect((await storedAccount(admin.id)).status).toBe('ACTIVE');
    });

    it('refuses a disabled account', async () => {
      await db
        .updateTable('accounts')
        .set({ status: 'DISABLED' })
        .where('id', '=', holder.id)
        .execute();

      const response = await change(holder.id, {
        email: 'teodora.found@example.test',
        restart: true,
      });

      expect(response.status).toBe(409);
      expect((await storedAccount(holder.id)).status).toBe('DISABLED');
    });

    it('refuses an address another account holds', async () => {
      const response = await change(holder.id, { email: admin.email, restart: true });

      expect(response.status).toBe(409);
      expect((await storedAccount(holder.id)).status).toBe('ACTIVE');
    });

    it('refuses an actor without accounts.manage', async () => {
      const leader = await createAccount(app, db, {
        person: await createPerson(db, { firstName: 'Rico', network: 'MENS' }),
        roles: ['LEADER'],
      });

      const response = await change(
        holder.id,
        { email: 'teodora.found@example.test', restart: true },
        leader,
      );

      expect(response.status).toBe(403);
      expect((await storedAccount(holder.id)).status).toBe('ACTIVE');
    });

    it('still answers 200 when the emails cannot be delivered, and the change stands', async () => {
      outbox(app).failNext = true;

      const response = await change(holder.id, {
        email: 'teodora.found@example.test',
        restart: true,
      });

      expect(response.status).toBe(200);
      expect((await storedAccount(holder.id)).email).toBe('teodora.found@example.test');
    });
  });
});
