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
  createRequestMembers,
  createTestApp,
} from '../setup/fixtures';
import { TokensService } from '../../src/auth/tokens.service';
import { PeopleImportService } from '../../src/people/people.import.service';

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
    it('creates a Person with no assignment and an account', async () => {
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
      for (const role of ['LEADER', 'ADMIN', 'SENIOR_PASTOR'] as const) {
        await expect(
          db
            .insertInto('account_roles')
            .values({
              account_id: networkAdmin.id,
              role,
              senior_pastor_slot: role === 'SENIOR_PASTOR' ? 1 : null,
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

    it('holds no attendance or Growth write yet', async () => {
      const me = await get(networkAdmin, '/auth/me');
      const held = (me.body.capabilities as { capability: string }[]).map(
        (grant) => grant.capability,
      );

      expect(
        held.filter(
          (capability) =>
            !capability.endsWith('.view_subtree') &&
            !capability.startsWith('people.') &&
            !capability.startsWith('cell.') &&
            !['accounts.manage', 'roles.manage'].includes(capability),
        ),
      ).toEqual([]);
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

    it('lets Men’s and Women’s exceed Whole Church for somebody counted in both', async () => {
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

  const put = (account: TestAccount, path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const post = (account: TestAccount, path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  describe('the form, further', () => {
    it('owes the second step and the seven-day session', async () => {
      const made = await create(admin, form());
      const account = await get(admin, `/accounts/for-person/${made.body.person_id as string}`);

      expect(account.body.account.second_step.required).toBe(true);
      expect(await app.get(TokensService).sessionDaysFor(made.body.id as string)).toBe(7);
    });

    it('audits the person with what the form wrote, the account and the role', async () => {
      const made = await create(
        admin,
        form({ mobile_number_not_given: undefined, mobile_number: '0917-000-0001', title: 'Dr' }),
      );
      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'after'])
        .where('target_id', 'in', [made.body.person_id as string, made.body.id as string])
        .execute();
      const actions = entries.map((entry) => entry.action);

      expect(actions).toEqual(
        expect.arrayContaining(['person.created', 'account.created', 'role.granted']),
      );
      const person = entries.find((entry) => entry.action === 'person.created');
      expect(person?.after).toMatchObject({ title: 'Dr', mobile_number: '0917-000-0001' });
    });

    it('asks about a Tier 1 duplicate, and adds once it is acknowledged', async () => {
      const details = {
        first_name: 'Twin',
        last_name: 'Sameperson',
        birth_date_not_given: undefined,
        birth_date: '1990-01-02',
      };
      expect((await create(admin, form(details))).status).toBe(201);

      const again = await create(admin, form({ ...details, email: 'twin@example.test' }));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('DUPLICATE_ACKNOWLEDGEMENT_REQUIRED');

      const ids = (again.body.error.details.candidates as { id: string }[]).map((each) => each.id);
      const acknowledged = await create(
        admin,
        form({ ...details, email: 'twin@example.test', acknowledged_duplicate_ids: ids }),
      );
      expect(acknowledged.status).toBe(201);
    });

    it('replays a retry rather than creating a second account', async () => {
      const key = randomUUID();
      const send = () =>
        request(app.getHttpServer())
          .post('/api/v1/accounts/network-admin')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('Idempotency-Key', key)
          .send(form());

      const first = await send();
      const second = await send();

      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      const rows = await db
        .selectFrom('accounts')
        .select('id')
        .where('email_normalized', '=', 'naomi@example.test')
        .execute();
      expect(rows).toHaveLength(1);
    });
  });

  describe('outside the tree, further', () => {
    it('refuses to move them as the subject', async () => {
      const response = await put(admin, `/people/${networkAdminPerson.id}/pastoral-leader`, {
        pastoral_leader_id: womensRoot.id,
      });

      expect(response.status).toBe(409);
    });

    it('refuses them as the leader of somebody added', async () => {
      const response = await post(admin, '/people', {
        first_name: 'Added',
        last_name: 'Undernora',
        birth_date_not_given: true,
        sex: 'FEMALE',
        civil_status: 'SINGLE',
        mobile_number_not_given: true,
        pastoral_leader_id: networkAdminPerson.id,
      });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('Network Admin');
    });

    it('refuses them as the new leader named in a sex correction', async () => {
      const response = await put(admin, `/people/${man.id}/sex`, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: networkAdminPerson.id,
      });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toContain('Network Admin');
    });

    it('refuses them as a member named on a new-Cell request, saying nothing of the role', async () => {
      const prospective = await createPerson(db, { firstName: 'Prospect', network: 'WOMENS' });
      await assignTo(db, prospective.id, womensRoot.id);
      const requester = await createAccount(app, db, { person: womensRoot, roles: ['LEADER'] });
      const members = await createRequestMembers(db, 'WOMENS', { under: womensRoot.id });

      const response = await post(requester, '/cells/leadership-requests', {
        kind: 'NEW_CELL',
        prospective_leader_id: prospective.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '19:00',
        members: [networkAdminPerson.id, members.ids[0], members.ids[1]],
      });

      // Nobody's subtree holds them, so the requester's own scope refuses first.
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('Network Admin');
    });
  });

  describe('reports for one Network, further', () => {
    async function twoNetworks(): Promise<void> {
      const longAgo = new Date('2024-01-03T12:00:00+08:00');
      const womensCell = await createCell(db, { leader: womensRoot, createdAt: longAgo });
      const mensCell = await createCell(db, { leader: mensRoot, createdAt: longAgo });
      const womensMember = await addCellMember(db, womensCell, { from: longAgo });
      const mensMember = await addCellMember(db, mensCell, { from: longAgo });
      await heldMeeting(womensCell, womensMember.id, admin.id);
      await heldMeeting(mensCell, mensMember.id, admin.id);
    }

    it('narrows cells/twelve to their Network', async () => {
      await twoNetworks();
      const response = await get(
        networkAdmin,
        `/reports/cells/twelve?kind=MONTH&start=${JUNE}&period=${JUNE}&scope=NETWORK&network=WOMENS`,
      );
      const church = await get(
        admin,
        `/reports/cells/twelve?kind=MONTH&start=${JUNE}&period=${JUNE}&scope=WHOLE_CHURCH`,
      );

      expect(response.status).toBe(200);
      expect(response.body.total.unique_people).toBe(1);
      expect(church.body.total.unique_people).toBe(2);
      expect(response.body.coverage.scheduled).toBeLessThan(church.body.coverage.scheduled);
    });

    it('splits coverage by the Cell’s Network, the two adding up to the church', async () => {
      await twoNetworks();
      const coverage = async (query: string) =>
        (await get(admin, `/reports/cells/monthly?period=${JUNE}&${query}`)).body.coverage as {
          scheduled: number;
          recorded: number;
        };

      const womens = await coverage('scope=NETWORK&network=WOMENS');
      const mens = await coverage('scope=NETWORK&network=MENS');
      const church = await coverage('scope=WHOLE_CHURCH');

      expect(womens.scheduled).toBeGreaterThan(0);
      expect(womens.scheduled + mens.scheduled).toBe(church.scheduled);
      expect(womens.recorded + mens.recorded).toBe(church.recorded);
    });

    it('counts a meeting by its leader’s Network on its date, not now', async () => {
      const longAgo = new Date('2024-01-03T12:00:00+08:00');
      const womensCell = await createCell(db, { leader: womensRoot, createdAt: longAgo });
      const attendee = await addCellMember(db, womensCell, { from: longAgo });
      // A responsible leader in the Women's Network on 6 June and the Men's from the 15th.
      const moved = await createPerson(db, { firstName: 'Moved', network: 'WOMENS' });
      const changedAt = new Date('2026-06-15T12:00:00+08:00');
      await db
        .updateTable('network_assignments')
        .set({ ended_at: changedAt })
        .where('person_id', '=', moved.id)
        .execute();
      await db
        .insertInto('network_assignments')
        .values({ person_id: moved.id, network: 'MENS', started_at: changedAt } as never)
        .execute();
      await heldMeeting({ ...womensCell, leaderId: moved.id }, attendee.id, admin.id);

      const count = async (network: string) =>
        (await get(admin, `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=${network}`))
          .body.unique_people as number;

      expect(await count('WOMENS')).toBe(1);
      expect(await count('MENS')).toBe(0);
    });

    it('trends a leader of their Network and refuses one of the other', async () => {
      expect(
        (await get(networkAdmin, `/reports/trends?figure=CELLS&leader_id=${woman.id}`)).status,
      ).toBe(200);
      expect(
        (await get(networkAdmin, `/reports/trends?figure=CELLS&leader_id=${man.id}`)).status,
      ).toBe(403);
    });

    it('trends their Network, named', async () => {
      const response = await get(networkAdmin, '/reports/trends?figure=PEOPLE');

      expect(response.status).toBe(200);
      expect(response.body.lines[0].network).toBe('WOMENS');
    });

    it('keeps the DCC refusal of rows under a Network scope', async () => {
      const response = await get(
        admin,
        `/reports/dcc/twelve?kind=MONTH&start=${JUNE}&period=${JUNE}&scope=NETWORK&network=WOMENS&rows=ROOT_LEADERS`,
      );

      expect(response.status).toBe(422);
    });
  });

  describe('a correction of their sex, further', () => {
    it('moves their Network, refuses the old token, and leaves a Leader’s sessions alone', async () => {
      const leader = await createAccount(app, db, { person: woman, roles: ['LEADER'] });
      await put(admin, `/people/${networkAdminPerson.id}/sex`, {
        sex: 'MALE',
        reason: 'Sex entered in error at encoding.',
      }).expect(200);

      const network = await db
        .selectFrom('network_assignments')
        .select('network')
        .where('person_id', '=', networkAdminPerson.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(network.network).toBe('MENS');
      expect((await get(networkAdmin, '/auth/me')).status).toBe(401);

      await put(admin, `/people/${man.id}/sex`, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: womensRoot.id,
      }).expect(200);
      expect((await get(leader, '/auth/me')).status).toBe(200);
    });
  });

  describe('every other path into the tree or a Cell', () => {
    const REFUSED = /Network Admin|cannot belong to a Cell/;

    it('refuses them as the leader of a Cell created directly', async () => {
      const response = await post(admin, '/cells', {
        cell_leader_id: networkAdminPerson.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '19:00',
      });

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toMatch(REFUSED);
    });

    it('refuses them as a leader named by the tree import', async () => {
      await expect(
        db.transaction().execute((trx) =>
          app.get(PeopleImportService).createForImportWithin(
            trx,
            {
              firstName: 'Imported',
              middleName: null,
              lastName: 'Undernora',
              birthDate: null,
              sex: 'FEMALE',
              civilStatus: 'SINGLE',
              placement: { kind: 'UNDER', pastoralLeaderId: networkAdminPerson.id },
              encodedAt: new Date(),
            },
            { accountId: admin.id },
            randomUUID(),
          ),
        ),
      ).rejects.toThrow(REFUSED);
    });

    it('refuses to place them through the tree import', async () => {
      const row = await db
        .selectFrom('persons')
        .select('member_id')
        .where('id', '=', networkAdminPerson.id)
        .executeTakeFirstOrThrow();

      await expect(
        db.transaction().execute((trx) =>
          app.get(PeopleImportService).attachExistingWithin(
            trx,
            {
              personId: networkAdminPerson.id,
              memberId: row.member_id,
              placement: { kind: 'UNDER', pastoralLeaderId: womensRoot.id },
              encodedAt: new Date(),
            },
            { accountId: admin.id },
            randomUUID(),
          ),
        ),
      ).rejects.toThrow(REFUSED);
    });

    async function pendingRequest(prospective: string, members: string[]): Promise<string> {
      const requester = await createAccount(app, db, { person: womensRoot, roles: ['LEADER'] });
      return db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto('cell_leadership_requests')
          .values({
            kind: 'NEW_CELL',
            prospective_leader_id: prospective,
            requested_by: requester.id,
            category: 'YOUTH',
            day_of_week: 6,
            time_of_day: '19:00',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (members.length > 0) {
          await trx
            .insertInto('cell_leadership_request_members')
            .values(members.map((person_id) => ({ request_id: row.id, person_id })))
            .execute();
        }
        return row.id;
      });
    }

    it('refuses to approve a request naming them as the new leader', async () => {
      const id = await pendingRequest(networkAdminPerson.id, []);
      const response = await post(admin, `/cells/leadership-requests/${id}/approve`, {});

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toMatch(REFUSED);
    });

    it('refuses to approve a request naming them as a member, naming the line and no role', async () => {
      const prospective = await createPerson(db, { firstName: 'Prospect', network: 'WOMENS' });
      await assignTo(db, prospective.id, womensRoot.id);
      const members = await createRequestMembers(db, 'WOMENS', { under: womensRoot.id });
      const id = await pendingRequest(prospective.id, [
        networkAdminPerson.id,
        members.ids[0],
        members.ids[1],
      ]);
      // Reached only by a requester whose scope holds them, which a Whole Church grant does.
      const { requested_by: requester } = await db
        .selectFrom('cell_leadership_requests')
        .select('requested_by')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      await db
        .insertInto('capability_grants')
        .values({
          account_id: requester,
          capability: 'cell.request_leadership',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      const response = await post(admin, `/cells/leadership-requests/${id}/approve`, {});

      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('cannot belong to a Cell');
      expect(response.body.error.details.field).toBe('members');
      expect(JSON.stringify(response.body)).not.toContain('Network Admin');
    });
  });

  describe('coverage on a leader’s own date', () => {
    it('places each scheduled meeting by its leader’s Network on that date', async () => {
      const longAgo = new Date('2024-01-03T12:00:00+08:00');
      const leader = await createPerson(db, { firstName: 'Shifted', network: 'WOMENS' });
      // Saturdays: 6 and 13 June in the Women's Network, 20 and 27 in the Men's. A member makes
      // each one due.
      const cell = await createCell(db, { leader, createdAt: longAgo, dayOfWeek: 6 });
      await addCellMember(db, cell, { from: longAgo });
      const changedAt = new Date('2026-06-15T12:00:00+08:00');
      await db
        .updateTable('network_assignments')
        .set({ ended_at: changedAt })
        .where('person_id', '=', leader.id)
        .execute();
      await db
        .insertInto('network_assignments')
        .values({ person_id: leader.id, network: 'MENS', started_at: changedAt } as never)
        .execute();

      const scheduled = async (network: string) =>
        (await get(admin, `/reports/cells/monthly?period=${JUNE}&scope=NETWORK&network=${network}`))
          .body.coverage.scheduled as number;

      expect(await scheduled('WOMENS')).toBe(2);
      expect(await scheduled('MENS')).toBe(2);
    });
  });
});
