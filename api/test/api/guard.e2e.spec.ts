import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';

import { Capability } from '../../src/auth/authorization/capabilities';
import {
  AuthenticatedOnly,
  Public,
  RequiresCapability,
} from '../../src/auth/authorization/authorization.decorators';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A controller that exists only here, carrying one endpoint of each declaration
 * the guard understands. The first of them is the important one: it declares
 * nothing at all, which is how an endpoint gets written on a busy afternoon.
 */
@Controller('__guard-probe')
class GuardProbeController {
  @Get('undeclared')
  undeclared(): { reached: true } {
    return { reached: true };
  }

  @Get('public')
  @Public('Probe for the public path.')
  publicEndpoint(): { reached: true } {
    return { reached: true };
  }

  @Get('authenticated-only')
  @AuthenticatedOnly('Probe for the authenticated-only path.')
  authenticatedOnly(): { reached: true } {
    return { reached: true };
  }

  @Get('person/:id')
  @RequiresCapability(Capability.PeopleViewSubtree, { kind: 'person', from: 'params.id' })
  person(): { reached: true } {
    return { reached: true };
  }

  @Get('settings')
  @RequiresCapability(Capability.SettingsManage, { kind: 'church' })
  settings(): { reached: true } {
    return { reached: true };
  }
}

describe('the capability guard (SKILL.md section 7)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let sibling: TestPerson;

  let raymondAccount: TestAccount;
  let adminAccount: TestAccount;
  let grantlessAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp([GuardProbeController]);
  });

  beforeEach(async () => {
    await truncateAll(db);

    // Raymond -> Manuel -> Mark, with a sibling branch Raymond does not oversee.
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    sibling = await createPerson(db, { firstName: 'Rico', network: 'MENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, sibling.id, oriel.id);

    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    grantlessAccount = await createAccount(app, db, { person: sibling, roles: [] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  describe('an endpoint that declares no capability', () => {
    it('is denied even to an Admin, because the absence of a declaration is a denial', async () => {
      const response = await get('/__guard-probe/undeclared', adminAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('is unauthenticated before it is anything else', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/__guard-probe/undeclared');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('the two declared exemptions', () => {
    it('lets a public endpoint through without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/__guard-probe/public');

      expect(response.status).toBe(200);
    });

    it('lets an authenticated-only endpoint through with a token', async () => {
      const response = await get('/__guard-probe/authenticated-only', raymondAccount);

      expect(response.status).toBe(200);
    });

    it('still refuses an authenticated-only endpoint without one', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/__guard-probe/authenticated-only',
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('capability and scope are separate answers', () => {
    it('reports a missing capability as CAPABILITY_DENIED', async () => {
      const response = await get(`/__guard-probe/person/${sibling.id}`, grantlessAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('reports a capability held over the wrong target as SCOPE_DENIED', async () => {
      // Raymond holds people.view_subtree at own/subtree scope. Rico is on a
      // sibling branch, so the capability is held and the target is not covered.
      const response = await get(`/__guard-probe/person/${sibling.id}`, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  describe('OWN_SUBTREE', () => {
    it('covers a descendant', async () => {
      const response = await get(`/__guard-probe/person/${mark.id}`, raymondAccount);

      expect(response.status).toBe(200);
    });

    it('covers the actor, deliberately', async () => {
      // A leader edits their own basic details and records their own attendance.
      const response = await get(`/__guard-probe/person/${raymond.id}`, raymondAccount);

      expect(response.status).toBe(200);
    });

    it('covers a direct child', async () => {
      const response = await get(`/__guard-probe/person/${manuel.id}`, raymondAccount);

      expect(response.status).toBe(200);
    });

    it('does not reach the upline of the actor', async () => {
      // Scope runs downward. Position in the tree is what a leader's authority is
      // derived from, so it never extends above them.
      const response = await get(`/__guard-probe/person/${oriel.id}`, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  describe('a church-wide target', () => {
    it('is covered by Whole Church scope', async () => {
      const response = await get('/__guard-probe/settings', adminAccount);

      expect(response.status).toBe(200);
    });

    it('is not covered by a Leader default', async () => {
      const response = await get('/__guard-probe/settings', raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('is not covered by a Network-scoped grant of the same capability', async () => {
      // A setting alters behaviour for the entire church from one control, and is
      // never in scope at any value narrower than Whole Church (section 7).
      await db
        .insertInto('capability_grants')
        .values({
          account_id: raymondAccount.id,
          capability: 'settings.manage',
          scope_type: 'NETWORK',
          scope_network: 'MENS',
          read_only: false,
          reason: 'Guard probe.',
          granted_by: adminAccount.id,
        })
        .execute();

      const response = await get('/__guard-probe/settings', raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  describe('an explicit grant', () => {
    it('widens authority without touching the pastoral tree', async () => {
      // An Associate Pastor remains pastorally where they are, while Admin grants
      // report visibility at a wider scope (section 7).
      await db
        .insertInto('capability_grants')
        .values({
          account_id: grantlessAccount.id,
          capability: 'people.view_subtree',
          scope_type: 'WHOLE_CHURCH',
          read_only: true,
          reason: 'Guard probe.',
          granted_by: adminAccount.id,
        })
        .execute();

      const response = await get(`/__guard-probe/person/${mark.id}`, grantlessAccount);

      expect(response.status).toBe(200);
    });

    it('stops covering anything once revoked', async () => {
      const grant = await db
        .insertInto('capability_grants')
        .values({
          account_id: grantlessAccount.id,
          capability: 'people.view_subtree',
          scope_type: 'WHOLE_CHURCH',
          read_only: true,
          reason: 'Guard probe.',
          granted_by: adminAccount.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await db
        .updateTable('capability_grants')
        .set({ revoked_at: new Date() })
        .where('id', '=', grant.id)
        .execute();

      const response = await get(`/__guard-probe/person/${mark.id}`, grantlessAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });
  });

  function get(path: string, account: TestAccount) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);
  }
});
