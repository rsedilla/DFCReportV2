import { randomUUID } from 'node:crypto';

import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import request from 'supertest';

import { CAPABILITY_METADATA } from '../../src/auth/authorization/authorization.decorators';
import { LEADER_FULL_VIEW_ONLY } from '../../src/auth/authorization/role-defaults';
import { reportRangeGuardMonth } from '../../src/common/time/report-range';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { CapabilityRequirement } from '../../src/auth/authorization/authorization.decorators';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Full view (SKILL.md section 7, decision 0323), pinned at the API as point 8 asks.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Full view (decision 0323)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let leader: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    nameSeniorPastors(app, []);

    root = await createPerson(db, { firstName: 'Rafael', network: 'MENS' });
    await assignTo(db, root.id, null);
    leader = await createPerson(db, { firstName: 'Lauro', network: 'MENS' });
    await assignTo(db, leader.id, root.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** The current Manila month, as a reporting period that has begun. */
  function thisMonth(): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    return `${today.slice(0, 7)}-01`;
  }

  /**
   * One well-formed request for every route guarded by a capability Full view withholds.
   * Keyed `METHOD /path` so the case below can compare it with what the controllers declare.
   */
  function guardedRequests(
    self: string,
    disciple: string = randomUUID(),
  ): Record<string, (token: string) => request.Test> {
    const period = thisMonth();
    const leaderScope = { scope: 'LEADER', leader_id: self, period };
    const get =
      (path: string, query: Record<string, string> = {}) =>
      (token: string) =>
        request(app.getHttpServer())
          .get(`/api/v1/${path}`)
          .query(query)
          .set('Authorization', `Bearer ${token}`);

    return {
      'GET /reports/dcc/monthly': get('reports/dcc/monthly', leaderScope),
      'GET /reports/cells/monthly': get('reports/cells/monthly', leaderScope),
      'GET /reports/dcc/monthly/by-leader': get('reports/dcc/monthly/by-leader', leaderScope),
      'GET /reports/cells/monthly/by-leader': get('reports/cells/monthly/by-leader', leaderScope),
      'GET /reports/dcc/twelve': get('reports/dcc/twelve', {
        ...leaderScope,
        kind: 'MONTH',
        start: period,
      }),
      'GET /reports/cells/twelve': get('reports/cells/twelve', {
        ...leaderScope,
        kind: 'MONTH',
        start: period,
      }),
      'GET /reports/recording-status': get('reports/recording-status', {
        kind: 'WEEK',
        start: lastMonday(),
        // The month a last-week range resolves at, as the My 12 tables name it.
        period: reportRangeGuardMonth(
          'WEEK',
          lastMonday(),
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
        ),
      }),
      'GET /training/counts': get('training/counts'),
      'GET /training/people': get('training/people'),
      'POST /training/submit': (token) =>
        request(app.getHttpServer())
          .post('/api/v1/training/submit')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ changes: [{ person_id: disciple, program: 'LIFE_CLASS', graduated: true }] }),
      'GET /conquest/counts': get('conquest/counts'),
      'GET /conquest/people': get('conquest/people'),
    };
  }

  /** A Monday that has passed, for a week that has begun. */
  function lastMonday(): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return new Date(Date.UTC(y, m - 1, d - ((weekday + 6) % 7) - 7)).toISOString().slice(0, 10);
  }

  /**
   * Routes a Leader holds the capability for and still may not read, because they are
   * Whole Church only: refused at the scope rather than at the capability (decision 0325).
   */
  const WHOLE_CHURCH_ONLY = new Set(['GET /reports/recording-status']);
  /** Every route whose declared capability is one Full view withholds, from the controllers. */
  function declaredGuardedRoutes(): string[] {
    const found: string[] = [];

    for (const module of app.get(ModulesContainer, { strict: false }).values()) {
      for (const wrapper of module.controllers.values()) {
        const instance = wrapper.instance as object | undefined;
        if (!instance) {
          continue;
        }

        const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
        const base = String(Reflect.getMetadata(PATH_METADATA, prototype.constructor) ?? '');

        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') {
            continue;
          }

          const requirement = (Reflect.getMetadata(CAPABILITY_METADATA, handler) ??
            Reflect.getMetadata(CAPABILITY_METADATA, prototype.constructor)) as
            CapabilityRequirement | undefined;

          if (requirement && LEADER_FULL_VIEW_ONLY.has(requirement.capability)) {
            const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
            const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
            found.push(`${method} /${[base, path].filter((part) => part !== '').join('/')}`);
          }
        }
      }
    }

    return found.sort();
  }

  async function leaderAccount(fullView: boolean): Promise<TestAccount> {
    return createAccount(app, db, { person: leader, roles: ['LEADER'], fullView });
  }

  async function admin(): Promise<TestAccount> {
    return createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
  }

  function setFullView(
    actor: TestAccount,
    accountId: string,
    fullView: boolean,
    key: string = randomUUID(),
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/full-view`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ full_view: fullView });
  }

  function me(account: TestAccount): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`);
  }

  function capabilitiesOf(body: { capabilities: { capability: string }[] }): string[] {
    return body.capabilities.map((grant) => grant.capability);
  }

  describe('the routes Full view withholds', () => {
    it('lists every route the controllers guard with a withheld capability', () => {
      const declared = declaredGuardedRoutes();

      // The vacuity guard: an empty scan would satisfy the comparison with an empty list.
      expect(declared.length).toBeGreaterThan(0);
      expect(declared).toEqual(Object.keys(guardedRequests(leader.id)).sort());
    });

    it('refuses each of them to a Leader without Full view', async () => {
      const account = await leaderAccount(false);

      for (const [route, send] of Object.entries(guardedRequests(leader.id))) {
        const response = await send(account.accessToken);
        expect({ route, status: response.status, code: response.body.error?.code }).toEqual({
          route,
          status: 403,
          code: 'CAPABILITY_DENIED',
        });
      }
    });

    it('admits the same account to each of them once it holds Full view', async () => {
      const account = await leaderAccount(true);
      const disciple = await createPerson(db, { firstName: 'Danilo', network: 'MENS' });
      await assignTo(db, disciple.id, leader.id);

      for (const [route, send] of Object.entries(guardedRequests(leader.id, disciple.id))) {
        const response = await send(account.accessToken);
        if (WHOLE_CHURCH_ONLY.has(route)) {
          expect({ route, code: response.body.error?.code }).toEqual({
            route,
            code: 'SCOPE_DENIED',
          });
          continue;
        }
        expect({ route, admitted: response.status >= 200 && response.status < 300 }).toEqual({
          route,
          admitted: true,
        });
      }
    });
  });

  describe('ticking and clearing', () => {
    it('is admitted to an Admin, and each change is audit logged', async () => {
      const administrator = await admin();
      const account = await leaderAccount(false);

      const ticked = await setFullView(administrator, account.id, true).expect(200);
      expect(ticked.body).toEqual({ id: account.id, full_view: true });
      expect((await me(account).expect(200)).body.screens).toBe('FULL');

      await setFullView(administrator, account.id, false).expect(200);
      expect((await me(account).expect(200)).body.screens).toBe('RECORDING');

      const entries = await db
        .selectFrom('audit_log')
        .select(['actor_id', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'account.full_view_changed')
        .orderBy('occurred_at')
        .execute();

      expect(entries).toEqual([
        {
          actor_id: administrator.id,
          target_type: 'account',
          target_id: account.id,
          before: { full_view: false },
          after: { full_view: true },
        },
        {
          actor_id: administrator.id,
          target_type: 'account',
          target_id: account.id,
          before: { full_view: true },
          after: { full_view: false },
        },
      ]);
    });

    it('writes nothing and logs nothing when the value is already set', async () => {
      const administrator = await admin();
      const account = await leaderAccount(true);

      const response = await setFullView(administrator, account.id, true).expect(200);
      expect(response.body).toEqual({ id: account.id, full_view: true });

      const entries = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'account.full_view_changed')
        .execute();
      expect(entries).toEqual([]);
    });

    it('replays the stored answer for a repeated idempotency key', async () => {
      const administrator = await admin();
      const account = await leaderAccount(false);
      const key = randomUUID();

      await setFullView(administrator, account.id, true, key).expect(200);
      const replay = await setFullView(administrator, account.id, true, key).expect(200);

      expect(replay.body).toEqual({ id: account.id, full_view: true });
      const entries = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'account.full_view_changed')
        .execute();
      expect(entries).toHaveLength(1);
    });

    it.each([true, false])(
      'refuses ticking and clearing to a Leader (actor with Full view: %s)',
      async (actorFullView) => {
        const target = await leaderAccount(false);
        const other = await createAccount(app, db, {
          person: await createPerson(db, { firstName: 'Teodoro', network: 'MENS' }),
          roles: ['LEADER'],
          fullView: actorFullView,
        });

        for (const value of [true, false]) {
          const response = await setFullView(other, target.id, value).expect(403);
          expect(response.body.error.code).toBe('CAPABILITY_DENIED');
        }
      },
    );

    it('is refused to a Senior Pastor', async () => {
      nameSeniorPastors(app, [root.id]);
      const pastor = await createAccount(app, db, {
        person: root,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });
      const target = await leaderAccount(false);

      for (const value of [true, false]) {
        const response = await setFullView(pastor, target.id, value).expect(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }
    });

    it('is refused on an account holding no Leader role', async () => {
      const administrator = await admin();
      const other = await admin();

      const response = await setFullView(administrator, other.id, true).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });
  });

  it('starts a new Leader account without Full view', async () => {
    const administrator = await admin();
    // A Leader account arrives with the Cell leadership that qualifies it (section 6).
    await createCell(db, { leader });

    await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ person_id: leader.id, email: 'lauro@example.test', role: 'LEADER' })
      .expect(201);

    const read = await request(app.getHttpServer())
      .get(`/api/v1/accounts/for-person/${leader.id}`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .expect(200);

    expect(read.body.account.full_view).toBe(false);
  });

  describe('what Full view does not touch', () => {
    it('changes nothing for a Senior Pastor', async () => {
      nameSeniorPastors(app, [root.id]);
      const pastor = await createAccount(app, db, {
        person: root,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
        fullView: false,
      });

      const body = (await me(pastor).expect(200)).body;
      expect(body.screens).toBe('SENIOR_PASTOR');
      expect(capabilitiesOf(body)).toEqual(expect.arrayContaining([...LEADER_FULL_VIEW_ONLY]));
    });

    it('changes nothing for an Admin', async () => {
      const administrator = await createAccount(app, db, {
        person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
        roles: ['ADMIN'],
        fullView: false,
      });

      const body = (await me(administrator).expect(200)).body;
      expect(body.screens).toBe('FULL');
      expect(capabilitiesOf(body)).toEqual(expect.arrayContaining([...LEADER_FULL_VIEW_ONLY]));
    });

    it('names the recording screens for a Leader without it, and none of the seven', async () => {
      const body = (await me(await leaderAccount(false)).expect(200)).body;

      expect(body.screens).toBe('RECORDING');
      for (const capability of LEADER_FULL_VIEW_ONLY) {
        expect(capabilitiesOf(body)).not.toContain(capability);
      }
    });
  });
});
