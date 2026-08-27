import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { REFRESH_RETRY_GRACE_SECONDS } from '../../src/auth/auth.service';
import { PasswordService } from '../../src/auth/password.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { IssuedRefreshToken } from '../../src/auth/tokens.service';
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

    it('reports no read_only value for authority carried by a role', () => {
      // SKILL.md section 7 defines read_only as a column on capability_grants and
      // says nothing about role defaults. Publishing a derived value here would
      // put a rule the specification does not contain into every session, for
      // clients to branch on.
      const fromRole = (capabilities: { source: string; read_only: boolean | null }[]) =>
        capabilities.filter((capability) => capability.source === 'role');

      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200)
        .expect((response) => {
          const roleGrants = fromRole(response.body.capabilities);
          expect(roleGrants.length).toBeGreaterThan(0);
          for (const grant of roleGrants) {
            expect(grant.read_only).toBeNull();
          }
        });
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

    /**
     * **This case now establishes a fork, and that is the whole change.**
     *
     * It used to present the first token again with its replacement never
     * touched — which is, exactly and unavoidably, what a client looks like when
     * its refresh request succeeded and the *response* was lost. `fetch` reports
     * those two situations identically, so revoking on that shape signed a leader
     * out of every device for a dropped connection.
     *
     * Theft leaves a trace a lost response cannot: the real client goes on using
     * the replacement, so two chains advance from one token. That is what this
     * builds by rotating the replacement onward before replaying the original,
     * and it is what section 6 keys the reuse signal on.
     */
    it('treats a replayed token as a copy in circulation and revokes the account', async () => {
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      // The fork: the legitimate client carries on, so the replacement is used.
      // Without this the presentation below is a retry, not a replay.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: first.body.refresh_token });

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

    /**
     * The case the rule above exists to spare: a retry after a lost response.
     *
     * The client presented its token, the server rotated it, and the answer never
     * arrived — so the client still holds the old token and nobody has ever used
     * the replacement. It presents the old one again. Nothing forked, so this is
     * not the reuse signal, and the session survives.
     */
    it('serves a re-presentation whose replacement was never used, and keeps the session', async () => {
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(rotated.status).toBe(200);

      const retry = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(retry.status).toBe(200);
      expect(retry.body.refresh_token).not.toBe(issued.token);
      expect(retry.body.refresh_token).not.toBe(rotated.body.refresh_token);

      // The account was not revoked, and the caller holds a usable token again.
      const usable = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: retry.body.refresh_token });

      expect(usable.status).toBe(200);
    });

    /**
     * The bound. Outside the window the same shape is read as reuse again,
     * because a retry follows its failed request by seconds — and without a bound
     * a token stolen long afterwards, whose owner never came back, would find an
     * unused replacement waiting for it.
     */
    it('treats the same shape as reuse once the retry window has passed', async () => {
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      // Age the rotation past the window rather than waiting for it.
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(Date.now() - (REFRESH_RETRY_GRACE_SECONDS + 60) * 1000) })
        .where('id', '=', issued.id)
        .execute();

      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(replay.status).toBe(401);

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
        .set('Idempotency-Key', randomUUID())
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

  describe('rotation under concurrency', () => {
    it('lets exactly one of two simultaneous presentations win, and spares the winner', async () => {
      // Issuing the replacement before claiming the presented token let both
      // callers mint one and only one revoke land: two live chains from one
      // presentation, with the reuse signal never raised for the loser.
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: issued.token }),
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: issued.token }),
      ]);

      // Promise.all does not force both handlers to read the row before either
      // rotation commits. If they happen to serialize, the loser takes the
      // sequential-replay branch instead and this fails -- so a red run here can
      // mean an unlucky interleaving rather than a defect. It cannot pass while
      // the rule is broken, which is what makes it worth keeping.
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 401]);

      // Section 6 defines reuse as a presentation *after* use. Two requests
      // arriving together is what a mobile client does when both hit 401, so the
      // loser is refused and the winner keeps working: exactly one live token.
      const live = await db
        .selectFrom('refresh_tokens')
        .select('id')
        .where('account_id', '=', account.id)
        .where('revoked_at', 'is', null)
        .execute();
      expect(live).toHaveLength(1);

      const marker = await db
        .selectFrom('accounts')
        .select('sessions_revoked_at')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();
      expect(marker.sessions_revoked_at).toBeNull();

      // And the token the winner was given still works.
      const winner = first.status === 200 ? first : second;
      const again = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: winner.body.refresh_token });
      expect(again.status).toBe(200);
    });

    it('does not let signing out erase a reuse signal already recorded', async () => {
      // Rotation sets replaced_by_id; a later sign-out with the same token must
      // not clear it, or a stolen token could be laundered into an ordinary
      // sign-out and the account would never be revoked.
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ refresh_token: issued.token });

      const row = await db
        .selectFrom('refresh_tokens')
        .select('replaced_by_id')
        .where('id', '=', issued.id)
        .executeTakeFirstOrThrow();

      expect(row.replaced_by_id).not.toBeNull();
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
        .set('Idempotency-Key', randomUUID())
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

    it('kills a token that predates the revocation even if the row was missed', async () => {
      // Revoking by row alone is not enough. A sign-in committing alongside
      // revokeAllSessions inserts its row after that statement took its snapshot
      // -- issueRefreshToken takes no account lock, so the revocation does not
      // exclude it -- and the row would otherwise stay live for thirty days. The
      // marker is what closes it, exactly as it does for access tokens.
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(204);

      // Put the row back exactly as the race would leave it: live, but issued
      // before the account was revoked.
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: null })
        .where('id', '=', issued.id)
        .execute();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: issued.token });

      expect(response.status).toBe(401);
    });

    it('refuses a token escaping a revocation that has stamped but not committed', async () => {
      // The window the marker check alone could not close. `findById` reads
      // committed state, so a revocation mid-transaction reads as absent, and a
      // token that escaped its UPDATE could be rotated into a replacement issued
      // after the marker -- accepted by every later check.
      //
      // Reconstructed deterministically: a second connection stamps the marker
      // and holds the transaction open. The rotation must block on the account
      // row and then refuse, rather than reading past it.
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');
      const revoker = new Client({ connectionString: process.env.DATABASE_URL });
      await revoker.connect();

      try {
        await revoker.query('BEGIN');
        // Stamped from this process, not with now(): the whole rule is that both
        // sides of the comparison come from the application's clock, and a test
        // using the database's would contradict what it is protecting.
        await revoker.query('UPDATE accounts SET sessions_revoked_at = $2 WHERE id = $1', [
          account.id,
          new Date(),
        ]);

        let settled = false;
        const refresh = request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: issued.token })
          .then((response) => {
            settled = true;
            return response;
          });

        await new Promise((resolve) => setTimeout(resolve, 250));

        // The point of the test. Without the lock the rotation reads past the
        // uncommitted marker and answers immediately -- and it would answer 401
        // anyway once the marker commits, for an entirely different reason, so a
        // test that only checked the status could pass with the lock removed.
        expect(settled).toBe(false);

        await revoker.query('COMMIT');

        const response = await refresh;
        expect(response.status).toBe(401);
      } finally {
        await revoker.end();
      }

      // Nothing was minted in the window.
      const live = await db
        .selectFrom('refresh_tokens')
        .select('id')
        .where('account_id', '=', account.id)
        .where('revoked_at', 'is', null)
        .execute();
      expect(live.map((row) => row.id)).toEqual([issued.id]);
    });

    it('takes the account row before the tokens, in the order rotation takes them', async () => {
      // What the previous fix got wrong, and the reason for this one. Rotation
      // takes the account row and then claims its token. When revocation took the
      // tokens first and stamped the marker second, the two paths held one pair
      // of locks in opposite orders -- a cycle, which PostgreSQL breaks by
      // aborting the side that began waiting first, normally the revocation. So
      // `logout-all` answered 500 and every session stayed live, at exactly the
      // moment somebody was trying to end them.
      //
      // Holding the account row and firing logout-all would not distinguish the
      // two orders: the old order ended on `UPDATE accounts` and blocked there
      // too. What distinguishes them is which row logout-all holds *while* it is
      // blocked on the other. So hold a refresh_tokens row, fire logout-all, and
      // probe the account row from a third connection.
      const issued = await tokens.issueRefreshToken(account.id, 'Test phone');

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      const probe = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await probe.connect();

      let settled = false;
      let logout: Promise<request.Response> | undefined;

      try {
        await holder.query('BEGIN');
        // FOR NO KEY UPDATE conflicts with itself, and the revocation's UPDATE of
        // a non-key column takes the same mode, so this is what it blocks on.
        await holder.query('SELECT id FROM refresh_tokens WHERE id = $1 FOR NO KEY UPDATE', [
          issued.id,
        ]);

        logout = request(app.getHttpServer())
          .post('/api/v1/auth/logout-all')
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${account.accessToken}`)
          .then((response) => {
            settled = true;
            return response;
          });

        await new Promise((resolve) => setTimeout(resolve, 250));

        // Blocked on the token this test holds, which is where it should be.
        expect(settled).toBe(false);

        // And holding the account row while it waits. NOWAIT raises 55P03 rather
        // than queueing, so this reads the lock as held now rather than waiting
        // out a timeout that would elapse under either order. Under the inverted
        // order logout-all is blocked on refresh_tokens without having touched
        // accounts at all, and this probe takes the row instead of failing.
        await expect(
          probe.query('SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE NOWAIT', [
            account.id,
          ]),
        ).rejects.toMatchObject({ code: '55P03' });
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
        await probe.end();
        // Let the revocation finish before the test ends. An assertion failing
        // above would otherwise leave it running into the next test's truncate,
        // which takes ACCESS EXCLUSIVE and turns one red test into two.
        await logout?.catch(() => undefined);
      }

      // Freed, it completes rather than aborting: one order, so no cycle to break.
      expect(settled).toBe(true);
      expect((await logout)?.status).toBe(204);

      const live = await db
        .selectFrom('refresh_tokens')
        .select('id')
        .where('account_id', '=', account.id)
        .where('revoked_at', 'is', null)
        .execute();
      expect(live).toEqual([]);
    });

    it('stamps the marker after revoking, so a row that escaped is still refused', async () => {
      // Section 6 states marker-last as a rule, and this is what it buys.
      // `issueRefreshToken` takes no lock on the account -- the foreign key's
      // FOR KEY SHARE does not conflict with the FOR NO KEY UPDATE the revocation
      // holds -- so a sign-in can insert a row while the revoking statement is
      // blocked. That row is invisible to the statement's snapshot and is never
      // revoked, so the marker read afterwards is the only thing between it and
      // thirty days of use.
      //
      // Read the marker before the revoking statement instead and it dates from
      // earlier than the escapee's issued_at, and the escapee lives.
      const held = await tokens.issueRefreshToken(account.id, 'Test phone');

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      let settled = false;
      let logout: Promise<request.Response> | undefined;
      let escapee: IssuedRefreshToken | undefined;

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM refresh_tokens WHERE id = $1 FOR NO KEY UPDATE', [
          held.id,
        ]);

        logout = request(app.getHttpServer())
          .post('/api/v1/auth/logout-all')
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${account.accessToken}`)
          .then((response) => {
            settled = true;
            return response;
          });

        await new Promise((resolve) => setTimeout(resolve, 250));
        // Necessary but not sufficient: this proves the request has not finished,
        // not that the revoking statement has taken its snapshot. On a loaded
        // runner the escapee below can be inserted before that snapshot, get
        // revoked with everything else, and red the `revoked_at` assertion at the
        // end. That is the safe direction and the assertion is the thing stopping
        // a trivial pass -- if it reds, make this wait deterministic rather than
        // weakening it.
        expect(settled).toBe(false);

        // Through the ordinary path, while the revoking statement waits. Note
        // that this is unbounded: were `revokeAllSessions` ever changed to take
        // FOR UPDATE on the account -- the alternative CLAUDE.md records and
        // rejects -- the insert's FOR KEY SHARE would block behind it, this await
        // would never reach the `finally` that releases `holder`, and the file's
        // remaining tests would block on the next truncate.
        escapee = await tokens.issueRefreshToken(account.id, 'Second phone');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
        await logout?.catch(() => undefined);
      }

      expect((await logout)?.status).toBe(204);

      if (!escapee) {
        throw new Error('the escaping token was never issued');
      }

      // It genuinely escaped, so the assertion below cannot pass for the trivial
      // reason. An UPDATE that waits on a row lock re-checks the row it waited
      // for; it does not take a new snapshot, so a row committed since stays
      // invisible to it.
      const row = await db
        .selectFrom('refresh_tokens')
        .select('revoked_at')
        .where('id', '=', escapee.id)
        .executeTakeFirstOrThrow();
      expect(row.revoked_at).toBeNull();

      // And is refused anyway, on the marker alone.
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: escapee.token });

      expect(response.status).toBe(401);
    });

    it('lets a sign-in after a revocation work normally', async () => {
      // The marker must not outlive its purpose: a token issued after the
      // revocation is a new session and is untouched by it.
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(204);

      const signIn = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: PASSWORD });
      expect(signIn.status).toBe(200);

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: signIn.body.refresh_token });
      expect(refreshed.status).toBe(200);
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
