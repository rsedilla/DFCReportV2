import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { CAPABILITY_METADATA } from '../../src/auth/authorization/authorization.decorators';
import { Capability } from '../../src/auth/authorization/capabilities';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { CapabilityRequirement } from '../../src/auth/authorization/authorization.decorators';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

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

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const root = await createPerson(db, { firstName: 'Rafael', network: 'MENS' });
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
});
