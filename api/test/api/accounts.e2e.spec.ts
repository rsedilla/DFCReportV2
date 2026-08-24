import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  createAccount,
  createPerson,
  createTestApp,
  outbox,
  resetRateLimits,
} from '../setup/fixtures';

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
    // Cases share an application and therefore a source address, and
    // `forgot-password` is deliberately limited to five a minute. Without this the
    // sixth call in the file is a 429 attributed to whatever that case was about —
    // which is how the limit was discovered rather than pinned.
    resetRateLimits(app);

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

    it('covers nothing when accounts.manage is granted narrower than Whole Church', async () => {
      // **The escalation this branch shipped and review caught.** Section 7 gives
      // `accounts.manage` one scope, and the guard alone cannot hold that: it asks
      // whether a grant covers the target, so a subtree-scoped grant passes for
      // everyone inside that subtree. A Leader holding one could provision
      // themselves an ADMIN account at an address they control and sign in as one.
      //
      // **The refusal case above does not pin this** — it uses a Leader with no
      // grant at all, so it passes equally against a service that honours a narrow
      // one. This is the case that fails if the rule is removed.
      const leaderPerson = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      const leader = await createAccount(app, db, { person: leaderPerson, roles: ['LEADER'] });

      // A distinct target. An earlier version named the Leader's own Person, who
      // already holds the account `createAccount` made for them — so "no account
      // exists" was false for a reason that had nothing to do with the rule.
      const target = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      await db
        .insertInto('capability_grants')
        .values({
          account_id: leader.id,
          capability: 'accounts.manage',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      const response = await provision(
        { person_id: target.id, email: 'manuel@example.test', role: 'ADMIN' },
        leader,
      );

      // **`SCOPE_DENIED`, not `CAPABILITY_DENIED`.** The account does hold
      // `accounts.manage`; what it does not hold is a scope at which that grant
      // means anything. An administrator diagnosing this needs sending to the
      // scope, and the 2026-08-23 ruling says so — an earlier version of this rule
      // dropped the grant before the capability check and answered the other code,
      // which the sex-correction suite caught.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');

      const accounts = await db
        .selectFrom('accounts')
        .select('id')
        .where('person_id', '=', target.id)
        .execute();

      expect(accounts).toHaveLength(0);
    });

    it('provisions a SENIOR_PASTOR into a free seat', async () => {
      // **Unreachable before review.** The insert omitted `senior_pastor_slot`,
      // which the check constraint requires for this role — a 23505/23514 the
      // filter does not recognise, so a 500. No test named the role, and section 6
      // as amended says such an account is created like any other.
      const response = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'SENIOR_PASTOR',
      });

      expect(response.status).toBe(201);

      const roles = await db
        .selectFrom('account_roles')
        .select(['role', 'senior_pastor_slot'])
        .where('account_id', '=', response.body.id)
        .execute();

      expect(roles).toEqual([{ role: 'SENIOR_PASTOR', senior_pastor_slot: 1 }]);
    });

    it('refuses a third Senior Pastor, which is the cap section 7 states', async () => {
      const second = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
      const third = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      expect(
        (await provision({ person_id: ester.id, email: 'a@example.test', role: 'SENIOR_PASTOR' }))
          .status,
      ).toBe(201);
      expect(
        (await provision({ person_id: second.id, email: 'b@example.test', role: 'SENIOR_PASTOR' }))
          .status,
      ).toBe(201);

      const overflow = await provision({
        person_id: third.id,
        email: 'c@example.test',
        role: 'SENIOR_PASTOR',
      });

      // An answer rather than a raw constraint violation rendered 500.
      expect(overflow.status).toBe(409);
      expect(overflow.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses an archived Person', async () => {
      // Settled 2026-08-24: an archived Person does not acquire new live
      // relationships, and an account is one. The merged check was carried across
      // from `leader-assignability.ts` and this one was not.
      await db
        .updateTable('person_lifecycle')
        .set({ state: 'ARCHIVED' })
        .where('person_id', '=', ester.id)
        .where('ended_at', 'is', null)
        .execute();

      const response = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'ADMIN',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses a duplicate email with an answer, not a 500', async () => {
      // `accounts.email_normalized` is UNIQUE, and an unrecognised 23505 renders
      // as INTERNAL_ERROR — the 500-instead-of-an-answer failure recorded on
      // 2026-08-23. Normalization is part of it: the same address in another case
      // is the same account.
      const other = await createPerson(db, { firstName: 'Rico', network: 'MENS' });

      await provision({ person_id: ester.id, email: 'shared@example.test', role: 'ADMIN' });

      const clash = await provision({
        person_id: other.id,
        email: 'SHARED@Example.test',
        role: 'ADMIN',
      });

      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('still answers 201 when the activation email cannot be delivered', async () => {
      // **The write-endpoint contract, and the case the harness could always have
      // run.** The completion is recorded inside the transaction, so by the time
      // the send happens the store holds a COMPLETED 201. Raising there gave the
      // client a 500 while every retry on that key replayed the 201, and `release`
      // could not help because its predicate is IN_FLIGHT.
      //
      // The account genuinely exists, so 201 is the honest answer and the operator
      // re-sends.
      outbox(app).failNext = true;

      const response = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'ADMIN',
      });

      expect(response.status).toBe(201);

      const accounts = await db
        .selectFrom('accounts')
        .select('status')
        .where('person_id', '=', ester.id)
        .execute();

      expect(accounts).toEqual([{ status: 'PENDING_ACTIVATION' }]);
    });

    it('re-sends an activation email, superseding the token that did not arrive', async () => {
      const created = await provision({
        person_id: ester.id,
        email: 'ester@example.test',
        role: 'ADMIN',
      });
      const first = outbox(app).last('ACTIVATION')?.token;

      const resend = await request(app.getHttpServer())
        .post(`/api/v1/accounts/${created.body.id}/activation-email`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({});

      expect(resend.status).toBe(204);

      const second = outbox(app).last('ACTIVATION')?.token;
      expect(second).not.toBe(first);

      // Section 6: issuing a new token of a purpose invalidates the outstanding
      // one. The stale link stops working, which is the right way round — the
      // reason to re-send is that the first did not reach anybody.
      const stale = await request(app.getHttpServer())
        .post('/api/v1/auth/activate')
        .send({ token: first, password: PASSWORD });
      expect(stale.status).toBe(422);

      const current = await request(app.getHttpServer())
        .post('/api/v1/auth/activate')
        .send({ token: second, password: PASSWORD });
      expect(current.status).toBe(204);
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
      // Sequential replay. **This does not pin the concurrent property**, and an
      // earlier version of this comment claimed it did: a read-then-write
      // redemption passes here, because by the second request `used_at` is already
      // set. The concurrent case is the one below, on the reasoning CLAUDE.md
      // records for authorization case 7 — a sequential test passes against an
      // application-layer check alone.
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

    it('is single-use under concurrent redemption, not only sequentially', async () => {
      // **The property the sequential case cannot see.** A read-then-write
      // redemption lets two requests presenting one token both pass the read, and
      // CLAUDE.md records exactly this for authorization case 7: a sequential test
      // passes against an application-layer check alone.
      //
      // Both requests are dispatched before either is awaited — a supertest object
      // is lazy, and this repository has already shipped a probe that found no
      // waiter because it was never sent.
      const token = await provisionEster();

      const [first, second] = await Promise.all([
        activate({ token, password: PASSWORD }),
        activate({ token, password: 'a different passphrase' }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([204, 422]);

      // And exactly one of the two passwords works, so the loser set nothing.
      const winner = first.status === 204 ? PASSWORD : 'a different passphrase';
      const loser = first.status === 204 ? 'a different passphrase' : PASSWORD;

      expect(
        (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: 'ester@example.test', password: loser })
        ).status,
      ).toBe(401);

      expect(
        (
          await request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email: 'ester@example.test', password: winner })
        ).status,
      ).toBe(200);
    });

    it('does not reactivate a DISABLED account', async () => {
      // Section 6 makes reactivation "a separate, explicit, authorized decision",
      // and an activation token outlives a disablement by up to a week. Without
      // this an unauthenticated endpoint undoes an `accounts.manage` decision.
      const token = await provisionEster();

      await db
        .updateTable('accounts')
        .set({ status: 'DISABLED' })
        .where('email_normalized', '=', 'ester@example.test')
        .execute();

      const response = await activate({ token, password: PASSWORD });
      expect(response.status).toBe(422);

      const accounts = await db
        .selectFrom('accounts')
        .select(['status', 'password_hash'])
        .where('email_normalized', '=', 'ester@example.test')
        .execute();

      expect(accounts[0].status).toBe('DISABLED');
      expect(accounts[0].password_hash).toBeNull();
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

    it('is rate limited, because it mails somebody on an unauthenticated request', async () => {
      // **Found by accident and pinned deliberately.** An earlier version of this
      // file called `forgot-password` six times across its cases and the sixth
      // returned 429, failing an assertion about email delivery. The limit was
      // right and the isolation was wrong — but nothing had asserted the limit
      // existed, so removing `@Throttle` from that route would have gone unnoticed.
      //
      // Section 24 requires rate limiting on authentication and sensitive
      // endpoints, and this one is sensitive in two ways at once: it is
      // unauthenticated, and it causes mail to be sent to an address the caller
      // chose. Unlimited, it is a mail-bombing primitive as well as an enumeration
      // one.
      await activeEster();

      const answers: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        answers.push((await forgot('ester@example.test')).status);
      }

      expect(answers.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
      expect(answers.slice(5)).toEqual([429, 429]);
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
