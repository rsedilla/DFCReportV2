import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { codeForStep, stepAt } from '../../src/auth/second-step.crypto';
import { SecondStepService } from '../../src/auth/second-step.service';
import { PasswordService } from '../../src/auth/password.service';
import { EMAIL_PORT } from '../../src/email/email.port';
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
import type { Database } from '../../src/database/schema';
import type { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';

const codeNow = (secret = TEST_SECOND_STEP_SECRET): string =>
  codeForStep(secret, stepAt(new Date()));

const wrongCode = (secret = TEST_SECOND_STEP_SECRET): string =>
  codeNow(secret) === '000000' ? '111111' : '000000';

/**
 * Ten wrong codes for one account within fifteen minutes pause its second step for fifteen
 * minutes, counted across sign-ins (SKILL.md section 6, decision 0441).
 */
describe('second-step pause after ten wrong codes (decision 0441)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let email: CapturingEmailAdapter;
  let passwordHash: string;
  let admin: TestAccount;
  let pastor: TestAccount;

  const http = () => request(app.getHttpServer());

  // The per-address limit (section 24) allows ten requests a minute; this file is about the
  // per-account count behind it, so every request starts with the limit cleared.
  const login = async (account: TestAccount): Promise<string> => {
    resetRateLimits(app);
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: PASSWORD });
    expect(response.status).toBe(200);
    return response.body.challenge as string;
  };

  const answer = (challenge: string, body: Record<string, string>) => {
    resetRateLimits(app);
    return http()
      .post('/api/v1/auth/second-step')
      .send({ challenge, ...body });
  };

  /** `times` wrong codes, starting a new sign-in after every five, as the screen does. */
  async function wrongCodes(account: TestAccount, times: number, secret?: string) {
    let challenge = await login(account);
    let used = 0;
    let last: request.Response | undefined;
    for (let n = 0; n < times; n += 1) {
      if (used === 5) {
        challenge = await login(account);
        used = 0;
      }
      last = await answer(challenge, { code: wrongCode(secret) });
      used += 1;
    }
    return last!;
  }

  const pauseRow = () =>
    db
      .selectFrom('second_step_pauses')
      .selectAll()
      .where('account_id', '=', admin.id)
      .executeTakeFirst();

  const endPause = () =>
    db
      .updateTable('second_step_pauses')
      .set({ paused_until: sql<Date>`now() - interval '1 second'` })
      .execute();

  const pausesRecorded = () =>
    db.selectFrom('audit_log').selectAll().where('action', '=', 'second_step.paused').execute();

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  async function setUpPastor() {
    const challenge = await login(pastor);
    resetRateLimits(app);
    const setup = await http().post('/api/v1/auth/second-step/setup').send({ challenge });
    const secret = setup.body.key as string;
    resetRateLimits(app);
    const confirmed = await http()
      .post('/api/v1/auth/second-step/setup/confirm')
      .send({ challenge, code: codeNow(secret) });
    expect(confirmed.status).toBe(200);
    return { secret, recoveryCodes: confirmed.body.recovery_codes as string[] };
  }

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    email = app.get<CapturingEmailAdapter>(EMAIL_PORT);
    passwordHash = await app.get(PasswordService).hash(PASSWORD);
  });

  beforeEach(async () => {
    await truncateAll(db);
    email.reset();

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    nameSeniorPastors(app, [grace.id]);

    admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'], passwordHash });
    pastor = await createAccount(app, db, {
      person: grace,
      roles: ['SENIOR_PASTOR'],
      passwordHash,
      secondStep: false,
    });
  });

  // The pause records and emails after answering; let that finish before the next case
  // truncates the tables under it.
  afterEach(settle);

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('pauses on the tenth wrong code, counted across two sign-ins', async () => {
    const ninth = await wrongCodes(admin, 9);
    expect(ninth.status).toBe(401);

    const challenge = await login(admin);
    const tenth = await answer(challenge, { code: wrongCode() });

    expect(tenth.status).toBe(429);
    expect(tenth.body.error.code).toBe('RATE_LIMITED');
    expect(tenth.body.error.details).toEqual({
      reason: 'SECOND_STEP_PAUSED',
      paused_until: expect.any(String),
    });
    expect(tenth.body.error.message).toMatch(
      /^Sign-in to this account is paused for 15 minutes after 10 wrong codes\. Try again after \d{1,2}:\d{2} [AP]M\.$/,
    );

    const opensIn = new Date(tenth.body.error.details.paused_until).getTime() - Date.now();
    expect(opensIn).toBeGreaterThan(14 * 60_000);
    expect(opensIn).toBeLessThanOrEqual(15 * 60_000);

    // That sign-in is closed: even the right code on it is refused.
    const after = await answer(challenge, { code: codeNow() });
    expect(after.status).toBe(401);
    expect(after.body.error.details).toEqual({ reason: 'SIGN_IN_AGAIN' });
  });

  it('checks no code while paused, the right one included, and counts nothing', async () => {
    await wrongCodes(admin, 10);
    const paused = await pauseRow();

    const right = await answer(await login(admin), { code: codeNow() });
    expect(right.status).toBe(429);
    expect(right.body.error.details.reason).toBe('SECOND_STEP_PAUSED');

    const wrong = await answer(await login(admin), { code: wrongCode() });
    expect(wrong.status).toBe(429);

    const still = await pauseRow();
    expect(still?.failed_at).toEqual([]);
    expect(still?.paused_until).toEqual(paused?.paused_until);

    await endPause();
    const opened = await answer(await login(admin), { code: codeNow() });
    expect(opened.status).toBe(200);
    expect(typeof opened.body.access_token).toBe('string');
  });

  it('starts the count again after a right code', async () => {
    await wrongCodes(admin, 9);
    const right = await answer(await login(admin), { code: codeNow() });
    expect(right.status).toBe(200);
    expect(await pauseRow()).toBeUndefined();

    const ninth = await wrongCodes(admin, 9);
    expect(ninth.status).toBe(401);
  });

  it('counts wrong recovery codes, and not a code typed while setting the step up', async () => {
    // Setting up: a wrong confirmation code is not counted.
    const challenge = await login(pastor);
    resetRateLimits(app);
    const setup = await http().post('/api/v1/auth/second-step/setup').send({ challenge });
    resetRateLimits(app);
    const wrongSetup = await http()
      .post('/api/v1/auth/second-step/setup/confirm')
      .send({ challenge, code: wrongCode(setup.body.key as string) });
    expect(wrongSetup.status).toBe(401);
    expect(
      await db
        .selectFrom('second_step_pauses')
        .select('account_id')
        .where('account_id', '=', pastor.id)
        .execute(),
    ).toEqual([]);

    resetRateLimits(app);
    const confirmed = await http()
      .post('/api/v1/auth/second-step/setup/confirm')
      .send({ challenge, code: codeNow(setup.body.key as string) });
    expect(confirmed.status).toBe(200);

    let last: request.Response | undefined;
    for (let sign = 0; sign < 2; sign += 1) {
      const next = await login(pastor);
      for (let n = 0; n < 5; n += 1) {
        last = await answer(next, { recovery_code: 'zzzz-zzzz' });
      }
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error.details.reason).toBe('SECOND_STEP_PAUSED');
  });

  it('records the pause and emails each Admin, once a day for one account', async () => {
    await wrongCodes(admin, 10);
    await settle();

    const alerts = email.sent.filter((message) => message.kind === 'SECOND_STEP_PAUSED');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ to: { email: admin.email }, pausedUntil: expect.any(Date) });

    await endPause();
    await wrongCodes(admin, 10);
    await settle();

    expect(email.sent.filter((message) => message.kind === 'SECOND_STEP_PAUSED')).toHaveLength(1);
    const recorded = await pausesRecorded();
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ actor_id: null, target_id: admin.id });
    expect(
      recorded.map((entry) => (entry.after as { admin_emailed: boolean }).admin_emailed).sort(),
    ).toEqual([false, true]);
  });

  it("emails apart from the account's password-pause email, and within the twenty a day", async () => {
    // A password-pause email already went today for this account: a code pause still emails.
    await db.insertInto('sign_in_pause_alerts').values({ account_id: admin.id }).execute();
    await wrongCodes(admin, 10);
    await settle();
    expect(email.sent.filter((message) => message.kind === 'SECOND_STEP_PAUSED')).toHaveLength(1);

    // Twenty alerts of either kind today: no more email, and the pause is still recorded.
    await truncateAll(db);
    email.reset();
    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'], passwordHash });
    const other = await createPerson(db, { firstName: 'Alma', network: 'WOMENS' });
    const otherAccount = await createAccount(app, db, {
      person: other,
      roles: ['LEADER'],
      passwordHash,
    });
    await db
      .insertInto('sign_in_pause_alerts')
      .values(Array.from({ length: 20 }, () => ({ account_id: otherAccount.id })))
      .execute();

    await wrongCodes(admin, 10);
    await settle();
    expect(email.sent.filter((message) => message.kind === 'SECOND_STEP_PAUSED')).toHaveLength(0);
    expect(await pausesRecorded()).toMatchObject([{ after: { admin_emailed: false } }]);
  });

  it("ends the pause when an administrator resets a Senior Pastor's step", async () => {
    const { secret } = await setUpPastor();
    await wrongCodes(pastor, 10, secret);
    expect(
      await db
        .selectFrom('second_step_pauses')
        .select('paused_until')
        .where('account_id', '=', pastor.id)
        .executeTakeFirst(),
    ).toMatchObject({ paused_until: expect.any(Date) });

    resetRateLimits(app);
    const reset = await http()
      .post(`/api/v1/accounts/${pastor.id}/second-step/reset`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(reset.status).toBe(204);

    expect(
      await db
        .selectFrom('second_step_pauses')
        .select('account_id')
        .where('account_id', '=', pastor.id)
        .execute(),
    ).toEqual([]);
  });

  it('starts exactly one pause when twenty wrong codes arrive at once', async () => {
    // At the service, because the per-address limit lets only ten requests a minute through
    // from one address, and this is about codes from many.
    const challenges: string[] = [];
    for (let n = 0; n < 4; n += 1) {
      challenges.push(await login(admin));
    }

    const steps = app.get(SecondStepService);
    const outcomes = await Promise.allSettled(
      challenges.flatMap((challenge) =>
        Array.from({ length: 5 }, () => steps.verify(challenge, { code: wrongCode() }, null)),
      ),
    );
    await settle();

    const paused = outcomes.filter(
      (outcome) =>
        outcome.status === 'rejected' &&
        (outcome.reason as { details?: { reason?: string } }).details?.reason ===
          'SECOND_STEP_PAUSED',
    );
    expect(paused.length).toBeGreaterThanOrEqual(1);
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(await pausesRecorded()).toHaveLength(1);
    expect((await pauseRow())?.failed_at).toEqual([]);
  });
});
