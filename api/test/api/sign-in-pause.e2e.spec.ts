import { sql, type Kysely } from 'kysely';
import request from 'supertest';

import { PasswordService } from '../../src/auth/password.service';
import { SignInPauseService } from '../../src/auth/sign-in-pause.service';
import { EMAIL_PORT } from '../../src/email/email.port';
import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp, resetRateLimits } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Database } from '../../src/database/schema';
import type { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import type { TestAccount } from '../setup/fixtures';

const PASSWORD = 'a-password-only-this-test-uses';
const WRONG = 'not the password at all';
const USERNAME = 'jpausetest';

const PAUSED_USERNAME =
  'Sign-in for this username is paused for 15 minutes after 10 wrong passwords. To get in now, use "I have forgotten my password".';
const PAUSED_EMAIL =
  'Sign-in for this email address is paused for 15 minutes after 10 wrong passwords. To get in now, use "I have forgotten my password".';

/**
 * Ten wrong passwords for one email address or username, as typed, within fifteen minutes
 * pause sign-in for it for fifteen minutes (SKILL.md section 6, decision 0413).
 *
 * Each request clears the per-address limit first, which is a different rule (section 24)
 * at the same number: without it the eleventh request of a minute is refused by that
 * limit, and a case here would pass while proving nothing about the pause.
 */
describe('sign-in pause after ten wrong passwords (decision 0413)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let email: CapturingEmailAdapter;
  let leader: TestAccount;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    email = app.get<CapturingEmailAdapter>(EMAIL_PORT);
  });

  beforeEach(async () => {
    await truncateAll(db);
    email.reset();

    const passwordHash = await app.get(PasswordService).hash(PASSWORD);
    const person = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    leader = await createAccount(app, db, { person, roles: ['LEADER'], passwordHash });
    await db
      .updateTable('accounts')
      .set({ username: USERNAME })
      .where('id', '=', leader.id)
      .execute();

    const adminPerson = await createPerson(db, { firstName: 'Alma', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'], passwordHash });
  });

  // A pause of a held name records and emails after answering; let that finish before the
  // next case truncates the tables under it.
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  function signIn(body: Record<string, string>) {
    resetRateLimits(app);
    return request(app.getHttpServer()).post('/api/v1/auth/login').send(body);
  }

  async function wrongTimes(times: number, who: Record<string, string>) {
    const answers = [];
    for (let i = 0; i < times; i += 1) {
      answers.push(await signIn({ ...who, password: WRONG }));
    }
    return answers;
  }

  it('answers the first nine wrong passwords as before, and pauses at the tenth', async () => {
    const answers = await wrongTimes(10, { username: USERNAME });

    for (const answer of answers.slice(0, 9)) {
      expect(answer.status).toBe(401);
      expect(answer.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(answers[9].status).toBe(429);
    expect(answers[9].body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: PAUSED_USERNAME,
      details: { reason: 'SIGN_IN_PAUSED' },
    });
    // When it opens, fifteen minutes on, so a client knows not to retry within seconds.
    const opens = Date.parse(answers[9].body.error.details.paused_until);
    // The database's clock against this process's, so with a few seconds' slack either way.
    expect(opens - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(opens - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it('refuses the correct password while the pause lasts', async () => {
    await wrongTimes(10, { username: USERNAME });

    const correct = await signIn({ username: USERNAME, password: PASSWORD });

    expect(correct.status).toBe(429);
    expect(correct.body.error.message).toBe(PAUSED_USERNAME);
  });

  it('pauses a name nobody holds exactly as it pauses a held one', async () => {
    const held = await wrongTimes(10, { username: USERNAME });
    const unheld = await wrongTimes(10, { username: 'nobodyholdsthis' });

    expect(unheld.map((answer) => answer.status)).toEqual(held.map((answer) => answer.status));
    // Alike but for the instant the pause opens, which each pause has its own of.
    const withoutInstant = (body: { error: { details: Record<string, unknown> } }) => ({
      ...body.error,
      details: { ...body.error.details, paused_until: typeof body.error.details.paused_until },
    });
    expect(withoutInstant(unheld[9].body)).toEqual(withoutInstant(held[9].body));
    expect(unheld[8].body).toEqual(held[8].body);
  });

  it('names an email address when one was typed, and counts it apart from the username', async () => {
    await wrongTimes(9, { username: USERNAME });
    const answers = await wrongTimes(10, { email: leader.email });

    expect(answers[8].status).toBe(401);
    expect(answers[9].status).toBe(429);
    expect(answers[9].body.error.message).toBe(PAUSED_EMAIL);
  });

  it('counts the name as the lookup does: case and surrounding spaces do not escape it', async () => {
    await wrongTimes(5, { username: USERNAME });
    const answers = await wrongTimes(5, { username: ` ${USERNAME.toUpperCase()} ` });

    expect(answers[4].status).toBe(429);
  });

  it('starts the count again after a correct password before the tenth', async () => {
    await wrongTimes(9, { username: USERNAME });
    expect((await signIn({ username: USERNAME, password: PASSWORD })).status).toBe(200);

    const answers = await wrongTimes(9, { username: USERNAME });

    expect(answers.every((answer) => answer.status === 401)).toBe(true);
  });

  it('counts only the wrong passwords of the last fifteen minutes', async () => {
    await wrongTimes(9, { username: USERNAME });
    await db
      .updateTable('sign_in_pauses')
      .set({ failed_at: sql`ARRAY(SELECT t - interval '16 minutes' FROM unnest(failed_at) AS t)` })
      .execute();

    const answers = await wrongTimes(9, { username: USERNAME });

    expect(answers.every((answer) => answer.status === 401)).toBe(true);
  });

  it('opens again when the fifteen minutes have passed, with a fresh count', async () => {
    await wrongTimes(10, { username: USERNAME });
    await db
      .updateTable('sign_in_pauses')
      .set({ paused_until: sql`now() - interval '1 second'` })
      .execute();

    expect((await signIn({ username: USERNAME, password: PASSWORD })).status).toBe(200);
  });

  it('does not let a pause run out into a full count: the window after it starts empty', async () => {
    await wrongTimes(10, { username: USERNAME });
    await db
      .updateTable('sign_in_pauses')
      .set({ paused_until: sql`now() - interval '1 second'` })
      .execute();

    const answers = await wrongTimes(9, { username: USERNAME });

    expect(answers.every((answer) => answer.status === 401)).toBe(true);
  });

  it('ends the pause on the address and the username when a reset is completed', async () => {
    await wrongTimes(10, { username: USERNAME });
    await wrongTimes(10, { email: leader.email });

    resetRateLimits(app);
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: leader.email })
      .expect(204);
    const reset = email.last('PASSWORD_RESET');
    expect(reset).toBeDefined();

    const newPassword = 'another-password-only-this-test-uses';
    resetRateLimits(app);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: reset!.token, password: newPassword })
      .expect(200);

    expect((await signIn({ username: USERNAME, password: newPassword })).status).toBe(200);
    expect((await signIn({ email: leader.email, password: newPassword })).status).toBe(200);
  });

  it('keeps "I have forgotten my password" working during the pause', async () => {
    await wrongTimes(10, { email: leader.email });

    resetRateLimits(app);
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: leader.email })
      .expect(204);

    expect(email.last('PASSWORD_RESET')?.to.email).toBe(leader.email);
  });

  it('tells each active Admin once, naming what was typed and whose account it is', async () => {
    await wrongTimes(10, { username: USERNAME });
    await wrongTimes(3, { username: USERNAME });

    // Sent without being awaited by sign-in; give it the turn it needs.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const alerts = email.sent.filter((message) => message.kind === 'SIGN_IN_PAUSED');

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      to: { email: admin.email },
      typed: { username: USERNAME },
      holder: expect.stringContaining('Juan'),
    });
  });

  it('tells nobody when the paused name is held by no account', async () => {
    await wrongTimes(10, { username: 'nobodyholdsthis' });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(email.sent.filter((message) => message.kind === 'SIGN_IN_PAUSED')).toHaveLength(0);
  });

  async function completeReset(): Promise<{ newPassword: string; proof: string }> {
    resetRateLimits(app);
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: leader.email })
      .expect(204);
    const reset = email.last('PASSWORD_RESET');
    const newPassword = 'another-password-only-this-test-uses';
    resetRateLimits(app);
    const answer = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: reset!.token, password: newPassword })
      .expect(200);
    expect(typeof answer.body.sign_in_proof).toBe('string');
    return { newPassword, proof: answer.body.sign_in_proof as string };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  async function pausesRecorded() {
    return db
      .selectFrom('audit_log')
      .select(['actor_id', 'target_type', 'target_id', 'after'])
      .where('action', '=', 'sign_in.paused')
      .execute();
  }

  it('lets the browser that reset sign in for fifteen minutes, though the name is paused again', async () => {
    await wrongTimes(10, { username: USERNAME });
    const { newPassword, proof } = await completeReset();

    // Somebody pauses it again at once.
    const again = await wrongTimes(10, { username: USERNAME });
    expect(again[9].status).toBe(429);

    // With the proof, a wrong password is still answered as the pause; the right one signs in.
    const wrong = await signIn({ username: USERNAME, password: WRONG, reset_proof: proof });
    expect(wrong.status).toBe(429);
    expect(wrong.body.error.details.reason).toBe('SIGN_IN_PAUSED');
    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: proof })).status,
    ).toBe(200);
  });

  it('keeps every other device paused: the right password without the proof is refused', async () => {
    await wrongTimes(10, { username: USERNAME });
    const { newPassword } = await completeReset();
    await wrongTimes(10, { username: USERNAME });

    expect((await signIn({ username: USERNAME, password: newPassword })).status).toBe(429);
    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: 'not-the-proof' }))
        .status,
    ).toBe(429);
  });

  it('leaves the pause in place for every other device when that browser signs in', async () => {
    await wrongTimes(10, { username: USERNAME });
    const { newPassword, proof } = await completeReset();
    await wrongTimes(10, { username: USERNAME });

    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: proof })).status,
    ).toBe(200);

    const elsewhere = await signIn({ username: USERNAME, password: WRONG });
    expect(elsewhere.status).toBe(429);
    expect(elsewhere.body.error.details.reason).toBe('SIGN_IN_PAUSED');
  });

  it('keeps a pause in force when the allowance has run out by the time a sign-in succeeds', async () => {
    // The row a sign-in admitted under the allowance, as it stands once the fifteen minutes have
    // lapsed and a pause has begun: a correct password must not clear it.
    await db
      .insertInto('sign_in_pauses')
      .values({
        identifier: `username:${USERNAME}`,
        failed_at: [],
        paused_until: sql`now() + interval '10 minutes'`,
        exempt_until: sql`now() - interval '1 second'`,
      } as never)
      .execute();

    await app.get(SignInPauseService).succeeded(`username:${USERNAME}`);

    const elsewhere = await signIn({ username: USERNAME, password: PASSWORD });
    expect(elsewhere.status).toBe(429);
  });

  it('keeps the allowance after that browser signs in once', async () => {
    const { newPassword, proof } = await completeReset();
    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: proof })).status,
    ).toBe(200);

    await wrongTimes(10, { username: USERNAME });

    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: proof })).status,
    ).toBe(200);
  });

  it('ends that allowance after fifteen minutes', async () => {
    const { newPassword, proof } = await completeReset();
    await wrongTimes(10, { username: USERNAME });
    await db
      .updateTable('sign_in_pauses')
      .set({ exempt_until: sql`now() - interval '1 second'` })
      .execute();

    expect(
      (await signIn({ username: USERNAME, password: newPassword, reset_proof: proof })).status,
    ).toBe(429);
  });

  it("records each pause of an account's name in the audit log, as a system action", async () => {
    await wrongTimes(10, { username: USERNAME });
    await settle();

    const recorded = await pausesRecorded();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actor_id: null,
      target_type: 'account',
      target_id: leader.id,
      after: { name: `username:${USERNAME}`, admin_emailed: true },
    });
  });

  it('records nothing for a name nobody holds', async () => {
    await wrongTimes(10, { username: 'nobodyholdsthis' });
    await settle();

    expect(await pausesRecorded()).toHaveLength(0);
  });

  it('emails about one account once a day, and records every pause', async () => {
    await wrongTimes(10, { username: USERNAME });
    await settle();
    await db
      .updateTable('sign_in_pauses')
      .set({ paused_until: sql`now() - interval '1 second'` })
      .execute();
    await wrongTimes(10, { username: USERNAME });
    await settle();

    expect(email.sent.filter((message) => message.kind === 'SIGN_IN_PAUSED')).toHaveLength(1);
    const recorded = await pausesRecorded();
    expect(
      recorded.map((entry) => (entry.after as { admin_emailed: boolean }).admin_emailed).sort(),
    ).toEqual([false, true]);
  });

  it('emails no more than twenty times a day in all', async () => {
    await db
      .insertInto('sign_in_pause_alerts')
      .values(Array.from({ length: 20 }, () => ({ account_id: admin.id })))
      .execute();

    await wrongTimes(10, { username: USERNAME });
    await settle();

    expect(email.sent.filter((message) => message.kind === 'SIGN_IN_PAUSED')).toHaveLength(0);
    expect(await pausesRecorded()).toMatchObject([{ after: { admin_emailed: false } }]);
  });

  it('counts no more than ten attempts when twenty arrive at once', async () => {
    // At the service, because the per-address limit (section 24) lets only ten requests of
    // a minute reach sign-in from one address, and this is about attempts from many.
    const pauses = app.get(SignInPauseService);
    const admitted = await Promise.all(
      Array.from({ length: 20 }, () => pauses.begin('username:burst', null)),
    );

    expect(admitted.filter((attempt) => attempt.admitted)).toHaveLength(10);
  });
});
