import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';

import { CAPABILITY_METADATA } from '../../src/auth/authorization/authorization.decorators';
import { Capability } from '../../src/auth/authorization/capabilities';
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
 * What the Senior Pastors may change (SKILL.md section 7, decision 0326, point 5), pinned at
 * the API: they read the church, record what they owe and reassign, and an administrator does
 * the rest. Recording and reassigning stay pinned where they were (`dcc-attendance` and
 * authorization case 8); this file pins the refusals.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
const WITHDRAWN: ReadonlySet<Capability> = new Set([
  Capability.PeopleCreate,
  Capability.PeopleEditBasic,
  Capability.PeopleManageLifecycle,
  Capability.DccCorrectSubtree,
  Capability.CellCorrectSubtree,
  Capability.CellManageMembership,
  Capability.CellManageLeadership,
  Capability.CellManageConfiguration,
  Capability.CellManageLifecycle,
  Capability.SuynlConfirm,
  Capability.TrainingConfirm,
  Capability.TrainingConfirmOnBehalf,
  Capability.ConquestConfirm,
  Capability.ConquestConfirmOnBehalf,
]);

describe('the Senior Pastors change nothing but what they record and reassign (decision 0326)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let pastor: TestAccount;
  let root: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    root = await createPerson(db, { firstName: 'Rafael', network: 'MENS' });
    await assignTo(db, root.id, null);
    nameSeniorPastors(app, [root.id]);
    pastor = await createAccount(app, db, {
      person: root,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** Every route whose declared capability is one decision 0326 withdraws, from the controllers. */
  function declaredWithdrawnRoutes(): { method: string; path: string }[] {
    const found: { method: string; path: string }[] = [];

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

          if (requirement && WITHDRAWN.has(requirement.capability)) {
            const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
            const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
            // A controller's base and a handler's path may each carry their own slashes.
            const joined = `/${base}/${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
            found.push({ method, path: joined });
          }
        }
      }
    }

    return found;
  }

  it('refuses each route guarded by a withdrawn capability, before reading the request', async () => {
    const routes = declaredWithdrawnRoutes();

    // The vacuity guard: an empty scan would refuse nothing and pass.
    expect(routes.length).toBeGreaterThan(0);

    const answers: string[] = [];
    for (const route of routes) {
      // The guard runs before validation and before the idempotency interceptor, so an
      // identifier nobody holds reaches the refusal. A guard reading its target from the
      // body needs that field to be an identifier, which `POST /people` reads first.
      const path = route.path.replace(/:[A-Za-z_]+/g, () => randomUUID());
      const call = request(app.getHttpServer())
        [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
          `/api/v1${path}`,
        )
        .set('Authorization', `Bearer ${pastor.accessToken}`)
        .set('Idempotency-Key', randomUUID());
      const response =
        route.method === 'GET' ? await call : await call.send({ pastoral_leader_id: randomUUID() });

      answers.push(
        `${route.method} ${route.path} ${response.status} ${response.body?.error?.code}`,
      );
    }

    expect(answers.filter((answer) => !answer.endsWith(' 403 CAPABILITY_DENIED'))).toEqual([]);
  });

  it('holds every read, recording what it owes and reassigning, and nothing else', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pastor.accessToken}`)
      .expect(200);

    const held = (response.body.capabilities as { capability: string }[])
      .map((grant) => grant.capability)
      .sort();

    for (const capability of WITHDRAWN) {
      expect(held).not.toContain(capability);
    }
    expect(held).toEqual(
      expect.arrayContaining([
        'cell.take_attendance',
        'dcc.take_attendance',
        'people.manage_pastoral_assignment',
        'reports.view_subtree',
        'suynl.view_subtree',
      ]),
    );
  });

  /**
   * The withdrawn capabilities a route does not declare, so the scan above cannot reach them:
   * each is asked inside a handler. Each case sends the request that would exercise one, and
   * a control shows the same request succeeding for an Admin, so the refusal is the rule and
   * not an unrelated 4xx.
   *
   * **Three of the fourteen are referenced by no route, so no request can exercise them**:
   * `people.manage_lifecycle` (no archive or restore endpoint exists), `conquest.confirm` and `conquest.confirm_on_behalf` (nothing
   * writes `conquest_confirmations`). That they are withheld is pinned by the `/auth/me`
   * case above; no request is invented for them.
   *
   * **Two are reached only behind a guard a Senior Pastor already fails**, so their own check
   * is unreachable by a Senior Pastor holding the defaults: `cell.manage_leadership`, asked
   * by `POST /cells` after its `cell.approve_leadership` guard, and
   * `training.confirm_on_behalf`, asked by `POST /training/submit` after its
   * `training.confirm` guard. Their cases pin that the request is refused and name the
   * capability that refuses it. Reaching the inner check would need an explicit grant of the
   * outer capability to a Senior Pastor, and whether such a grant reaches a Senior Pastor at
   * all is open (`CLAUDE.md`, the Stop Condition raised on decision 0326), so no such grant
   * is written here.
   */
  describe('the withdrawn capabilities a handler asks for', () => {
    let admin: TestAccount;

    beforeEach(async () => {
      const adminPerson = await createPerson(db, { firstName: 'Adelaida', network: 'WOMENS' });
      admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });
    });

    const post = (account: TestAccount, path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    /** The Manila day the database is in, and the latest given weekday strictly before it. */
    const dayBefore = async (isoDow: number): Promise<string> => {
      // ISODOW: 1 Monday .. 7 Sunday. Strictly before today, so the day has ended and its
      // month is still open (the window shuts at the end of the 7th, decision 0170).
      const result = await sql<{ day: string }>`
        SELECT to_char(
                 d - (((EXTRACT(ISODOW FROM d)::int - ${sql.lit(isoDow)} + 6) % 7) + 1),
                 'YYYY-MM-DD'
               ) AS day
          FROM (SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS d) AS s
      `.execute(db);

      return result.rows[0].day;
    };

    it('refuses a Senior Pastor correcting a DCC record (dcc.correct_subtree), and lets an Admin', async () => {
      // Both roots are on a Senior Pastor's checklist (decision 0322), so recording the
      // Women's root is theirs and needs no on-behalf capability: the refusal below can only
      // be the amendment's.
      const grace = await createPerson(db, { firstName: 'Graciana', network: 'WOMENS' });
      await assignTo(db, grace.id, null);
      nameSeniorPastors(app, [root.id, grace.id]);

      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: await dayBefore(7) })
        .returning('id')
        .executeTakeFirstOrThrow();
      const path = `/dcc/events/${event.id}/submit`;

      await post(pastor, path, {
        records: [{ person_id: grace.id, present: true, version: null }],
      }).expect(201);

      const correction = {
        records: [
          {
            person_id: grace.id,
            present: false,
            version: 1,
            correction_reason: 'Invented for this case (CLAUDE.md, Secrets).',
          },
        ],
      };

      const refused = await post(pastor, path, correction);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');
      expect(refused.body.error.details.capability).toBe('dcc.correct_subtree');

      const live = await db
        .selectFrom('dcc_attendance')
        .select(['present'])
        .where('dcc_event_id', '=', event.id)
        .where('superseded_at', 'is', null)
        .execute();
      expect(live).toEqual([{ present: true }]);

      // The control: the identical body from an Admin is a correction that succeeds.
      expect((await post(admin, path, correction)).status).toBe(201);
    });

    it('refuses a Senior Pastor correcting their own recorded Cell meeting (cell.correct_subtree), and lets an Admin', async () => {
      // The Senior Pastor leads this Cell, so recording it is theirs and needs no on-behalf
      // capability: the refusal below can only be the amendment's.
      const CREATED = new Date('2026-01-03T10:00:00+08:00');
      const cell = await createCell(db, { leader: root, dayOfWeek: 6, createdAt: CREATED });
      const aurelia = await createPerson(db, { firstName: 'Aurelia', network: 'MENS' });
      await assignTo(db, aurelia.id, root.id);
      await db
        .insertInto('cell_memberships')
        .values({ person_id: aurelia.id, cell_id: cell.id, started_at: CREATED })
        .execute();
      const path = `/cells/${cell.id}/meetings/${await dayBefore(6)}/submit`;

      const first = await post(pastor, path, {
        status: 'HELD',
        attendance: [{ person_id: aurelia.id, present: true }],
      });
      expect(first.status).toBe(201);

      const correction = {
        status: 'HELD',
        version: first.body.version as number,
        attendance: [{ person_id: aurelia.id, present: false }],
        correction_reason: 'Invented for this case (CLAUDE.md, Secrets).',
      };

      const refused = await post(pastor, path, correction);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE_DENIED');
      expect(refused.body.error.details.capability).toBe('cell.correct_subtree');

      expect((await post(admin, path, correction)).status).toBe(201);
    });

    it('refuses a Senior Pastor creating a Cell directly (cell.manage_leadership, behind its guard), and lets an Admin', async () => {
      const marcial = await createPerson(db, { firstName: 'Marcial', network: 'MENS' });
      await assignTo(db, marcial.id, root.id);
      const body = {
        cell_leader_id: marcial.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '19:00',
      };

      const refused = await post(pastor, '/cells', body);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
      // The guard's capability refuses first; see this block's docblock.
      expect(refused.body.error.details.capability).toBe('cell.approve_leadership');
      expect(await db.selectFrom('cells').select('id').execute()).toEqual([]);

      expect((await post(admin, '/cells', body)).status).toBe(201);
    });

    it('refuses a Senior Pastor filing a graduation on behalf (training.confirm_on_behalf, behind its guard), and lets an Admin', async () => {
      // Teofilo is the disciple of a leader beneath the Senior Pastor who holds an account,
      // so filing for him is on behalf of that leader -- the request `training.confirm_on_behalf` governs.
      const manuel = await createPerson(db, { firstName: 'Manolo', network: 'MENS' });
      await assignTo(db, manuel.id, root.id);
      await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
      const disciple = await createPerson(db, { firstName: 'Teofilo', network: 'MENS' });
      await assignTo(db, disciple.id, manuel.id);
      const body = { changes: [{ person_id: disciple.id, program: 'SOL_1', graduated: true }] };

      const refused = await post(pastor, '/training/submit', body);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
      // The guard's capability refuses first; see this block's docblock.
      expect(refused.body.error.details.capability).toBe('training.confirm');
      expect(await db.selectFrom('training_graduations').select('id').execute()).toEqual([]);

      expect((await post(admin, '/training/submit', body)).status).toBe(201);
    });
  });
});
