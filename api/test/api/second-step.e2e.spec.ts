import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { codeForStep, stepAt } from '../../src/auth/second-step.crypto';
import { SecondStepService } from '../../src/auth/second-step.service';
import { PasswordService } from '../../src/auth/password.service';
import { TokensService } from '../../src/auth/tokens.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  TEST_SECOND_STEP_SECRET,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
  resetRateLimits,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AuditAction, Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';

/** The code the fixture's authenticator shows now, or `offset` steps from now. */
const codeNow = (offset = 0): string =>
  codeForStep(TEST_SECOND_STEP_SECRET, stepAt(new Date()) + offset);

/**
 * The second sign-in step (SKILL.md section 6, decision 0302): an authenticator-app code
 * for `ADMIN` and `SENIOR_PASTOR` accounts, asked at password sign-in and nowhere else.
 */
describe('the second sign-in step (SKILL.md section 6, decision 0302)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let passwordHash: string;
  let admin: TestAccount;
  let pastor: TestAccount;
  let leader: TestAccount;

  const http = () => request(app.getHttpServer());

  const login = (account: TestAccount) =>
    http().post('/api/v1/auth/login').send({ email: account.email, password: PASSWORD });

  const answer = (challenge: string, body: Record<string, string>) =>
    http()
      .post('/api/v1/auth/second-step')
      .send({ challenge, ...body });

  const me = (accessToken: string) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);

  const auditOf = (action: AuditAction) =>
    db.selectFrom('audit_log').selectAll().where('action', '=', action).execute();

  /** Signs in an account that has no step yet, through setup, and returns what it got. */
  async function setUp(account: TestAccount) {
    const started = await login(account);
    expect(started.body.second_step).toBe('SETUP');

    const setup = await http()
      .post('/api/v1/auth/second-step/setup')
      .send({ challenge: started.body.challenge });
    expect(setup.status).toBe(200);

    const secret = setup.body.key as string;
    const confirmed = await http()
      .post('/api/v1/auth/second-step/setup/confirm')
      .send({
        challenge: started.body.challenge,
        code: codeForStep(secret, stepAt(new Date())),
      });
    expect(confirmed.status).toBe(200);

    return { secret, body: confirmed.body as { access_token: string; recovery_codes: string[] } };
  }

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    passwordHash = await app.get(PasswordService).hash(PASSWORD);
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    nameSeniorPastors(app, [grace.id]);

    admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'], passwordHash });
    pastor = await createAccount(app, db, {
      person: grace,
      roles: ['SENIOR_PASTOR'],
      passwordHash,
      secondStep: false,
    });
    leader = await createAccount(app, db, { person: manuel, roles: ['LEADER'], passwordHash });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('leaves a leader signing in with a password alone', async () => {
    const response = await login(leader);

    expect(response.status).toBe(200);
    expect(typeof response.body.access_token).toBe('string');
    expect(response.body.second_step).toBeUndefined();
  });

  it('answers an administrator with a ticket for the code, never with a session', async () => {
    const response = await login(admin);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      second_step: 'CODE',
      challenge: expect.any(String),
      expires_in: 300,
    });
    expect(response.body.access_token).toBeUndefined();

    const signedIn = await answer(response.body.challenge, { code: codeNow() });
    expect(signedIn.status).toBe(200);
    expect((await me(signedIn.body.access_token)).status).toBe(200);
  });

  it('walks an account with no step through setup, and issues ten recovery codes once', async () => {
    const { body } = await setUp(pastor);

    expect(body.recovery_codes).toHaveLength(10);
    expect((await me(body.access_token)).status).toBe(200);

    const [entry] = await auditOf('second_step.set_up');
    expect(entry).toMatchObject({
      actor_id: pastor.id,
      target_type: 'account',
      target_id: pastor.id,
    });

    // Stored encrypted: the row holds neither the secret nor anything shaped like it.
    const step = await db.selectFrom('second_steps').selectAll().executeTakeFirstOrThrow();
    expect(step.secret_ciphertext.startsWith('v1.')).toBe(true);

    // The next sign-in asks for a code rather than setting up again.
    expect((await login(pastor)).body.second_step).toBe('CODE');
  });

  it('returns the same secret if setup is asked for twice in one sign-in', async () => {
    const started = await login(pastor);
    const first = await http()
      .post('/api/v1/auth/second-step/setup')
      .send({ challenge: started.body.challenge });
    const second = await http()
      .post('/api/v1/auth/second-step/setup')
      .send({ challenge: started.body.challenge });

    expect(second.body.key).toBe(first.body.key);
  });

  it('refuses a code already used', async () => {
    const code = codeNow();
    const first = await answer((await login(admin)).body.challenge, { code });
    expect(first.status).toBe(200);

    const replay = await answer((await login(admin)).body.challenge, { code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.details).toMatchObject({ reason: 'CODE_INCORRECT' });

    // The next code the app shows is accepted.
    expect((await answer((await login(admin)).body.challenge, { code: codeNow(1) })).status).toBe(
      200,
    );
  });

  it('allows five wrong codes, then the sign-in must start again', async () => {
    const { challenge } = (await login(admin)).body;
    const wrong = codeNow() === '000000' ? '111111' : '000000';

    for (let left = 4; left >= 1; left -= 1) {
      const response = await answer(challenge, { code: wrong });
      expect(response.status).toBe(401);
      expect(response.body.error.details).toEqual({
        reason: 'CODE_INCORRECT',
        attempts_left: left,
      });
    }

    const fifth = await answer(challenge, { code: wrong });
    expect(fifth.body.error.details).toEqual({ reason: 'SIGN_IN_AGAIN' });

    // Even the right code is refused on a voided ticket.
    const right = await answer(challenge, { code: codeNow() });
    expect(right.status).toBe(401);
    expect(right.body.error.details).toEqual({ reason: 'SIGN_IN_AGAIN' });
  });

  it('accepts each recovery code once, and records its use', async () => {
    const { body } = await setUp(pastor);
    const [recovery] = body.recovery_codes;

    const used = await answer((await login(pastor)).body.challenge, {
      recovery_code: recovery.toUpperCase(),
    });
    expect(used.status).toBe(200);

    const again = await answer((await login(pastor)).body.challenge, { recovery_code: recovery });
    expect(again.status).toBe(401);

    const [entry] = await auditOf('second_step.recovery_code_used');
    expect(entry.after).toEqual({ recovery_codes_left: 9 });
  });

  it('never asks at refresh', async () => {
    const signedIn = await answer((await login(admin)).body.challenge, { code: codeNow() });

    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: signedIn.body.refresh_token });

    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.access_token).toBe('string');
  });

  it('refuses a session from before the step, both its access and its refresh token', async () => {
    // What the ruling ended when it took effect: a Senior Pastor signed in by password.
    const tokens = app.get(TokensService);
    const refresh = await tokens.issueRefreshToken(pastor.id, null);

    expect((await me(pastor.accessToken)).status).toBe(401);
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh.token });
    expect(refreshed.status).toBe(401);

    // Setting the step up does not revive it.
    await setUp(pastor);
    expect((await me(pastor.accessToken)).status).toBe(401);
  });

  describe('reset', () => {
    const reset = (accountId: string) =>
      http()
        .post(`/api/v1/accounts/${accountId}/second-step/reset`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({});

    it("lets an administrator reset a Senior Pastor's step, ending their sessions", async () => {
      const { body } = await setUp(pastor);

      const response = await reset(pastor.id);
      expect(response.status).toBe(204);

      expect((await me(body.access_token)).status).toBe(401);
      expect((await login(pastor)).body.second_step).toBe('SETUP');

      const [entry] = await auditOf('second_step.reset');
      expect(entry).toMatchObject({ actor_id: admin.id, target_id: pastor.id });
    });

    it("refuses an administrator's step, which is reset on the server", async () => {
      const response = await reset(admin.id);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await auditOf('second_step.reset')).toHaveLength(0);
    });

    it('refuses a leader, and a Senior Pastor with nothing set up', async () => {
      expect((await reset(leader.id)).status).toBe(409);
      expect((await reset(pastor.id)).status).toBe(409);
    });

    it("resets an administrator's step from the server command, as a system action", async () => {
      await app.get(SecondStepService).resetByCommand(admin.email);

      expect((await me(admin.accessToken)).status).toBe(401);
      expect((await login(admin)).body.second_step).toBe('SETUP');

      const [entry] = await auditOf('second_step.reset');
      expect(entry).toMatchObject({ actor_id: null, target_id: admin.id });

      await expect(app.get(SecondStepService).resetByCommand(pastor.email)).rejects.toThrow(
        /administrator's second step/,
      );
    });
  });

  it('shows the person page whether an account signs in with the step', async () => {
    const forPerson = async (personId: string) =>
      (
        await http()
          .get(`/api/v1/accounts/for-person/${personId}`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
      ).body.account.second_step;

    expect(await forPerson(pastor.personId)).toEqual({ required: true, set_up_at: null });
    expect(await forPerson(leader.personId)).toEqual({ required: false, set_up_at: null });
    expect((await forPerson(admin.personId)).set_up_at).toEqual(expect.any(String));
  });
});
