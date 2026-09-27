import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { createAccount, createPerson, createTestApp, resetRateLimits } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * The rate limit is counted per signed-in account, and per address otherwise
 * (SKILL.md section 24, rate limiting; `AccountThrottlerGuard`).
 *
 * **Why it matters**: a room of leaders on one church wifi, or a carrier putting its
 * customers behind a few public addresses, shares one address. Counted per address,
 * one of them exhausting a route's allowance refuses every other one.
 *
 * **Only a token whose signature verifies selects the account**, otherwise a client
 * could escape the limit, or spend somebody else's, by naming an identity it made up.
 * The forged-token case below is the one that fails if the guard ever reads the
 * token's claims without verifying them.
 *
 * `GET /api/v1/auth/me` carries only the global limit, 120 a minute per route
 * (`app.module.ts`). The address is set with `X-Forwarded-For`, which the application
 * honours from loopback exactly as it does behind nginx (`bootstrap.ts`), so each case
 * chooses its own address rather than sharing the test runner's.
 *
 * Fixture names and addresses are invented (CLAUDE.md, Secrets; RFC 5737 ranges).
 */
describe('rate limiting is per account for a signed-in request (section 24)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let mark: TestAccount;
  let manuel: TestAccount;

  /** The global per-route limit, from `ThrottlerModule.forRoot` in `app.module.ts`. */
  const LIMIT = 120;

  const SHARED_ADDRESS = '198.51.100.20';
  const OTHER_ADDRESS = '203.0.113.40';

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    resetRateLimits(app);

    mark = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Mark', network: 'MENS' }),
      roles: ['LEADER'],
    });
    manuel = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Manuel', network: 'MENS' }),
      roles: ['LEADER'],
    });
  });

  afterAll(async () => {
    resetRateLimits(app);
    await app.close();
    await db.destroy();
  });

  const me = (address: string, bearer?: string): request.Test => {
    const req = request(app.getHttpServer()).get('/api/v1/auth/me').set('X-Forwarded-For', address);

    return bearer === undefined ? req : req.set('Authorization', `Bearer ${bearer}`);
  };

  /** Sends `count` requests one after another and returns their statuses. */
  const statuses = async (count: number, send: () => request.Test): Promise<number[]> => {
    const answers: number[] = [];
    for (let attempt = 0; attempt < count; attempt += 1) {
      answers.push((await send()).status);
    }

    return answers;
  };

  /** A token with Mark's header and claims and a signature this API never made. */
  const forgedFrom = (token: string): string => {
    const [header, payload] = token.split('.');

    return `${header}.${payload}.${Buffer.from('not the signature').toString('base64url')}`;
  };

  it('gives two accounts on one address an allowance each', async () => {
    const marks = await statuses(LIMIT, () => me(SHARED_ADDRESS, mark.accessToken));
    expect(marks.every((status) => status === 200)).toBe(true);

    const exhausted = await me(SHARED_ADDRESS, mark.accessToken);
    expect(exhausted.status).toBe(429);
    expect(exhausted.body.error.code).toBe('RATE_LIMITED');

    // Manuel is on the same address and has spent nothing.
    await me(SHARED_ADDRESS, manuel.accessToken).expect(200);

    // And the count is the account's, not the address's: Mark moving to another
    // address does not buy him a fresh allowance.
    expect((await me(OTHER_ADDRESS, mark.accessToken)).status).toBe(429);
  });

  it('counts a request whose bearer does not verify against its address', async () => {
    const invalid = await statuses(LIMIT, () => me(SHARED_ADDRESS, 'not-a-token'));
    expect(invalid.every((status) => status === 401)).toBe(true);

    // The limit runs before authentication, so the next one is refused as limited.
    expect((await me(SHARED_ADDRESS, 'not-a-token')).status).toBe(429);

    // It is the address that is spent, not the string: a different bad token, and no
    // token at all, from the same address are refused too...
    expect((await me(SHARED_ADDRESS, 'another-bad-token')).status).toBe(429);
    expect((await me(SHARED_ADDRESS)).status).toBe(429);

    // ...while the same bad token from another address is only unauthenticated,
    await me(OTHER_ADDRESS, 'not-a-token').expect(401);

    // and a signed-in account on the spent address is counted as itself.
    await me(SHARED_ADDRESS, mark.accessToken).expect(200);
  });

  it('does not charge an account for a forged token naming it', async () => {
    // A token carrying Mark's claims under a signature this API did not make must not
    // select Mark's allowance: otherwise anybody could exhaust his by naming him, and
    // escape their own by naming somebody else.
    const forged = forgedFrom(mark.accessToken);

    const answers = await statuses(LIMIT, () => me(SHARED_ADDRESS, forged));
    expect(answers.every((status) => status === 401)).toBe(true);
    expect((await me(SHARED_ADDRESS, forged)).status).toBe(429);

    // Mark's own allowance is untouched, from the address that spent its own.
    await me(SHARED_ADDRESS, mark.accessToken).expect(200);
  });

  it('counts sign-in per address even when it carries a valid bearer', async () => {
    // Sign-in is the endpoint worth guessing against, and it is limited to 10 a minute
    // (`auth.controller.ts`). If a valid bearer moved it onto the account's count,
    // anybody holding several accounts would get 10 guesses per account from one
    // address. A route that needs no sign-in is counted per address, whatever token
    // it carries.
    const LOGIN_LIMIT = 10;
    const login = (address: string, bearer?: string): request.Test => {
      const req = request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', address)
        .send({ email: 'nobody@example.test', password: 'a wrong passphrase' });

      return bearer === undefined ? req : req.set('Authorization', `Bearer ${bearer}`);
    };

    const spent = await statuses(LOGIN_LIMIT, () => login(SHARED_ADDRESS, mark.accessToken));
    expect(spent).not.toContain(429);

    // The address has spent its allowance, although every request carried Mark's token.
    const withoutToken = await login(SHARED_ADDRESS);
    expect(withoutToken.status).toBe(429);
    expect(withoutToken.body.error.code).toBe('RATE_LIMITED');

    // Another token does not buy a fresh allowance on that address either.
    expect((await login(SHARED_ADDRESS, manuel.accessToken)).status).toBe(429);

    // Another address has spent nothing.
    expect((await login(OTHER_ADDRESS)).status).not.toBe(429);
  });
});
