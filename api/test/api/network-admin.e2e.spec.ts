import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { sql } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import {
  addCellMember,
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin, stage 1 (SKILL.md sections 7 and 20, decision 0469): the role, the one
 * form that gives it, reads of one Network, and what a Cell figure counts for a Network. Every
 * name is invented (CLAUDE.md, Secrets).
 */
describe('the Network Admin (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let woman: TestPerson;
  let man: TestPerson;
  let networkAdminPerson: TestPerson;
  let networkAdmin: TestAccount;

  const JUNE = '2026-06-01';

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

    networkAdminPerson = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });
    networkAdmin = await createAccount(app, db, {
      person: networkAdminPerson,
      roles: ['NETWORK_ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** The role is granted today, so a count that leaves them out is read for this month. */
  const thisMonth = async (): Promise<string> =>
    (
      await sql<{ month: string }>`
        SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Manila'), 'YYYY-MM-DD') AS month
      `.execute(db)
    ).rows[0].month;

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  const form = (overrides: Record<string, unknown> = {}) => ({
    first_name: 'Naomi',
    last_name: 'Fixtureson',
    birth_date_not_given: true,
    sex: 'FEMALE',
    civil_status: 'SINGLE',
    mobile_number_not_given: true,
    email: 'naomi@example.test',
    ...overrides,
  });

  const create = (account: TestAccount, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/accounts/network-admin')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  async function heldMeeting(cell: TestCell, attendee: string, submitter: string): Promise<void> {
    const meeting = await db
      .insertInto('cell_meetings')
      .values({
        cell_id: cell.id,
        scheduled_date: '2026-06-06',
        scheduled_time: '19:00',
        week_starting: '2026-06-01',
        reporting_month: JUNE,
        status: 'HELD',
        responsible_leader_id: cell.leaderId,
        submitted_by: submitter,
        submitted_at: new Date('2026-06-06T21:00:00+08:00'),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cell_attendance')
      .values({
        cell_meeting_id: meeting.id,
        person_id: attendee,
        present: true,
        recorded_by: submitter,
      })
      .execute();
  }

  describe('the one form', () => {
    it('creates a Person with no assignment and an account owing the second step', async () => {
      const response = await create(admin, form());

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ role: 'NETWORK_ADMIN', network: 'WOMENS' });
      const personId = response.body.person_id as string;

      const edges = await db
        .selectFrom('pastoral_assignments')
        .select('id')
        .where('person_id', '=', personId)
        .execute();
      expect(edges).toHaveLength(0);

      const roles = await db
        .selectFrom('account_roles')
        .select(['role', 'granted_by'])
        .where('account_id', '=', response.body.id as string)
        .execute();
      expect(roles).toEqual([{ role: 'NETWORK_ADMIN', granted_by: admin.id }]);
    });

    it('is the whole-church Admin only: a Network Admin is refused', async () => {
      const response = await create(networkAdmin, form());

      expect(response.status).toBe(403);
    });

    it('refuses an address another account holds', async () => {
      const response = await create(admin, form({ email: admin.email }));

      expect(response.status).toBe(409);
      expect(response.body.error?.code ?? response.body.code).toBe('INVARIANT_VIOLATION');
    });
  });

  describe('held alone', () => {
    it('is refused beside any other role, by the database', async () => {
      for (const role of ['LEADER', 'ADMIN'] as const) {
        await expect(
          db
            .insertInto('account_roles')
            .values({
              account_id: networkAdmin.id,
              role,
              senior_pastor_slot: null,
              granted_by: admin.id,
            })
            .execute(),
        ).rejects.toThrow(/account_roles_network_admin_not_with/);
      }
    });
  });

  describe('one Network, reads only', () => {
    it('reads a person of their Network and is refused the other', async () => {
      expect((await get(networkAdmin, `/people/${woman.id}`)).status).toBe(200);
      expect((await get(networkAdmin, `/people/${man.id}`)).status).toBe(403);
    });

    it('holds no write in this stage', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/people')
        .set('Authorization', `Bearer ${networkAdmin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          first_name: 'Added',
          last_name: 'Byher',
          birth_date_not_given: true,
          sex: 'FEMALE',
          civil_status: 'SINGLE',
          mobile_number_not_given: true,
          pastoral_leader_id: womensRoot.id,
        });

      expect(response.status).toBe(403);
    });

    it('is refused the church-wide directory', async () => {
      const response = await get(networkAdmin, '/people?church_wide=true&q=Manny');

      expect(response.status).toBe(403);
    });

    it('finds their Network and not the other when searching', async () => {
      const own = await get(networkAdmin, '/people?q=Winnie');
      const other = await get(networkAdmin, '/people?q=Manny');

      expect(own.status).toBe(200);
      expect(own.body.data).toHaveLength(1);
      expect(other.status).toBe(200);
      expect(other.body.data).toHaveLength(0);
    });
  });

  describe('outside the tree', () => {
    it('refuses them as somebody else’s pastoral leader', async () => {
      const response = await request(app.getHttpServer())
        .put(`/api/v1/people/${woman.id}/pastoral-leader`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ pastoral_leader_id: networkAdminPerson.id });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('Network Admin');
    });

    it('refuses them as a member of a Cell', async () => {
      const cell = await createCell(db, { leader: womensRoot });
      const response = await request(app.getHttpServer())
        .post(`/api/v1/cells/${cell.id}/members`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ person_id: networkAdminPerson.id });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('Network Admin');
    });

    it('leaves them out of the count of people', async () => {
      const response = await get(admin, `/reports/church-counts?period=${await thisMonth()}`);

      expect(response.status).toBe(200);
      // Wilma, Mario, Winnie and Manny; neither Ada nor Nora.
      expect(response.body.whole_church.people).toBe(4);
    });
  });

  describe('reports for one Network', () => {
    it('reads church-counts as their own Network', async () => {
      const response = await get(
        networkAdmin,
        `/reports/church-counts?period=${await thisMonth()}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.network).toBe('WOMENS');
      expect(response.body.whole_church.people).toBe(2);
      expect(response.body.tables).toHaveLength(1);
      expect(response.body.tables[0].network).toBe('WOMENS');
    });

    it('refuses a Leader church-counts as it always did', async () => {
      const leader = await createAccount(app, db, { person: woman, roles: ['LEADER'] });

      expect((await get(leader, `/reports/church-counts?period=${JUNE}`)).status).toBe(403);
    });

    it('is refused the whole church and the other Network, by selector', async () => {
      const church = await get(
        networkAdmin,
        `/reports/cells/monthly?period=${JUNE}&scope=WHOLE_CHURCH`,
      );
      const other = await get(
        networkAdmin,
        `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=MENS`,
      );

      expect(church.status).toBe(403);
      expect(other.status).toBe(403);
    });

    it('counts a Cell figure by the Cell’s Network, and its buckets reconcile', async () => {
      const longAgo = new Date('2024-01-03T12:00:00+08:00');
      const womensCell = await createCell(db, { leader: womensRoot, createdAt: longAgo });
      const mensCell = await createCell(db, { leader: mensRoot, createdAt: longAgo });
      const womensMember = await addCellMember(db, womensCell, { from: longAgo });
      const mensMember = await addCellMember(db, mensCell, { from: longAgo });
      await heldMeeting(womensCell, womensMember.id, admin.id);
      await heldMeeting(mensCell, mensMember.id, admin.id);

      const womens = await get(
        networkAdmin,
        `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=WOMENS`,
      );
      const mens = await get(
        admin,
        `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=MENS`,
      );
      const church = await get(admin, `/reports/cells/monthly?period=${JUNE}&scope=WHOLE_CHURCH`);

      expect(womens.status).toBe(200);
      expect(womens.body.unique_people).toBe(1);
      expect(mens.body.unique_people).toBe(1);
      expect(church.body.unique_people).toBe(2);

      // SKILL.md section 20: the classification buckets sum to the scope's unique people.
      const sum = (classification: Record<string, number>) =>
        Object.values(classification).reduce((total, count) => total + count, 0);
      expect(sum(womens.body.classification)).toBe(womens.body.unique_people);
      expect(sum(church.body.classification)).toBe(church.body.unique_people);
    });

    it('lets Men’s and Women’s exceed Whole Church when somebody’s Network changed that month', async () => {
      const longAgo = new Date('2024-01-03T12:00:00+08:00');
      const womensCell = await createCell(db, { leader: womensRoot, createdAt: longAgo });
      const mensCell = await createCell(db, { leader: mensRoot, createdAt: longAgo });
      const person = await addCellMember(db, womensCell, { from: longAgo });
      await heldMeeting(womensCell, person.id, admin.id);
      await heldMeeting(mensCell, person.id, admin.id);

      const count = async (network: string) =>
        (await get(admin, `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=${network}`))
          .body.unique_people as number;
      const church = await get(admin, `/reports/cells/monthly?period=${JUNE}&scope=WHOLE_CHURCH`);

      expect((await count('WOMENS')) + (await count('MENS'))).toBe(2);
      expect(church.body.unique_people).toBe(1);
    });
  });

  describe('a correction of their sex', () => {
    it('moves their Network and ends their sessions', async () => {
      const response = await request(app.getHttpServer())
        .put(`/api/v1/people/${networkAdminPerson.id}/sex`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ sex: 'MALE', reason: 'Sex entered in error at encoding.' });

      expect(response.status).toBe(200);

      const account = await db
        .selectFrom('accounts')
        .select('sessions_revoked_at')
        .where('id', '=', networkAdmin.id)
        .executeTakeFirstOrThrow();
      expect(account.sessions_revoked_at).not.toBeNull();
    });
  });
});
