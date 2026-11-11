import { randomUUID } from 'node:crypto';

import request from 'supertest';

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

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * The Network Admin's Cell powers and their limits (SKILL.md sections 7 and 10, decision
 * 0469, point 4): deciding requests, members, schedule and category, and closing, in their
 * own Network. Direct creation, *Created in error* and backdating stay the Admin's. Every
 * name is invented (CLAUDE.md, Secrets).
 *
 * The tree: Wilma (Women's root) -> Wanda (Leader account, a Cell) -> Winnie, and Wilma ->
 * Wendy (a Cell). Mario (Men's root) -> Manny (Leader account, a Cell) -> Milo.
 */
describe('the Network Admin’s Cells (decision 0469)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let networkAdmin: TestAccount;
  let womensRoot: TestPerson;
  let mensRoot: TestPerson;
  let wanda: TestPerson;
  let wandaAccount: TestAccount;
  let wandaCell: TestCell;
  let wendy: TestPerson;
  let wendyCell: TestCell;
  let winnie: TestPerson;
  let manny: TestPerson;
  let mannyAccount: TestAccount;
  let mannyCell: TestCell;
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
    wandaCell = await createCell(db, { leader: wanda, dayOfWeek: 3 });
    wandaAccount = await createAccount(app, db, { person: wanda, roles: ['LEADER'] });
    wendy = await createPerson(db, { firstName: 'Wendy', network: 'WOMENS' });
    await assignTo(db, wendy.id, womensRoot.id);
    wendyCell = await createCell(db, { leader: wendy, dayOfWeek: 4 });
    winnie = await createPerson(db, { firstName: 'Winnie', network: 'WOMENS' });
    await assignTo(db, winnie.id, wanda.id);

    manny = await createPerson(db, { firstName: 'Manny', network: 'MENS' });
    await assignTo(db, manny.id, mensRoot.id);
    mannyCell = await createCell(db, { leader: manny, dayOfWeek: 2 });
    mannyAccount = await createAccount(app, db, { person: manny, roles: ['LEADER'] });
    milo = await createPerson(db, { firstName: 'Milo', network: 'MENS' });
    await assignTo(db, milo.id, manny.id);

    networkAdmin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Nora', network: 'WOMENS' }),
      roles: ['NETWORK_ADMIN'],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const send = (
    method: 'post' | 'put' | 'delete',
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

  const refused = (response: request.Response): [number, string] => [
    response.status,
    code(response),
  ];

  const newCell = async (
    sender: TestAccount,
    leader: TestPerson,
    network: 'MENS' | 'WOMENS',
  ): Promise<string> => {
    const members = (await createRequestMembers(db, network, { under: leader.id })).ids;
    const response = await send('post', sender, '/cells/leadership-requests', {
      kind: 'NEW_CELL',
      prospective_leader_id: leader.id,
      category: 'YOUTH',
      day_of_week: 6,
      time_of_day: '16:00',
      members,
    });
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    return response.body.id as string;
  };

  const stateOf = async (requestId: string): Promise<string> =>
    (
      await db
        .selectFrom('cell_leadership_requests')
        .select('state')
        .where('id', '=', requestId)
        .executeTakeFirstOrThrow()
    ).state;

  const cellOf = async (personId: string): Promise<string | null> =>
    (
      await db
        .selectFrom('cell_memberships')
        .select('cell_id')
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirst()
    )?.cell_id ?? null;

  describe('deciding requests', () => {
    it('approves a new Cell of their Network', async () => {
      const id = await newCell(wandaAccount, winnie, 'WOMENS');

      const response = await send('post', networkAdmin, `/cells/leadership-requests/${id}/approve`);

      expect(response.status).toBe(200);
      expect(await stateOf(id)).toBe('APPROVED');
    });

    it('declines one', async () => {
      const id = await newCell(wandaAccount, winnie, 'WOMENS');

      const response = await send(
        'post',
        networkAdmin,
        `/cells/leadership-requests/${id}/decline`,
        { reason: 'TIMING_DEFERRED' },
      );

      expect(response.status).toBe(200);
      expect(await stateOf(id)).toBe('DECLINED');
    });

    it('decides nothing of the other Network, and does not see it queued', async () => {
      const own = await newCell(wandaAccount, winnie, 'WOMENS');
      const other = await newCell(mannyAccount, milo, 'MENS');

      const approve = await send(
        'post',
        networkAdmin,
        `/cells/leadership-requests/${other}/approve`,
      );
      const decline = await send(
        'post',
        networkAdmin,
        `/cells/leadership-requests/${other}/decline`,
        { reason: 'TIMING_DEFERRED' },
      );
      const queue = await get(networkAdmin, '/cells/leadership-requests').expect(200);

      expect(refused(approve)).toEqual([403, 'SCOPE_DENIED']);
      expect(refused(decline)).toEqual([403, 'SCOPE_DENIED']);
      expect(await stateOf(other)).toBe('PENDING');
      expect((queue.body.data as { id: string }[]).map((row) => row.id)).toEqual([own]);
    });

    it('sends no request of their own', async () => {
      const members = (await createRequestMembers(db, 'WOMENS', { under: winnie.id })).ids;

      const response = await send('post', networkAdmin, '/cells/leadership-requests', {
        kind: 'NEW_CELL',
        prospective_leader_id: winnie.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '16:00',
        members,
      });

      expect(refused(response)).toEqual([403, 'CAPABILITY_DENIED']);
    });

    it('creates no Cell directly', async () => {
      const response = await send('post', networkAdmin, '/cells', {
        cell_leader_id: winnie.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '19:00',
      });

      expect(response.status).toBe(403);
      expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(3);
    });
  });

  describe('members', () => {
    it('adds somebody in no Cell to a Cell of their Network', async () => {
      const response = await send('post', networkAdmin, `/cells/${wandaCell.id}/members`, {
        person_id: winnie.id,
      });

      expect(response.status).toBe(201);
      expect(await cellOf(winnie.id)).toBe(wandaCell.id);
    });

    it('moves a member between two Cells of their Network, across branches', async () => {
      const member = await addCellMember(db, { id: wandaCell.id, leaderId: wanda.id });

      const response = await send('post', networkAdmin, `/cells/${wendyCell.id}/members`, {
        person_id: member.id,
      });

      expect(response.status).toBe(201);
      expect(await cellOf(member.id)).toBe(wendyCell.id);
    });

    it('removes a member', async () => {
      const member = await addCellMember(db, { id: wandaCell.id, leaderId: wanda.id });

      const response = await send(
        'delete',
        networkAdmin,
        `/cells/${wandaCell.id}/members/${member.id}`,
      );

      expect(response.status).toBeLessThan(300);
      expect(await cellOf(member.id)).toBeNull();
    });

    it('touches no Cell of the other Network', async () => {
      const member = await addCellMember(db, { id: mannyCell.id, leaderId: manny.id });

      const add = await send('post', networkAdmin, `/cells/${mannyCell.id}/members`, {
        person_id: milo.id,
      });
      const remove = await send(
        'delete',
        networkAdmin,
        `/cells/${mannyCell.id}/members/${member.id}`,
      );

      expect(refused(add)).toEqual([403, 'SCOPE_DENIED']);
      expect(refused(remove)).toEqual([403, 'SCOPE_DENIED']);
    });

    it('says the same of anybody of the other Network, whatever they hold', async () => {
      const add = (personId: string) =>
        send('post', networkAdmin, `/cells/${wandaCell.id}/members`, { person_id: personId });
      const remove = (personId: string) =>
        send('delete', networkAdmin, `/cells/${wandaCell.id}/members/${personId}`);

      const otherAdmin = await createPerson(db, { firstName: 'Omar', network: 'MENS' });
      await assignTo(db, otherAdmin.id, manny.id);
      await createAccount(app, db, { person: otherAdmin, roles: ['ADMIN'] });

      const ordinary = await add(milo.id);
      expect(ordinary.status).toBe(403);
      const ordinaryGone = await remove(milo.id);

      for (const held of [mensRoot, otherAdmin]) {
        const added = await add(held.id);
        expect([held.firstName, added.status, added.body.error]).toEqual([
          held.firstName,
          ordinary.status,
          ordinary.body.error,
        ]);

        const gone = await remove(held.id);
        expect([held.firstName, gone.status, gone.body.error]).toEqual([
          held.firstName,
          ordinaryGone.status,
          ordinaryGone.body.error,
        ]);
      }
    });

    it('adds and removes no administrator placed in the tree', async () => {
      const adminInTree = await createPerson(db, { firstName: 'Abby', network: 'WOMENS' });
      await assignTo(db, adminInTree.id, wanda.id);
      await createAccount(app, db, { person: adminInTree, roles: ['ADMIN'] });

      const add = await send('post', networkAdmin, `/cells/${wandaCell.id}/members`, {
        person_id: adminInTree.id,
      });
      expect(refused(add)).toEqual([403, 'SCOPE_DENIED']);

      expect(
        (await send('post', admin, `/cells/${wandaCell.id}/members`, { person_id: adminInTree.id }))
          .status,
      ).toBe(201);
      const remove = await send(
        'delete',
        networkAdmin,
        `/cells/${wandaCell.id}/members/${adminInTree.id}`,
      );
      expect(refused(remove)).toEqual([403, 'SCOPE_DENIED']);
      expect(await cellOf(adminInTree.id)).toBe(wandaCell.id);
    });
  });

  describe('schedule and category', () => {
    it('changes both on a Cell of their Network', async () => {
      const category = await send('put', networkAdmin, `/cells/${wandaCell.id}/category`, {
        category: 'YOUNG_PRO',
      });
      const schedule = await send('put', networkAdmin, `/cells/${wandaCell.id}/schedule`, {
        day_of_week: 5,
        time_of_day: '18:30',
      });

      expect([category.status, schedule.status]).toEqual([200, 200]);
    });

    it('changes neither on a Cell of the other Network', async () => {
      const category = await send('put', networkAdmin, `/cells/${mannyCell.id}/category`, {
        category: 'YOUNG_PRO',
      });
      const schedule = await send('put', networkAdmin, `/cells/${mannyCell.id}/schedule`, {
        day_of_week: 5,
        time_of_day: '18:30',
      });

      expect(refused(category)).toEqual([403, 'SCOPE_DENIED']);
      expect(refused(schedule)).toEqual([403, 'SCOPE_DENIED']);
    });

    it('reads the time clashes of their Network alone', async () => {
      // A second Cell for each leader at their first one's day and time.
      await createCell(db, { leader: wanda, dayOfWeek: 3 });
      await createCell(db, { leader: manny, dayOfWeek: 2 });

      const own = await get(networkAdmin, '/cells/schedule-clashes').expect(200);
      const all = await get(admin, '/cells/schedule-clashes').expect(200);

      expect(
        (own.body.data as { leader: { person_id: string } }[]).map((row) => row.leader.person_id),
      ).toEqual([wanda.id]);
      expect(all.body.data).toHaveLength(2);
    });

    it('still refuses a Leader the time clashes', async () => {
      const response = await get(wandaAccount, '/cells/schedule-clashes');

      expect(refused(response)).toEqual([403, 'SCOPE_DENIED']);
    });
  });

  describe('closing', () => {
    const close = (account: TestAccount, cell: TestCell, body: Record<string, unknown> = {}) =>
      send('post', account, `/cells/${cell.id}/closure`, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'Invented for this case.',
        members: [],
        ...body,
      });

    const stateOfCell = async (cell: TestCell): Promise<string> =>
      (
        await db
          .selectFrom('cells')
          .select('state')
          .where('id', '=', cell.id)
          .executeTakeFirstOrThrow()
      ).state;

    it('closes a Cell of their Network, moving a member to another', async () => {
      const member = await addCellMember(db, { id: wandaCell.id, leaderId: wanda.id });

      const response = await close(networkAdmin, wandaCell, {
        members: [{ person_id: member.id, destination_cell_id: wendyCell.id }],
      });

      expect(response.status).toBe(200);
      expect(await stateOfCell(wandaCell)).toBe('CLOSED');
      expect(await cellOf(member.id)).toBe(wendyCell.id);
    });

    it('closes none as created in error', async () => {
      const response = await close(networkAdmin, wandaCell, { reason: 'CREATED_IN_ERROR' });

      expect(refused(response)).toEqual([403, 'CAPABILITY_DENIED']);
      expect(await stateOfCell(wandaCell)).toBe('ACTIVE');
    });

    it('backdates no closure', async () => {
      const response = await close(networkAdmin, wandaCell, {
        effective_date: '2026-01-05',
      });

      expect(response.status).toBe(403);
      expect(await stateOfCell(wandaCell)).toBe('ACTIVE');
    });

    it('closes no Cell of the other Network', async () => {
      const response = await close(networkAdmin, mannyCell);

      expect(refused(response)).toEqual([403, 'SCOPE_DENIED']);
      expect(await stateOfCell(mannyCell)).toBe('ACTIVE');
    });

    it('moves no member into a Cell of the other Network', async () => {
      const member = await addCellMember(db, { id: wandaCell.id, leaderId: wanda.id });

      const response = await close(networkAdmin, wandaCell, {
        members: [{ person_id: member.id, destination_cell_id: mannyCell.id }],
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await stateOfCell(wandaCell)).toBe('ACTIVE');
    });

    it('still refuses a Leader their own Cell, and lets the Admin close', async () => {
      const leader = await close(wandaAccount, wandaCell);
      expect(refused(leader)).toEqual([403, 'SCOPE_DENIED']);
      expect(await stateOfCell(wandaCell)).toBe('ACTIVE');

      expect((await close(admin, wandaCell)).status).toBe(200);
    });

    it('answers a Leader the same for a Cell that does not exist', async () => {
      const response = await send('post', wandaAccount, `/cells/${randomUUID()}/closure`, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'Invented for this case.',
        members: [],
      });

      expect(refused(response)).toEqual([403, 'SCOPE_DENIED']);
    });
  });

  it('holds the Cell powers and Cell recording across its Network, and no request', async () => {
    const me = await get(networkAdmin, '/auth/me').expect(200);
    const held = (me.body.capabilities as { capability: string; scope_type: string }[])
      .filter((grant) => grant.capability.startsWith('cell.'))
      .map((grant) => `${grant.capability}@${grant.scope_type}`)
      .sort();

    expect(held).toEqual([
      'cell.approve_leadership@NETWORK',
      'cell.correct_subtree@NETWORK',
      'cell.manage_configuration@NETWORK',
      'cell.manage_leadership@NETWORK',
      'cell.manage_lifecycle@NETWORK',
      'cell.manage_membership@NETWORK',
      'cell.move_members@NETWORK',
      'cell.submit_on_behalf@NETWORK',
      'cell.take_attendance@NETWORK',
      'cell.view_subtree@NETWORK',
    ]);
  });
});
