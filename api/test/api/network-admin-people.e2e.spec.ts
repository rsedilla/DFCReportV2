import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin's people powers and their limits (SKILL.md section 7, *The Network
 * Admin*, decision 0469): add, edit, archive, restore and move, in their own Network, and
 * never an administrator's, a Senior Pastor's or a root's record. Every name is invented
 * (CLAUDE.md, Secrets).
 *
 * The tree: Wilma (Women's root) -> Wanda -> Winnie, and Wilma -> Wendy. Mario (Men's root)
 * -> Manny -> Milo.
 */
describe('the Network Admin’s people (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let networkAdmin: TestAccount;
  let networkAdminPerson: TestPerson;
  let otherNetworkAdminPerson: TestPerson;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let wanda: TestPerson;
  let wendy: TestPerson;
  let winnie: TestPerson;
  let manny: TestPerson;
  let milo: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ada', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    womensRoot = await createPerson(db, { firstName: 'Wilma', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);
    mensRoot = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mensRoot.id, null);

    wanda = await createPerson(db, { firstName: 'Wanda', network: 'WOMENS' });
    await assignTo(db, wanda.id, womensRoot.id);
    wendy = await createPerson(db, { firstName: 'Wendy', network: 'WOMENS' });
    await assignTo(db, wendy.id, womensRoot.id);
    winnie = await createPerson(db, { firstName: 'Winnie', network: 'WOMENS' });
    await assignTo(db, winnie.id, wanda.id);

    manny = await createPerson(db, { firstName: 'Manny', network: 'MENS' });
    await assignTo(db, manny.id, mensRoot.id);
    milo = await createPerson(db, { firstName: 'Milo', network: 'MENS' });
    await assignTo(db, milo.id, manny.id);

    networkAdminPerson = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
    networkAdmin = await createAccount(app, db, {
      person: networkAdminPerson,
      roles: ['NETWORK_ADMIN'],
    });
    otherNetworkAdminPerson = await createPerson(db, { firstName: 'Olga', network: 'WOMENS' });
    await createAccount(app, db, { person: otherNetworkAdminPerson, roles: ['NETWORK_ADMIN'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const send = (
    method: 'post' | 'put' | 'patch',
    account: TestAccount,
    path: string,
    body: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const code = (response: request.Response): string =>
    (response.body.error?.code ?? response.body.code) as string;

  const move = (account: TestAccount, personId: string, leaderId: string) =>
    send('put', account, `/people/${personId}/pastoral-leader`, { pastoral_leader_id: leaderId });

  const leaderOf = async (personId: string): Promise<string | null> =>
    (
      await db
        .selectFrom('pastoral_assignments')
        .select('leader_id')
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow()
    ).leader_id;

  const added = (leaderId: string, sex: 'FEMALE' | 'MALE') => ({
    first_name: 'Added',
    last_name: 'Byher',
    birth_date_not_given: true,
    sex,
    civil_status: 'SINGLE',
    mobile_number_not_given: true,
    pastoral_leader_id: leaderId,
  });

  describe('adding a person', () => {
    it('adds under a leader of their Network, their root included', async () => {
      expect((await send('post', networkAdmin, '/people', added(wanda.id, 'FEMALE'))).status).toBe(
        201,
      );
      expect(
        (
          await send('post', networkAdmin, '/people', {
            ...added(womensRoot.id, 'FEMALE'),
            first_name: 'Another',
          })
        ).status,
      ).toBe(201);
    });

    it('adds nobody under an administrator outside the tree', async () => {
      const response = await send('post', networkAdmin, '/people', added(admin.personId, 'FEMALE'));

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
    });

    it('adds nobody under a leader of the other Network', async () => {
      const response = await send('post', networkAdmin, '/people', added(manny.id, 'MALE'));

      expect(response.status).toBe(403);
      expect(code(response)).toBe('SCOPE_DENIED');
    });
  });

  describe('editing details', () => {
    it('edits a person of their Network', async () => {
      const response = await send('patch', networkAdmin, `/people/${winnie.id}`, {
        first_name: 'Winifred',
      });

      expect(response.status).toBe(200);
    });

    it('edits nobody of the other Network', async () => {
      const response = await send('patch', networkAdmin, `/people/${milo.id}`, {
        first_name: 'Miles',
      });

      expect(response.status).toBe(403);
    });

    it('edits their own basic details', async () => {
      const response = await send('patch', networkAdmin, `/people/${networkAdminPerson.id}`, {
        middle_name: 'Marie',
      });

      expect(response.status).toBe(200);
    });

    it('edits no root, Admin, Senior Pastor or other Network Admin', async () => {
      const seniorPastor = await createPerson(db, { firstName: 'Selma', network: 'WOMENS' });
      await assignTo(db, seniorPastor.id, wanda.id);
      await createAccount(app, db, { person: seniorPastor, roles: ['SENIOR_PASTOR'] });
      const adminInTree = await createPerson(db, { firstName: 'Abby', network: 'WOMENS' });
      await assignTo(db, adminInTree.id, wanda.id);
      await createAccount(app, db, { person: adminInTree, roles: ['ADMIN'] });

      for (const person of [womensRoot, seniorPastor, adminInTree, otherNetworkAdminPerson]) {
        const response = await send('patch', networkAdmin, `/people/${person.id}`, {
          middle_name: 'Changed',
        });

        expect([person.firstName, response.status, code(response)]).toEqual([
          person.firstName,
          403,
          'SCOPE_DENIED',
        ]);
      }
    });

    it('sets no title', async () => {
      const response = await send('patch', networkAdmin, `/people/${winnie.id}`, {
        title: 'Pastora',
      });

      expect(response.status).toBe(403);
    });

    it('leaves the Admin editing a root as before', async () => {
      const response = await send('patch', admin, `/people/${womensRoot.id}`, {
        middle_name: 'Marie',
      });

      expect(response.status).toBe(200);
    });
  });

  describe('archiving and restoring', () => {
    const archive = (account: TestAccount, personId: string, extra: Record<string, unknown> = {}) =>
      send('post', account, `/people/${personId}/archive`, { reason: 'MOVED_AWAY', ...extra });

    it('archives and restores a person of their Network', async () => {
      expect((await archive(networkAdmin, winnie.id)).status).toBe(200);
      expect((await send('post', networkAdmin, `/people/${winnie.id}/restore`)).status).toBe(200);
    });

    it('archives nobody of the other Network', async () => {
      const response = await archive(networkAdmin, milo.id);

      expect(response.status).toBe(403);
      expect(code(response)).toBe('SCOPE_DENIED');
    });

    it('disables a Leader account with the archive', async () => {
      const account = await createAccount(app, db, { person: winnie, roles: ['LEADER'] });

      const response = await archive(networkAdmin, winnie.id, { account_access: 'DISABLE' });

      expect(response.status).toBe(200);
      const stored = await db
        .selectFrom('accounts')
        .select('status')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();
      expect(stored.status).toBe('DISABLED');
    });

    it('archives no administrator, with or without an account decision', async () => {
      const adminInTree = await createPerson(db, { firstName: 'Abby', network: 'WOMENS' });
      await assignTo(db, adminInTree.id, wanda.id);
      await createAccount(app, db, { person: adminInTree, roles: ['ADMIN', 'LEADER'] });

      for (const extra of [{}, { account_access: 'DISABLE' }, { account_access: 'KEEP' }]) {
        const response = await archive(networkAdmin, adminInTree.id, extra);

        expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
      }

      const other = await archive(networkAdmin, otherNetworkAdminPerson.id);
      expect([other.status, code(other)]).toEqual([403, 'SCOPE_DENIED']);
    });

    it('restores no administrator the Admin archived', async () => {
      expect(
        (await archive(admin, otherNetworkAdminPerson.id, { account_access: 'DISABLE' })).status,
      ).toBe(200);

      const response = await send(
        'post',
        networkAdmin,
        `/people/${otherNetworkAdminPerson.id}/restore`,
      );

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
    });

    it('lists the archived people of their Network alone', async () => {
      expect((await archive(admin, winnie.id)).status).toBe(200);
      expect((await archive(admin, milo.id)).status).toBe(200);

      const own = await get(networkAdmin, '/people/archived').expect(200);
      const all = await get(admin, '/people/archived').expect(200);

      expect((own.body.data as { id: string }[]).map((row) => row.id)).toEqual([winnie.id]);
      expect(all.body.data).toHaveLength(2);
    });

    it('leaves out an archived administrator, whom they could not restore', async () => {
      expect(
        (await archive(admin, otherNetworkAdminPerson.id, { account_access: 'DISABLE' })).status,
      ).toBe(200);

      const own = await get(networkAdmin, '/people/archived').expect(200);
      const all = await get(admin, '/people/archived').expect(200);

      expect(own.body.data).toHaveLength(0);
      expect(all.body.data).toHaveLength(1);
    });

    it('reads a record only the Admin changes as read-only, and their own as not', async () => {
      const root = await get(networkAdmin, `/people/${womensRoot.id}`).expect(200);
      const person = await get(networkAdmin, `/people/${winnie.id}`).expect(200);
      const self = await get(networkAdmin, `/people/${networkAdminPerson.id}`).expect(200);
      const asAdmin = await get(admin, `/people/${womensRoot.id}`).expect(200);

      expect([
        root.body.read_only,
        person.body.read_only,
        self.body.read_only,
        asAdmin.body.read_only,
      ]).toEqual([true, false, false, false]);
    });

    it('refuses a Leader the archived list as before', async () => {
      const leader = await createAccount(app, db, { person: wanda, roles: ['LEADER'] });

      expect((await get(leader, '/people/archived')).status).toBe(403);
    });
  });

  // CLAUDE.md, Authorization test suite, case 13.
  describe('moving a person (authorization case 13)', () => {
    it('moves a person between two branches of their Network', async () => {
      const response = await move(networkAdmin, winnie.id, wendy.id);

      expect(response.status).toBe(200);
      expect(await leaderOf(winnie.id)).toBe(wendy.id);
    });

    it('moves a person inside one branch, to and from the root', async () => {
      expect((await move(networkAdmin, winnie.id, womensRoot.id)).status).toBe(200);
      expect((await move(networkAdmin, winnie.id, wanda.id)).status).toBe(200);
      expect(await leaderOf(winnie.id)).toBe(wanda.id);
    });

    it('moves nobody inside the other Network', async () => {
      const response = await move(networkAdmin, milo.id, mensRoot.id);

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
      expect(await leaderOf(milo.id)).toBe(manny.id);
    });

    it('moves nobody out of their Network into the other', async () => {
      const response = await move(networkAdmin, winnie.id, manny.id);

      expect(response.status).toBe(403);
      expect(code(response)).toBe('SCOPE_DENIED');
      expect(await leaderOf(winnie.id)).toBe(wanda.id);
    });

    it('moves nobody of the other Network into theirs', async () => {
      const response = await move(networkAdmin, milo.id, wanda.id);

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
      expect(await leaderOf(milo.id)).toBe(manny.id);
    });

    it('moves no administrator placed in the tree', async () => {
      const adminInTree = await createPerson(db, { firstName: 'Abby', network: 'WOMENS' });
      await assignTo(db, adminInTree.id, wanda.id);
      await createAccount(app, db, { person: adminInTree, roles: ['ADMIN'] });

      const response = await move(networkAdmin, adminInTree.id, wendy.id);

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
      expect(await leaderOf(adminInTree.id)).toBe(wanda.id);
    });

    it('moves nobody under an administrator outside the tree', async () => {
      const response = await move(networkAdmin, winnie.id, admin.personId);

      expect([response.status, code(response)]).toEqual([403, 'SCOPE_DENIED']);
      expect(JSON.stringify(response.body)).toContain('outside the pastoral tree');
      expect(await leaderOf(winnie.id)).toBe(wanda.id);
    });

    it('says the same of any leader of the other Network, in the tree or not', async () => {
      const outside = await createAccount(app, db, {
        person: await createPerson(db, { firstName: 'Omar', network: 'MENS' }),
        roles: ['ADMIN'],
      });

      const inTree = await move(networkAdmin, winnie.id, manny.id);
      const notInTree = await move(networkAdmin, winnie.id, outside.personId);

      expect([inTree.status, code(inTree)]).toEqual([403, 'SCOPE_DENIED']);
      expect(notInTree.body).toEqual(inTree.body);
    });

    it('is refused a move that would close a cycle', async () => {
      const response = await move(networkAdmin, wanda.id, winnie.id);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await leaderOf(wanda.id)).toBe(womensRoot.id);
    });

    it('backdates no move', async () => {
      const response = await send('put', networkAdmin, `/people/${winnie.id}/pastoral-leader`, {
        pastoral_leader_id: wendy.id,
        effective_date: '2026-01-05',
        reason: 'Recorded late',
      });

      expect(response.status).toBe(403);
      expect(await leaderOf(winnie.id)).toBe(wanda.id);
    });
  });

  it('holds the four people capabilities across its Network, and no more', async () => {
    const me = await get(networkAdmin, '/auth/me').expect(200);
    const held = (
      me.body.capabilities as {
        capability: string;
        scope_type: string;
        scope_network: string | null;
      }[]
    )
      .filter((grant) => grant.capability.startsWith('people.'))
      .map((grant) => `${grant.capability}@${grant.scope_type}`)
      .sort();

    expect(held).toEqual([
      'people.create@NETWORK',
      'people.edit_basic@NETWORK',
      'people.manage_lifecycle@NETWORK',
      'people.manage_pastoral_assignment@NETWORK',
      'people.view_subtree@NETWORK',
    ]);
  });
});
