import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin's account powers and their limits (SKILL.md section 7, *The Network
 * Admin*, decision 0469): Leader accounts of their own Network, and Full view alone. Every
 * name is invented (CLAUDE.md, Secrets).
 */
describe('the Network Admin’s accounts (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let networkAdmin: TestAccount;
  let otherNetworkAdmin: TestAccount;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let woman: TestPerson;
  let man: TestPerson;
  let womanLeader: TestAccount;
  let manLeader: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const adminPerson = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    womensRoot = await createPerson(db, { firstName: 'Wilma', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);
    mensRoot = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mensRoot.id, null);
    woman = await createPerson(db, { firstName: 'Winnie', network: 'WOMENS' });
    await assignTo(db, woman.id, womensRoot.id);
    man = await createPerson(db, { firstName: 'Manny', network: 'MENS' });
    await assignTo(db, man.id, mensRoot.id);

    womanLeader = await createAccount(app, db, { person: woman, roles: ['LEADER'] });
    manLeader = await createAccount(app, db, { person: man, roles: ['LEADER'] });

    networkAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['NETWORK_ADMIN'],
    });
    otherNetworkAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Olga', network: 'WOMENS' }),
      roles: ['NETWORK_ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const post = (account: TestAccount, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const code = (response: request.Response): string =>
    (response.body.error?.code ?? response.body.code) as string;

  /** A woman under the Women's root who leads a Cell, so a Leader account qualifies. */
  async function cellLeader(firstName: string, root: TestPerson): Promise<TestPerson> {
    const person = await createPerson(db, {
      firstName,
      network: root.id === womensRoot.id ? 'WOMENS' : 'MENS',
    });
    await assignTo(db, person.id, root.id);
    await createCell(db, { leader: person });
    return person;
  }

  describe('the list', () => {
    it('holds the Leader accounts of their Network and nobody else', async () => {
      const response = await get(networkAdmin, '/accounts').expect(200);

      expect((response.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
        woman.id,
      ]);
    });

    it('counts the same accounts', async () => {
      const response = await get(networkAdmin, '/accounts/counts').expect(200);

      expect(response.body).toMatchObject({ all: 1, active: 1, no_second_step: 0 });
    });

    it('still lists every account for the Admin', async () => {
      const response = await get(admin, '/accounts').expect(200);

      expect(response.body.data).toHaveLength(5);
    });

    it('leaves out a Leader account that also holds another role', async () => {
      await db
        .insertInto('account_roles')
        .values({ account_id: womanLeader.id, role: 'ADMIN', granted_by: admin.id })
        .execute();

      const response = await get(networkAdmin, '/accounts').expect(200);

      expect(response.body.data).toHaveLength(0);
    });

    it('leaves out their root’s Leader account, and touches it by no route', async () => {
      const rootAccount = await createAccount(app, db, { person: womensRoot, roles: ['LEADER'] });

      const list = await get(networkAdmin, '/accounts').expect(200);
      expect((list.body.data as { person_id: string }[]).map((row) => row.person_id)).toEqual([
        woman.id,
      ]);
      expect((await get(networkAdmin, '/accounts/counts')).body.all).toBe(1);

      for (const [path, body] of [
        [`/accounts/${rootAccount.id}/disable`, {}],
        [`/accounts/${rootAccount.id}/reactivate`, {}],
        [`/accounts/${rootAccount.id}/activation-email`, {}],
        [`/accounts/${rootAccount.id}/second-step/reset`, {}],
        [`/accounts/${rootAccount.id}/password-reset-email`, {}],
        [`/accounts/${rootAccount.id}/email`, { email: 'moved@example.test', restart: true }],
        [`/accounts/${rootAccount.id}/full-view`, { full_view: false }],
      ] as [string, Record<string, unknown>][]) {
        const response = await post(networkAdmin, path, body);

        expect(response.status).toBe(403);
        expect(code(response)).toBe('SCOPE_DENIED');
      }
    });

    it('is refused who opened a record, which is the Admin’s alone', async () => {
      expect((await get(networkAdmin, `/people/${woman.id}/views`)).status).toBe(403);
      expect((await get(admin, `/people/${woman.id}/views`)).status).toBe(200);
    });

    it('still refuses a malformed id on that route as a validation failure', async () => {
      const response = await get(admin, '/people/not-a-uuid/views');

      expect(response.status).toBe(422);
      expect(code(response)).toBe('VALIDATION_FAILED');
    });

    it('is refused to a Leader holding an explicit Network grant of the capability', async () => {
      await db
        .insertInto('capability_grants')
        .values({
          account_id: womanLeader.id,
          capability: 'accounts.manage',
          scope_type: 'NETWORK',
          scope_network: 'WOMENS',
          reason: 'A grant that covers nothing.',
          read_only: false,
          granted_by: admin.id,
        } as never)
        .execute();

      expect((await get(womanLeader, '/accounts')).status).toBe(403);
    });

    it('is still refused a Leader', async () => {
      expect((await get(womanLeader, '/accounts')).status).toBe(403);
      expect((await get(womanLeader, '/accounts/counts')).status).toBe(403);
    });
  });

  describe('giving an account', () => {
    it('gives a Leader account to a Cell Leader of their Network', async () => {
      const person = await cellLeader('Wanda', womensRoot);

      const response = await post(networkAdmin, '/accounts', {
        person_id: person.id,
        email: 'wanda@example.test',
        role: 'LEADER',
      });

      expect(response.status).toBe(201);
    });

    it('is refused any other role', async () => {
      const person = await cellLeader('Wanda', womensRoot);

      for (const role of ['ADMIN', 'SENIOR_PASTOR']) {
        const response = await post(networkAdmin, '/accounts', {
          person_id: person.id,
          email: 'wanda@example.test',
          role,
        });

        expect(response.status).toBe(403);
        expect(code(response)).toBe('SCOPE_DENIED');
      }
    });

    it('is refused a person of the other Network', async () => {
      const person = await cellLeader('Marco', mensRoot);

      const response = await post(networkAdmin, '/accounts', {
        person_id: person.id,
        email: 'marco@example.test',
        role: 'LEADER',
      });

      expect(response.status).toBe(403);
    });

    it('is refused their own Network’s root', async () => {
      await createCell(db, { leader: womensRoot });

      const response = await post(networkAdmin, '/accounts', {
        person_id: womensRoot.id,
        email: 'wilma@example.test',
        role: 'LEADER',
      });

      expect(response.status).toBe(403);
      expect(code(response)).toBe('SCOPE_DENIED');
    });
  });

  describe('reading one person’s account', () => {
    it('reads a Leader account of their Network', async () => {
      const response = await get(networkAdmin, `/accounts/for-person/${woman.id}`).expect(200);

      expect(response.body.account.id).toBe(womanLeader.id);
    });

    it('is refused the other Network, an administrator, their own and a root', async () => {
      for (const personId of [
        man.id,
        admin.personId,
        networkAdmin.personId,
        otherNetworkAdmin.personId,
        womensRoot.id,
      ]) {
        expect((await get(networkAdmin, `/accounts/for-person/${personId}`)).status).toBe(403);
      }
    });
  });

  describe('fixing an account', () => {
    const routes = (id: string): [string, Record<string, unknown>][] => [
      [`/accounts/${id}/password-reset-email`, {}],
      [`/accounts/${id}/disable`, {}],
      [`/accounts/${id}/reactivate`, {}],
      [`/accounts/${id}/activation-email`, {}],
      [`/accounts/${id}/email`, { email: 'moved@example.test', restart: true }],
      [`/accounts/${id}/second-step/reset`, {}],
    ];

    it('disables and re-enables a Leader account of their Network', async () => {
      const disabled = await post(networkAdmin, `/accounts/${womanLeader.id}/disable`);
      expect(disabled.status).toBe(200);
      expect(disabled.body.status).toBe('DISABLED');

      const enabled = await post(networkAdmin, `/accounts/${womanLeader.id}/reactivate`);
      expect(enabled.status).toBe(200);
    });

    it('sends a Leader of their Network a reset link', async () => {
      const response = await post(networkAdmin, `/accounts/${womanLeader.id}/password-reset-email`);

      expect(response.status).toBe(204);
    });

    it('starts a Leader account of their Network over at a new address', async () => {
      const response = await post(networkAdmin, `/accounts/${womanLeader.id}/email`, {
        email: 'winnie.moved@example.test',
        restart: true,
      });

      expect(response.status).toBe(200);
    });

    it('touches no account of the other Network', async () => {
      for (const [path, body] of routes(manLeader.id)) {
        expect((await post(networkAdmin, path, body)).status).toBe(403);
      }
    });

    it('touches no administrator’s account, another Network Admin’s or their own', async () => {
      for (const account of [admin, otherNetworkAdmin, networkAdmin]) {
        for (const [path, body] of routes(account.id)) {
          const response = await post(networkAdmin, path, body);

          expect(response.status).toBe(403);
          expect(code(response)).toBe('SCOPE_DENIED');
        }
      }

      const untouched = await db
        .selectFrom('accounts')
        .select(['id', 'status'])
        .where('id', 'in', [admin.id, otherNetworkAdmin.id, networkAdmin.id])
        .execute();
      expect(untouched.every((row) => row.status === 'ACTIVE')).toBe(true);
    });

    it('touches no Leader account that also holds another role', async () => {
      await db
        .insertInto('account_roles')
        .values({ account_id: womanLeader.id, role: 'ADMIN', granted_by: admin.id })
        .execute();

      const response = await post(networkAdmin, `/accounts/${womanLeader.id}/disable`);

      expect(response.status).toBe(403);
      expect(code(response)).toBe('SCOPE_DENIED');
    });
  });

  describe('the ticks', () => {
    const fullView = (actor: TestAccount, id: string, value: boolean) =>
      post(actor, `/accounts/${id}/full-view`, { full_view: value });

    it('ticks and clears Full view on a Leader account of their Network', async () => {
      const cleared = await fullView(networkAdmin, womanLeader.id, false);
      expect(cleared.status).toBe(200);
      expect(cleared.body.full_view).toBe(false);

      const ticked = await fullView(networkAdmin, womanLeader.id, true);
      expect(ticked.status).toBe(200);
      expect(ticked.body.full_view).toBe(true);
    });

    it('is refused Full view in the other Network', async () => {
      expect((await fullView(networkAdmin, manLeader.id, false)).status).toBe(403);
    });

    it('is refused Approves Cells and Moves people, on and off', async () => {
      for (const [path, field] of [
        ['approves-cells', 'approves_cells'],
        ['moves-people', 'moves_people'],
      ]) {
        for (const value of [true, false]) {
          const response = await post(networkAdmin, `/accounts/${womanLeader.id}/${path}`, {
            [field]: value,
          });

          expect(response.status).toBe(403);
          expect(code(response)).toBe('SCOPE_DENIED');
        }
      }
    });

    it('is refused clearing Full view while Approves Cells or Moves people is on', async () => {
      for (const [path, field] of [
        ['approves-cells', 'approves_cells'],
        ['moves-people', 'moves_people'],
      ] as const) {
        await post(admin, `/accounts/${womanLeader.id}/${path}`, { [field]: true }).expect(200);

        const response = await fullView(networkAdmin, womanLeader.id, false);
        expect(response.status).toBe(403);
        expect(code(response)).toBe('SCOPE_DENIED');

        const account = await db
          .selectFrom('accounts')
          .select(['full_view', 'approves_cells', 'moves_people'])
          .where('id', '=', womanLeader.id)
          .executeTakeFirstOrThrow();
        expect(account.full_view).toBe(true);
        expect(account[field]).toBe(true);

        await post(admin, `/accounts/${womanLeader.id}/${path}`, { [field]: false }).expect(200);
      }

      // Once the Admin has cleared both, Full view is theirs to clear again.
      expect((await fullView(networkAdmin, womanLeader.id, false)).status).toBe(200);
    });

    it('still lets the Admin clear Full view with the ticks on, clearing them', async () => {
      await post(admin, `/accounts/${womanLeader.id}/moves-people`, { moves_people: true }).expect(
        200,
      );

      expect((await fullView(admin, womanLeader.id, false)).status).toBe(200);

      const account = await db
        .selectFrom('accounts')
        .select(['full_view', 'moves_people'])
        .where('id', '=', womanLeader.id)
        .executeTakeFirstOrThrow();
      expect(account).toEqual({ full_view: false, moves_people: false });
    });
  });

  describe('the second step', () => {
    it('is reset by the Admin on a Network Admin’s account', async () => {
      const response = await post(admin, `/accounts/${networkAdmin.id}/second-step/reset`);

      expect(response.status).toBe(204);
    });
  });

  describe('what they are told they hold', () => {
    it('names the two account capabilities at their Network', async () => {
      const response = await get(networkAdmin, '/auth/me').expect(200);
      const held = (
        response.body.capabilities as {
          capability: string;
          scope_type: string;
          scope_network: string | null;
        }[]
      ).filter((grant) => ['accounts.manage', 'roles.manage'].includes(grant.capability));

      expect(held).toHaveLength(2);
      expect(
        held.every((grant) => grant.scope_type === 'NETWORK' && grant.scope_network === 'WOMENS'),
      ).toBe(true);
    });
  });
});
