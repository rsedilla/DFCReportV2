import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createRequestMembers,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * Approves Cells (SKILL.md section 7, section 10, decision 0352) and the three members a
 * new Cell starts with (section 10, section 15, decision 0353), pinned at the API as each
 * ruling's "What the build's tests must show" asks.
 *
 * The tree is the example one, `Raymond -> Manuel -> Mark` (CLAUDE.md), under the Men's
 * root:
 *
 * ```text
 * Oriel (root, ADMIN account "adminA")
 * ├── Raymond   (LEADER, ticked Approves Cells, leads a Cell)
 * │   └── Manuel   (LEADER, leads a Cell)        <- Raymond's direct disciple
 * │       ├── Mark                               <- in Raymond's branch, not direct
 * │       │   └── Juan
 * │       └── Nestor (ADMIN account)
 * └── Ben       (LEADER, not ticked, leads a Cell)
 *     └── Pedro
 * Ester (Women's, outside the tree, ADMIN account "adminB")
 * ```
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Approves Cells and a new Cell’s three members (decisions 0352, 0353)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let root: TestPerson;
  let adminA: TestAccount;
  let adminB: TestAccount;
  let raymond: TestPerson;
  let raymondAccount: TestAccount;
  let raymondCell: TestCell;
  let manuel: TestPerson;
  let manuelAccount: TestAccount;
  let manuelCell: TestCell;
  let mark: TestPerson;
  let juan: TestPerson;
  let ben: TestPerson;
  let benAccount: TestAccount;
  let benCell: TestCell;
  let pedro: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    nameSeniorPastors(app, []);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    adminA = await createAccount(app, db, { person: root, roles: ['ADMIN'] });

    adminB = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, root.id);
    // On a Wednesday, so handing it to somebody also taking a Saturday Cell is no clash
    // (decision 0392).
    raymondCell = await createCell(db, { leader: raymond, dayOfWeek: 3 });
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
    await tick(raymondAccount, true);

    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    manuelCell = await createCell(db, { leader: manuel });
    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });
    benAccount = await createAccount(app, db, { person: ben, roles: ['LEADER'] });

    pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, ben.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** Sets the tick in the database, for fixtures; the route is pinned on its own below. */
  async function tick(account: TestAccount, value: boolean): Promise<void> {
    await db
      .updateTable('accounts')
      .set({ approves_cells: value })
      .where('id', '=', account.id)
      .execute();
  }

  const http = () => request(app.getHttpServer());

  const submit = (actor: TestAccount, body: Record<string, unknown>) =>
    http()
      .post('/api/v1/cells/leadership-requests')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const approve = (actor: TestAccount, requestId: string) =>
    http()
      .post(`/api/v1/cells/leadership-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({});

  const decline = (actor: TestAccount, requestId: string) =>
    http()
      .post(`/api/v1/cells/leadership-requests/${requestId}/decline`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'TIMING_DEFERRED' });

  const queue = (actor: TestAccount, query = '') =>
    http()
      .get(`/api/v1/cells/leadership-requests${query}`)
      .set('Authorization', `Bearer ${actor.accessToken}`);

  const setApprovesCells = (actor: TestAccount, accountId: string, value: unknown) =>
    http()
      .post(`/api/v1/accounts/${accountId}/approves-cells`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ approves_cells: value });

  const me = (account: TestAccount) =>
    http().get('/api/v1/auth/me').set('Authorization', `Bearer ${account.accessToken}`);

  const newCellBody = (prospectiveLeaderId: string, members: string[]) => ({
    kind: 'NEW_CELL',
    prospective_leader_id: prospectiveLeaderId,
    category: 'YOUTH',
    day_of_week: 6,
    time_of_day: '16:00',
    members,
  });

  /** A pending new-Cell request with three fresh Men's members; its id and the members. */
  const pendingNewCell = async (
    actor: TestAccount,
    personId: string,
  ): Promise<{ id: string; members: string[] }> => {
    const members = (await createRequestMembers(db, 'MENS', { under: personId })).ids;
    const response = await submit(actor, newCellBody(personId, members));
    expect({ status: response.status, body: response.body }).toMatchObject({ status: 201 });
    return { id: response.body.id as string, members };
  };

  const pendingHandover = async (
    actor: TestAccount,
    personId: string,
    cellId: string,
  ): Promise<string> => {
    const response = await submit(actor, {
      kind: 'HANDOVER',
      prospective_leader_id: personId,
      cell_id: cellId,
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

  /** An open membership of `cell`, from the Cell's own first instant. */
  const enrol = async (personId: string, cellUuid: string): Promise<void> => {
    await sql`
      INSERT INTO cell_memberships (person_id, cell_id, started_at)
      SELECT ${personId}::uuid, id, created_at FROM cells WHERE id = ${cellUuid}::uuid
    `.execute(db);
  };

  /** Moves a person with no pastoral edge to the other Network, as section 4's pair does. */
  const moveNetwork = async (personId: string, network: 'MENS' | 'WOMENS'): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      const at = new Date();
      await trx
        .updateTable('network_assignments')
        .set({ ended_at: at })
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('network_assignments')
        .values({ person_id: personId, network, started_at: at })
        .execute();
    });
  };

  /**
   * An explicit Whole Church grant of `cell.request_leadership`, which only an Admin issues
   * (section 7). It reaches people beneath nobody and people of the other Network, which a
   * role's own reach never does, so the member checks after the scope check are reached.
   */
  const widenRequests = async (account: TestAccount): Promise<TestAccount> => {
    await db
      .insertInto('capability_grants')
      .values({
        account_id: account.id,
        capability: 'cell.request_leadership',
        scope_type: 'WHOLE_CHURCH',
        scope_network: null,
        read_only: false,
        reason: 'Test: a wider grant than the role gives',
        granted_by: adminA.id,
      })
      .execute();
    return account;
  };

  const archive = async (personId: string): Promise<void> => {
    await db
      .updateTable('person_lifecycle')
      .set({ state: 'ARCHIVED' })
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .execute();
  };

  // ---------------------------------------------------------------------------
  // Decision 0352, point 1: the tick
  // ---------------------------------------------------------------------------

  describe('ticking and clearing Approves Cells', () => {
    it('is admitted to an Admin, gives the capability over the branch excluding self, and each change is audit logged', async () => {
      const ticked = await setApprovesCells(adminA, benAccount.id, true).expect(200);
      expect(ticked.body).toEqual({ id: benAccount.id, approves_cells: true });

      const held = (await me(benAccount).expect(200)).body.capabilities as {
        capability: string;
        scope_type: string;
      }[];
      expect(held.filter((grant) => grant.capability === 'cell.approve_leadership')).toEqual([
        expect.objectContaining({
          capability: 'cell.approve_leadership',
          scope_type: 'SUBTREE_EXCL_SELF',
        }),
      ]);

      await setApprovesCells(adminA, benAccount.id, false).expect(200);
      const cleared = (await me(benAccount).expect(200)).body.capabilities as {
        capability: string;
      }[];
      expect(cleared.map((grant) => grant.capability)).not.toContain('cell.approve_leadership');

      const entries = await db
        .selectFrom('audit_log')
        .select(['actor_id', 'target_type', 'target_id', 'before', 'after'])
        .where('action', '=', 'account.approves_cells_changed')
        .orderBy('occurred_at')
        .execute();

      expect(entries).toEqual([
        {
          actor_id: adminA.id,
          target_type: 'account',
          target_id: benAccount.id,
          before: { approves_cells: false },
          after: { approves_cells: true },
        },
        {
          actor_id: adminA.id,
          target_type: 'account',
          target_id: benAccount.id,
          before: { approves_cells: true },
          after: { approves_cells: false },
        },
      ]);
    });

    it('is what admits deciding, and clearing it withdraws that', async () => {
      // Teodoro is in Ben's branch and not his direct disciple (point 3).
      const teodoro = await createPerson(db, { firstName: 'Teodoro', network: 'MENS' });
      await assignTo(db, teodoro.id, pedro.id);
      const { id } = await pendingNewCell(adminA, teodoro.id);

      // Not ticked: Ben does not hold the capability at all.
      expect((await approve(benAccount, id).expect(403)).body.error.code).toBe('CAPABILITY_DENIED');

      await setApprovesCells(adminA, benAccount.id, true).expect(200);
      await setApprovesCells(adminA, benAccount.id, false).expect(200);
      expect((await decline(benAccount, id).expect(403)).body.error.code).toBe('CAPABILITY_DENIED');

      // Declining rather than approving, so this case is about the tick alone; approving
      // is pinned in the cases below.
      await setApprovesCells(adminA, benAccount.id, true).expect(200);
      await decline(benAccount, id).expect(200);
    });

    it('writes nothing and logs nothing when the value is already set', async () => {
      const response = await setApprovesCells(adminA, raymondAccount.id, true).expect(200);
      expect(response.body).toEqual({ id: raymondAccount.id, approves_cells: true });

      const entries = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'account.approves_cells_changed')
        .execute();
      expect(entries).toEqual([]);
    });

    it('is refused to a Leader, ticked or not', async () => {
      for (const actor of [raymondAccount, benAccount]) {
        for (const value of [true, false]) {
          const response = await setApprovesCells(actor, manuelAccount.id, value).expect(403);
          expect(response.body.error.code).toBe('CAPABILITY_DENIED');
        }
      }
    });

    it('is refused to a Senior Pastor', async () => {
      const pastorPerson = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
      await assignTo(db, pastorPerson.id, null);
      nameSeniorPastors(app, [pastorPerson.id]);
      const pastor = await createAccount(app, db, {
        person: pastorPerson,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });

      for (const value of [true, false]) {
        const response = await setApprovesCells(pastor, manuelAccount.id, value).expect(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }
    });

    it('is refused on an account holding no Leader role', async () => {
      const response = await setApprovesCells(adminA, adminB.id, true).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      const row = await db
        .selectFrom('accounts')
        .select('approves_cells')
        .where('id', '=', adminB.id)
        .executeTakeFirstOrThrow();
      expect(row.approves_cells).toBe(false);
    });

    it('refuses a body that is not a boolean', async () => {
      const response = await setApprovesCells(adminA, benAccount.id, 'yes').expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    // Offered only with Full view (owner, 2026-10-15, decision 0352 point 10).
    it('is refused on a Leader account without Full view', async () => {
      await db
        .updateTable('accounts')
        .set({ full_view: false })
        .where('id', '=', benAccount.id)
        .execute();

      const response = await setApprovesCells(adminA, benAccount.id, true).expect(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      const row = await db
        .selectFrom('accounts')
        .select('approves_cells')
        .where('id', '=', benAccount.id)
        .executeTakeFirstOrThrow();
      expect(row.approves_cells).toBe(false);
    });

    it('is cleared with Full view, and audited as its own change', async () => {
      await tick(benAccount, true);

      await http()
        .post(`/api/v1/accounts/${benAccount.id}/full-view`)
        .set('Authorization', `Bearer ${adminA.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ full_view: false })
        .expect(200);

      const row = await db
        .selectFrom('accounts')
        .select(['full_view', 'approves_cells'])
        .where('id', '=', benAccount.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ full_view: false, approves_cells: false });

      const entries = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('action', '=', 'account.approves_cells_changed')
        .where('target_id', '=', benAccount.id)
        .execute();
      expect(entries).toEqual([
        { before: { approves_cells: true }, after: { approves_cells: false } },
      ]);
    });

    it('cannot be held without Full view, by the database too', async () => {
      await expect(
        db
          .updateTable('accounts')
          .set({ full_view: false, approves_cells: true })
          .where('id', '=', benAccount.id)
          .execute(),
      ).rejects.toThrow(/accounts_approves_cells_needs_full_view/);
    });

    it('starts a new Leader account without it, and the account read says so', async () => {
      // A Leader account arrives with the Cell leadership that qualifies it (section 6).
      await createCell(db, { leader: juan });

      await http()
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${adminA.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ person_id: juan.id, email: 'juan.approver@example.test', role: 'LEADER' })
        .expect(201);

      const read = await http()
        .get(`/api/v1/accounts/for-person/${juan.id}`)
        .set('Authorization', `Bearer ${adminA.accessToken}`)
        .expect(200);

      expect(read.body.account.approves_cells).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0352, points 2 to 8: deciding
  // ---------------------------------------------------------------------------

  describe('a ticked approver deciding', () => {
    it('approves a new Cell for somebody in its branch', async () => {
      const { id } = await pendingNewCell(manuelAccount, mark.id);

      const response = await approve(raymondAccount, id).expect(200);
      expect(response.body).toMatchObject({ state: 'APPROVED', cell_leader_id: mark.id });

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select(['decided_by'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.decided_by).toBe(raymondAccount.id);
    });

    it('declines a request in its branch', async () => {
      const { id } = await pendingNewCell(manuelAccount, mark.id);

      await decline(raymondAccount, id).expect(200);
      expect(await stateOf(id)).toBe('DECLINED');
    });

    it('approves a handover in its branch', async () => {
      const id = await pendingHandover(manuelAccount, mark.id, manuelCell.id);

      const response = await approve(raymondAccount, id).expect(200);
      expect(response.body).toMatchObject({
        kind: 'HANDOVER',
        cell_leader_id: mark.id,
        outgoing_cell_leader_id: manuel.id,
      });
    });

    it('approves a restart of a closed Cell its branch led, resolved through the last leader', async () => {
      const markCell = await createCell(db, { leader: mark });
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });

      const submitted = await submit(manuelAccount, {
        ...newCellBody(mark.id, (await createRequestMembers(db, 'MENS', { under: mark.id })).ids),
        restart_of_cell_id: markCell.id,
      }).expect(201);

      await approve(raymondAccount, submitted.body.id as string).expect(200);
    });

    it.each(['approve', 'decline'] as const)(
      'refuses to %s a request it sent itself',
      async (mode) => {
        const { id } = await pendingNewCell(raymondAccount, juan.id);

        const response = await (mode === 'approve' ? approve : decline)(raymondAccount, id).expect(
          403,
        );
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(await stateOf(id)).toBe('PENDING');

        // It goes to the Admin instead (point 3).
        await (mode === 'approve' ? approve : decline)(adminB, id).expect(200);
      },
    );

    it('refuses a request naming itself as the new leader', async () => {
      const { id } = await pendingNewCell(adminA, raymond.id);

      for (const send of [approve, decline]) {
        const response = await send(raymondAccount, id).expect(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
      expect(await stateOf(id)).toBe('PENDING');
    });

    it.each(['approve', 'decline'] as const)(
      'refuses to %s a request whose new leader is its own direct disciple',
      async (mode) => {
        // Manuel is Raymond's direct disciple, whom section 16's Leaders with 12+ Direct
        // Leaders and section 27's Raise 12 leaders count for Raymond.
        const { id } = await pendingNewCell(adminA, manuel.id);

        const response = await (mode === 'approve' ? approve : decline)(raymondAccount, id).expect(
          403,
        );
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(await stateOf(id)).toBe('PENDING');

        await (mode === 'approve' ? approve : decline)(adminB, id).expect(200);
      },
    );

    it('refuses a new leader outside its branch', async () => {
      const { id } = await pendingNewCell(adminA, pedro.id);

      for (const send of [approve, decline]) {
        const response = await send(raymondAccount, id).expect(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
    });

    it('refuses a handover of a Cell outside its branch, though the new leader is inside it', async () => {
      // Juan is in Raymond's branch; Ben's Cell is not. Both objects must be (point 2).
      const id = await pendingHandover(adminA, juan.id, benCell.id);

      for (const send of [approve, decline]) {
        const response = await send(raymondAccount, id).expect(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
      expect(await stateOf(id)).toBe('PENDING');
    });

    it('refuses a handover of a Cell it leads itself', async () => {
      const id = await pendingHandover(adminA, mark.id, raymondCell.id);

      for (const send of [approve, decline]) {
        const response = await send(raymondAccount, id).expect(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
      expect(await stateOf(id)).toBe('PENDING');

      await approve(adminB, id).expect(200);
    });

    it('refuses a restart of a closed Cell whose last leader is outside its branch', async () => {
      // Pedro leads a Cell under Ben, which closes; Ben is not ticked, so Raymond is the
      // only candidate below the Admin, and Pedro is outside his branch on both counts.
      const pedroCell = await createCell(db, { leader: pedro });
      await closeCellDirectly(db, pedroCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });
      const submitted = await submit(adminA, {
        ...newCellBody(pedro.id, (await createRequestMembers(db, 'MENS', { under: pedro.id })).ids),
        restart_of_cell_id: pedroCell.id,
      }).expect(201);

      const response = await approve(raymondAccount, submitted.body.id as string).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('answers an unknown request as it answers one outside its branch', async () => {
      const response = await approve(raymondAccount, randomUUID()).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('is refused direct creation, which stays Whole Church only (point 8)', async () => {
      const response = await http()
        .post('/api/v1/cells')
        .set('Authorization', `Bearer ${raymondAccount.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ cell_leader_id: mark.id, category: 'YOUTH', day_of_week: 6, time_of_day: '16:00' })
        .expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      const leaderships = await db
        .selectFrom('cell_leaderships')
        .select('id')
        .where('person_id', '=', mark.id)
        .execute();
      expect(leaderships).toEqual([]);
    });
  });

  describe('who else may decide', () => {
    it('refuses approving and declining to a Leader without the tick', async () => {
      const { id } = await pendingNewCell(adminA, pedro.id);

      for (const send of [approve, decline]) {
        const response = await send(benAccount, id).expect(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }
    });

    it('refuses an Admin approving a request that names it as the new leader (point 4)', async () => {
      const nestor = await createPerson(db, { firstName: 'Nestor', network: 'MENS' });
      await assignTo(db, nestor.id, manuel.id);
      const nestorAdmin = await createAccount(app, db, { person: nestor, roles: ['ADMIN'] });

      const { id } = await pendingNewCell(adminA, nestor.id);

      const response = await approve(nestorAdmin, id).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await stateOf(id)).toBe('PENDING');

      // Another Admin may (point 5).
      await approve(adminB, id).expect(200);
    });

    it('lets the Admin decide inside a ticked approver’s branch too (point 5)', async () => {
      const { id } = await pendingNewCell(manuelAccount, mark.id);
      await approve(adminB, id).expect(200);
    });

    it('gives an explicit grant narrower than Whole Church nothing (point 7)', async () => {
      // Ben is not ticked; he is granted the capability explicitly over his own branch,
      // at both narrower scopes a Leader could plausibly be given.
      for (const scope of ['OWN_SUBTREE', 'SUBTREE_EXCL_SELF'] as const) {
        await db
          .insertInto('capability_grants')
          .values({
            account_id: benAccount.id,
            capability: 'cell.approve_leadership',
            scope_type: scope,
            read_only: false,
            reason: 'Invented for this case (CLAUDE.md, Secrets).',
            granted_by: adminA.id,
          })
          .execute();
      }

      const { id } = await pendingNewCell(adminA, pedro.id);

      for (const send of [approve, decline]) {
        const response = await send(benAccount, id).expect(403);
        // Section 7: a grant that covers nothing is SCOPE_DENIED, naming the scope.
        expect(response.body.error.code).toBe('SCOPE_DENIED');
      }
      expect(await stateOf(id)).toBe('PENDING');

      // /auth/me does not list a grant that covers nothing.
      const held = (await me(benAccount).expect(200)).body.capabilities as {
        capability: string;
      }[];
      expect(held.map((grant) => grant.capability)).not.toContain('cell.approve_leadership');

      // Nor does it open the queue. Section 7: "a grant of one of these at any narrower
      // scope therefore covers no target at all, and the request is refused with
      // `SCOPE_DENIED`" -- not CAPABILITY_DENIED, which would send an administrator to
      // grant a capability they had already granted.
      const listed = await queue(benAccount);
      expect({ status: listed.status, code: listed.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0352, point 9: the queue
  // ---------------------------------------------------------------------------

  describe('the approval queue', () => {
    type QueueRow = {
      id: string;
      kind: string;
      restart: boolean;
      prospective_leader: { person_id: string; full_name: string; member_id: string };
      requested_by_person: { person_id: string } | null;
      cell: { cell_id: string | null; category: string; day_of_week: number; time_of_day: string };
      outgoing_leader: { person_id: string } | null;
      members: { person_id: string; full_name: string; member_id: string }[];
      branch_of: { person_id: string } | null;
    };

    let decidableNew: { id: string; members: string[] };
    let decidableHandover: string;
    let all: string[];

    beforeEach(async () => {
      decidableNew = await pendingNewCell(manuelAccount, mark.id);
      decidableHandover = await pendingHandover(manuelAccount, mark.id, manuelCell.id);

      const own = (await pendingNewCell(raymondAccount, juan.id)).id;
      const directDisciple = (await pendingNewCell(adminA, manuel.id)).id;
      const outside = (await pendingNewCell(adminA, pedro.id)).id;
      const cellItLeads = await pendingHandover(adminA, mark.id, raymondCell.id);
      const cellOutside = await pendingHandover(adminA, juan.id, benCell.id);
      const naming = (await pendingNewCell(adminA, raymond.id)).id;

      all = [
        decidableNew.id,
        decidableHandover,
        own,
        directDisciple,
        outside,
        cellItLeads,
        cellOutside,
        naming,
      ];
    });

    const idsOf = (response: request.Response): string[] =>
      (response.body.data as { id: string }[]).map((row) => row.id);

    it('lists for a ticked approver only what it may decide', async () => {
      const response = await queue(raymondAccount).expect(200);

      expect(idsOf(response)).toEqual([decidableNew.id, decidableHandover]);
      expect(response.body.next_cursor).toBeNull();
    });

    it('lists every pending request for the Admin', async () => {
      const response = await queue(adminB).expect(200);
      expect(idsOf(response)).toEqual(all);
    });

    it('pages a ticked approver’s filtered queue without losing or repeating a row', async () => {
      const page1 = await queue(raymondAccount, '?limit=1').expect(200);
      expect(idsOf(page1)).toEqual([decidableNew.id]);
      expect(page1.body.next_cursor).not.toBeNull();

      const page2 = await queue(
        raymondAccount,
        `?limit=1&cursor=${encodeURIComponent(page1.body.next_cursor as string)}`,
      ).expect(200);
      expect(idsOf(page2)).toEqual([decidableHandover]);
    });

    it('refuses the queue to a Leader without the tick', async () => {
      const response = await queue(benAccount).expect(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('names the leader, the sender, the Cell, the members and the branch on a new-Cell row', async () => {
      const response = await queue(raymondAccount).expect(200);
      const row = (response.body.data as QueueRow[]).find((entry) => entry.id === decidableNew.id);

      expect(row).toMatchObject({
        kind: 'NEW_CELL',
        restart: false,
        prospective_leader: { person_id: mark.id, full_name: 'Mark Testfixture' },
        requested_by_person: { person_id: manuel.id },
        cell: { cell_id: null, category: 'YOUTH', day_of_week: 6 },
        outgoing_leader: null,
        branch_of: { person_id: raymond.id },
      });
      expect(row?.prospective_leader.member_id).toMatch(/^M-\d+$/);
      expect(row?.cell.time_of_day).toMatch(/^16:00/);
      expect(row?.members.map((member) => member.person_id).sort()).toEqual(
        [...decidableNew.members].sort(),
      );
      for (const member of row?.members ?? []) {
        expect(member.full_name).toMatch(/^Member(One|Two|Three) Requestmember/);
        expect(member.member_id).toMatch(/^M-\d+$/);
      }
    });

    it('names the Cell as it stands and its present leader on a handover row', async () => {
      const response = await queue(raymondAccount).expect(200);
      const row = (response.body.data as QueueRow[]).find(
        (entry) => entry.id === decidableHandover,
      );

      expect(row).toMatchObject({
        kind: 'HANDOVER',
        restart: false,
        prospective_leader: { person_id: mark.id },
        requested_by_person: { person_id: manuel.id },
        cell: {
          cell_id: manuelCell.cellId,
          category: manuelCell.category,
          day_of_week: manuelCell.dayOfWeek,
        },
        outgoing_leader: { person_id: manuel.id },
        members: [],
      });
    });

    it('marks a restart', async () => {
      const juanCell = await createCell(db, { leader: juan });
      await closeCellDirectly(db, juanCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });
      // Juan's pending new-Cell request (Raymond's own) blocks a second; decline it.
      await decline(adminB, all[2]).expect(200);
      const submitted = await submit(manuelAccount, {
        ...newCellBody(juan.id, (await createRequestMembers(db, 'MENS', { under: juan.id })).ids),
        restart_of_cell_id: juanCell.id,
      }).expect(201);

      const response = await queue(raymondAccount).expect(200);
      const row = (response.body.data as QueueRow[]).find(
        (entry) => entry.id === submitted.body.id,
      );
      expect(row).toMatchObject({ restart: true, cell: { cell_id: juanCell.cellId } });
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0353: the members at request
  // ---------------------------------------------------------------------------

  describe('the members a new-Cell request names, at request', () => {
    it('records them, answers them, and audits them, and enrols nobody yet', async () => {
      const members = (await createRequestMembers(db, 'MENS', { under: mark.id })).ids;

      const response = await submit(manuelAccount, newCellBody(mark.id, members)).expect(201);
      expect(response.body.members).toEqual(members);

      const rows = await db
        .selectFrom('cell_leadership_request_members')
        .select('person_id')
        .where('request_id', '=', response.body.id as string)
        .execute();
      expect(rows.map((row) => row.person_id).sort()).toEqual([...members].sort());

      // Section 21: the submitted entry carries what was asked, the members included.
      const entry = await db
        .selectFrom('audit_log')
        .select('after')
        .where('action', '=', 'cell_leadership_request.submitted')
        .executeTakeFirstOrThrow();
      expect(entry.after).toMatchObject({ members });

      const enrolled = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', 'in', members)
        .execute();
      expect(enrolled).toEqual([]);
    });

    it.each([
      ['none', 0],
      ['two', 2],
      ['four', 4],
    ])('refuses %s members as the request’s shape', async (_label, count) => {
      const people = [];
      for (let index = 0; index < count; index += 1) {
        people.push((await createPerson(db, { firstName: `Extra${index}`, network: 'MENS' })).id);
      }

      const response = await submit(manuelAccount, newCellBody(mark.id, people)).expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('members');
    });

    it('refuses a new-Cell request naming no members at all', async () => {
      const body: Record<string, unknown> = newCellBody(mark.id, []);
      delete body.members;

      const response = await submit(manuelAccount, body).expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('members');
    });

    it('refuses a restart naming no members', async () => {
      const markCell = await createCell(db, { leader: mark });
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });
      const body: Record<string, unknown> = {
        ...newCellBody(mark.id, []),
        restart_of_cell_id: markCell.id,
      };
      delete body.members;

      const response = await submit(manuelAccount, body).expect(422);
      expect(response.body.error.details.field).toBe('members');
    });

    it('refuses a person named twice, however the identifier is spelled', async () => {
      const [one, two] = (await createRequestMembers(db, 'MENS', { under: mark.id })).ids;

      for (const repeated of [one, one.toUpperCase()]) {
        const response = await submit(manuelAccount, newCellBody(mark.id, [one, two, repeated]));
        expect({ status: response.status, field: response.body.error?.details?.field }).toEqual({
          status: 422,
          field: 'members',
        });
      }
    });

    it('refuses the prospective leader named as a member, and names the line', async () => {
      const [one, two] = (await createRequestMembers(db, 'MENS', { under: mark.id })).ids;

      const response = await submit(
        manuelAccount,
        newCellBody(mark.id, [one, mark.id, two]),
      ).expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details).toMatchObject({ field: 'members', path: 'members[1]' });
    });

    it('refuses members on a handover', async () => {
      const response = await submit(manuelAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: mark.id,
        cell_id: manuelCell.id,
        members: (await createRequestMembers(db, 'MENS', { under: mark.id })).ids,
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('members');
    });

    const refusedAt = async (
      members: string[],
      index: number,
      actor: TestAccount = manuelAccount,
    ): Promise<void> => {
      const response = await submit(actor, newCellBody(mark.id, members));

      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 409,
        code: 'INVARIANT_VIOLATION',
      });
      expect(response.body.error.details).toMatchObject({
        field: 'members',
        path: `members[${index}]`,
        person_id: members[index],
      });

      const requests = await db
        .selectFrom('cell_leadership_requests')
        .select('id')
        .where('prospective_leader_id', '=', mark.id)
        .execute();
      expect(requests).toEqual([]);
    };

    it('refuses an archived Person', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await archive(ids[2]);
      await refusedAt(ids, 2);
    });

    it('refuses a Person absorbed by a merge', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await db
        .updateTable('persons')
        .set({ merged_into_id: juan.id, merged_at: new Date(), merge_reason: 'Recorded twice' })
        .where('id', '=', ids[0])
        .execute();
      await refusedAt(ids, 0);
    });

    it('refuses a Person of the other Network', async () => {
      // Nobody of the other Network is beneath a requester, whose own refusal would come
      // first (decision 0369), so the requester holds a wider grant.
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      const other = await createPerson(db, { firstName: 'Lorna', network: 'WOMENS' });
      await refusedAt([ids[0], other.id, ids[2]], 1, await widenRequests(manuelAccount));
    });

    it('accepts a Person already in a Cell, who stays there while it waits (decision 0357)', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await enrol(ids[1], benCell.id);
      await submit(manuelAccount, newCellBody(mark.id, ids)).expect(201);

      const open = await db
        .selectFrom('cell_memberships')
        .select('cell_id')
        .where('person_id', '=', ids[1])
        .where('ended_at', 'is', null)
        .execute();
      expect(open).toEqual([{ cell_id: benCell.id }]);
    });

    it('refuses an identifier naming nobody, rather than answering 500', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      // Beneath nobody, so a requester is answered as for anybody outside their branch.
      const response = await submit(
        manuelAccount,
        newCellBody(mark.id, [ids[0], ids[1], randomUUID()]),
      );
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
      // And with a Whole Church grant, the check about the person answers it, not a 500.
      await refusedAt([ids[0], ids[1], randomUUID()], 2, await widenRequests(manuelAccount));
    });

    it('answers the scope refusal first, so a member is never what an actor without scope learns about', async () => {
      // Ben passes the guard for Pedro but not the second object, a closed Cell outside his
      // branch. An archived member would be refused 409 if it were checked first.
      const markCell = await createCell(db, { leader: mark });
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await archive(ids[0]);

      const response = await submit(benAccount, {
        ...newCellBody(pedro.id, ids),
        restart_of_cell_id: markCell.id,
      }).expect(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');

      // And the guard's own refusal, for somebody outside the actor's branch.
      const outside = await submit(benAccount, newCellBody(mark.id, ids)).expect(403);
      expect(outside.body.error.code).toBe('SCOPE_DENIED');
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0369: the members are beneath the leader asking
  // ---------------------------------------------------------------------------

  describe('the members are beneath the leader asking (decision 0369)', () => {
    const refusedOutside = async (
      actor: TestAccount,
      members: string[],
      index: number,
    ): Promise<void> => {
      const response = await submit(actor, newCellBody(mark.id, members));

      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
      expect(response.body.error.details).toEqual({
        capability: 'cell.request_leadership',
        field: 'members',
        path: `members[${index}]`,
      });
      const requests = await db
        .selectFrom('cell_leadership_requests')
        .select('id')
        .where('prospective_leader_id', '=', mark.id)
        .execute();
      expect(requests).toEqual([]);
    };

    it('accepts members anywhere beneath the leader asking, not only beneath the new leader', async () => {
      // Juan is Mark's disciple, so beneath Manuel; the other two are beneath Mark.
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await submit(manuelAccount, newCellBody(mark.id, [juan.id, ids[1], ids[2]])).expect(201);
    });

    it('refuses a member in another leader’s branch of the same Network, naming the line', async () => {
      const mine = await createRequestMembers(db, 'MENS', { under: mark.id });
      const bens = await createRequestMembers(db, 'MENS', { under: pedro.id, prefix: 'Bens' });
      await refusedOutside(manuelAccount, [mine.ids[0], mine.ids[1], bens.ids[0]], 2);
    });

    it('refuses the leader asking’s own upline', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await refusedOutside(manuelAccount, [raymond.id, ids[1], ids[2]], 0);
    });

    it('says nothing about somebody outside the branch: archived or of the other Network, the answer is the same', async () => {
      const mine = await createRequestMembers(db, 'MENS', { under: mark.id });
      const bens = await createRequestMembers(db, 'MENS', { under: pedro.id, prefix: 'Bens' });
      await archive(bens.ids[0]);
      const other = await createPerson(db, { firstName: 'Lorna', network: 'WOMENS' });

      await refusedOutside(manuelAccount, [mine.ids[0], bens.ids[0], mine.ids[2]], 1);
      await refusedOutside(manuelAccount, [mine.ids[0], mine.ids[1], other.id], 2);
    });

    it('refuses the leader asking named as a member, at any scope', async () => {
      const { ids } = await createRequestMembers(db, 'MENS', { under: mark.id });
      await refusedOutside(manuelAccount, [ids[0], manuel.id, ids[2]], 1);
      // A Whole Church grant covers its holder's own Person, and still they may not.
      await refusedOutside(await widenRequests(manuelAccount), [ids[0], ids[1], manuel.id], 2);
    });

    it('lets an explicit Whole Church grant name anybody in the new leader’s Network', async () => {
      const bens = await createRequestMembers(db, 'MENS', { under: pedro.id, prefix: 'Bens' });
      const nobodys = await createRequestMembers(db, 'MENS', { prefix: 'Unplaced' });
      const wide = await widenRequests(manuelAccount);
      await submit(wide, newCellBody(mark.id, [bens.ids[0], bens.ids[1], nobodys.ids[0]])).expect(
        201,
      );
    });

    it('limits the Admin as every role: their role reaches only beneath them', async () => {
      // Oriel, the root, holds ADMIN here; Ben's branch is beneath him, and nobody else is.
      const bens = await createRequestMembers(db, 'MENS', { under: pedro.id, prefix: 'Bens' });
      await submit(adminA, newCellBody(mark.id, bens.ids)).expect(201);
      const nobodys = await createRequestMembers(db, 'MENS', { prefix: 'Unplaced' });
      const response = await submit(adminA, newCellBody(juan.id, nobodys.ids));
      expect(response.status).toBe(403);
      expect(response.body.error.details).toMatchObject({ path: 'members[0]' });
    });

    it('refuses approval where a member has since moved out of the requester’s reach, creating nothing', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      const cellsBefore = await db.selectFrom('cells').select('id').execute();

      // Moved to Ben's branch, as a reassignment closes one row and opens the next.
      await db.transaction().execute(async (trx) => {
        const at = new Date();
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', members[1])
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: members[1], leader_id: pedro.id, started_at: at })
          .execute();
      });

      const response = await approve(adminB, id);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
      expect(response.body.error.details).toEqual({
        capability: 'cell.request_leadership',
        subject: 'requester',
        requested_by: manuelAccount.id,
        person_id: members[1],
      });
      expect(await stateOf(id)).toBe('PENDING');
      expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(cellsBefore.length);
    });

    it('refuses approval as the new leader, not as a member, where the new leader has moved and taken them along', async () => {
      const { id } = await pendingNewCell(manuelAccount, mark.id);

      // Mark moves to Ben's branch; the members beneath him go with him (section 5).
      await db.transaction().execute(async (trx) => {
        const at = new Date();
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', mark.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: mark.id, leader_id: pedro.id, started_at: at })
          .execute();
      });

      const response = await approve(adminB, id);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
      expect(response.body.error.details).toEqual({
        capability: 'cell.request_leadership',
        subject: 'requester',
        requested_by: manuelAccount.id,
      });
      expect(await stateOf(id)).toBe('PENDING');
    });

    it('refuses a restart naming a member outside the leader asking’s branch', async () => {
      const markCell = await createCell(db, { leader: mark });
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });
      const mine = await createRequestMembers(db, 'MENS', { under: mark.id });
      const bens = await createRequestMembers(db, 'MENS', { under: pedro.id, prefix: 'Bens' });

      const response = await submit(manuelAccount, {
        ...newCellBody(mark.id, [mine.ids[0], bens.ids[0], mine.ids[2]]),
        restart_of_cell_id: markCell.id,
      });
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 403,
        code: 'SCOPE_DENIED',
      });
      expect(response.body.error.details).toMatchObject({ path: 'members[1]' });
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0353: the members at approval
  // ---------------------------------------------------------------------------

  describe('the members at approval', () => {
    const refusedNaming = async (requestId: string, personId: string): Promise<void> => {
      const cellsBefore = await db.selectFrom('cells').select('id').execute();

      const response = await approve(adminB, requestId);
      expect({ status: response.status, code: response.body.error?.code }).toEqual({
        status: 409,
        code: 'INVARIANT_VIOLATION',
      });
      expect(response.body.error.details).toMatchObject({ field: 'members', person_id: personId });

      expect(await stateOf(requestId)).toBe('PENDING');
      expect(await db.selectFrom('cells').select('id').execute()).toHaveLength(cellsBefore.length);
      const leaderships = await db
        .selectFrom('cell_leaderships')
        .select('id')
        .where('person_id', '=', mark.id)
        .execute();
      expect(leaderships).toEqual([]);
    };

    it('adds all three from the Cell’s first instant, in the transaction that creates it, each audited', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);

      const response = await approve(adminB, id).expect(200);
      const cellUuid = response.body.cell_uuid as string;

      const cell = await db
        .selectFrom('cells')
        .select('created_at')
        .where('id', '=', cellUuid)
        .executeTakeFirstOrThrow();

      const memberships = await db
        .selectFrom('cell_memberships')
        .select(['person_id', 'started_at', 'ended_at'])
        .where('cell_id', '=', cellUuid)
        .execute();

      expect(memberships.map((row) => row.person_id).sort()).toEqual([...members].sort());
      for (const row of memberships) {
        // Compared in the database at full precision below; this is the readable half.
        expect(row.started_at.getTime()).toBe(cell.created_at.getTime());
        expect(row.ended_at).toBeNull();
      }

      const exact = await sql<{ same: boolean }>`
        SELECT bool_and(m.started_at = c.created_at) AS same
          FROM cell_memberships m JOIN cells c ON c.id = m.cell_id
         WHERE c.id = ${cellUuid}::uuid
      `.execute(db);
      expect(exact.rows[0].same).toBe(true);

      // The leader holds no membership row (section 10).
      expect(memberships.map((row) => row.person_id)).not.toContain(mark.id);

      const entries = await db
        .selectFrom('audit_log')
        .select(['actor_id', 'target_type', 'target_id', 'after'])
        .where('action', '=', 'cell_membership.added')
        .execute();
      expect(entries.map((entry) => entry.target_id).sort()).toEqual([...members].sort());
      for (const entry of entries) {
        expect(entry).toMatchObject({
          actor_id: adminB.id,
          target_type: 'person',
          after: { cell_uuid: cellUuid },
        });
      }
    });

    it('also adds them when a ticked approver approves', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);

      const response = await approve(raymondAccount, id).expect(200);
      const memberships = await db
        .selectFrom('cell_memberships')
        .select('person_id')
        .where('cell_id', '=', response.body.cell_uuid as string)
        .execute();
      expect(memberships.map((row) => row.person_id).sort()).toEqual([...members].sort());
    });

    it('moves a member who has since joined a Cell, for an approver who may move them (decision 0357)', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      await enrol(members[1], benCell.id);

      const response = await approve(adminB, id).expect(200);
      const open = await db
        .selectFrom('cell_memberships')
        .select('cell_id')
        .where('person_id', '=', members[1])
        .where('ended_at', 'is', null)
        .execute();
      expect(open).toEqual([{ cell_id: response.body.cell_uuid as string }]);
    });

    it('refuses where a member has since been archived', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      await archive(members[0]);
      await refusedNaming(id, members[0]);
    });

    it('refuses where a member has since been absorbed by a merge', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      await db
        .updateTable('persons')
        .set({ merged_into_id: juan.id, merged_at: new Date(), merge_reason: 'Recorded twice' })
        .where('id', '=', members[2])
        .execute();
      await refusedNaming(id, members[2]);
    });

    it('refuses where a member has since moved Network', async () => {
      // Beneath nobody, so a Network change needs no reassignment, and named through a wider
      // grant (decision 0369).
      const wide = await widenRequests(manuelAccount);
      const members = (await createRequestMembers(db, 'MENS')).ids;
      const sent = await submit(wide, newCellBody(mark.id, members)).expect(201);
      await moveNetwork(members[2], 'WOMENS');
      await refusedNaming(sent.body.id as string, members[2]);
    });

    it('approves a request sent before members were named, adding nobody (point 7)', async () => {
      const legacy = await db
        .insertInto('cell_leadership_requests')
        .values({
          kind: 'NEW_CELL',
          prospective_leader_id: mark.id,
          requested_by: manuelAccount.id,
          category: 'YOUTH',
          day_of_week: 6,
          time_of_day: '16:00',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const response = await approve(adminB, legacy.id).expect(200);

      const memberships = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('cell_id', '=', response.body.cell_uuid as string)
        .execute();
      expect(memberships).toEqual([]);
    });

    it('leaves a handover as it was: no members named, none added', async () => {
      await enrol(juan.id, manuelCell.id);
      const id = await pendingHandover(manuelAccount, mark.id, manuelCell.id);

      await approve(adminB, id).expect(200);

      const memberships = await db
        .selectFrom('cell_memberships')
        .select(['person_id', 'ended_at'])
        .where('cell_id', '=', manuelCell.id)
        .execute();
      expect(memberships).toEqual([{ person_id: juan.id, ended_at: null }]);

      const added = await db
        .selectFrom('audit_log')
        .select('id')
        .where('action', '=', 'cell_membership.added')
        .execute();
      expect(added).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0353, point 6: the members are never changed (the schema)
  // ---------------------------------------------------------------------------

  describe('the schema holds the members fixed (migration 0027)', () => {
    it('refuses changing or removing a named member, pending or decided', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      const replacement = await createPerson(db, { firstName: 'Replacement', network: 'MENS' });

      await expect(
        db
          .updateTable('cell_leadership_request_members')
          .set({ person_id: replacement.id })
          .where('request_id', '=', id)
          .where('person_id', '=', members[0])
          .execute(),
      ).rejects.toThrow(/never changed or removed/);

      await expect(
        db.deleteFrom('cell_leadership_request_members').where('request_id', '=', id).execute(),
      ).rejects.toThrow(/never changed or removed/);

      await approve(adminB, id).expect(200);

      await expect(
        db.deleteFrom('cell_leadership_request_members').where('request_id', '=', id).execute(),
      ).rejects.toThrow(/never changed or removed/);
    });

    it('refuses a member on a handover request', async () => {
      const id = await pendingHandover(manuelAccount, mark.id, manuelCell.id);

      await expect(
        db
          .insertInto('cell_leadership_request_members')
          .values({ request_id: id, person_id: juan.id })
          .execute(),
      ).rejects.toThrow(/only a new-Cell request names members/);
    });

    it('refuses adding a member once the request is sent, a fourth or one already named', async () => {
      const { id, members } = await pendingNewCell(manuelAccount, mark.id);
      const fourth = await createPerson(db, { firstName: 'Fourth', network: 'MENS' });

      await expect(
        db
          .insertInto('cell_leadership_request_members')
          .values({ request_id: id, person_id: fourth.id })
          .execute(),
      ).rejects.toThrow(/never added later/);

      await expect(
        db
          .insertInto('cell_leadership_request_members')
          .values({ request_id: id, person_id: members[0] })
          .execute(),
      ).rejects.toThrow(/never added later/);
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 0353, point 8: Fewer than 3 members
  // ---------------------------------------------------------------------------

  describe('Fewer than 3 members (section 15)', () => {
    const thisMonth = async (): Promise<string> =>
      `${manilaDayOf(await databaseNow(db)).slice(0, 7)}-01`;

    const list = async (actor: TestAccount, query: Record<string, string> = {}) =>
      http()
        .get('/api/v1/cells')
        .query({ month: await thisMonth(), ...query })
        .set('Authorization', `Bearer ${actor.accessToken}`);

    const idsOf = (response: request.Response): string[] =>
      (response.body.data as { id: string }[]).map((row) => row.id).sort();

    const withStatus = async (
      pending: Promise<request.Response>,
      status: number,
    ): Promise<request.Response> => {
      const response = await pending;
      expect({ status: response.status, body: response.body }).toMatchObject({ status });
      return response;
    };

    it('lists a Cell with two members and not one with three, the leader not counted', async () => {
      // Manuel's Cell: two members and its leader, three people in all.
      const two = (await createRequestMembers(db, 'MENS', { prefix: 'Two' })).ids;
      await enrol(two[0], manuelCell.id);
      await enrol(two[1], manuelCell.id);

      // Raymond's Cell: three members.
      for (const personId of (await createRequestMembers(db, 'MENS', { prefix: 'Three' })).ids) {
        await enrol(personId, raymondCell.id);
      }

      // Ben's Cell: three memberships, one of them ended, so two current.
      const ended = (await createRequestMembers(db, 'MENS', { prefix: 'Ended' })).ids;
      for (const personId of ended) {
        await enrol(personId, benCell.id);
      }
      await sql`
        UPDATE cell_memberships SET ended_at = clock_timestamp()
         WHERE person_id = ${ended[0]}::uuid AND ended_at IS NULL
      `.execute(db);

      const attention = await withStatus(list(adminA, { fewer_than_three: 'true' }), 200);
      expect(idsOf(attention)).toEqual([manuelCell.id, benCell.id].sort());

      // Without the filter all three are listed: the list changes nothing about a Cell.
      const everything = await withStatus(list(adminA), 200);
      expect(idsOf(everything)).toEqual([manuelCell.id, raymondCell.id, benCell.id].sort());

      const closed = await db
        .selectFrom('cells')
        .select('id')
        .where('state', '=', 'CLOSED')
        .execute();
      expect(closed).toEqual([]);
    });

    it('narrows what the reader’s scope already lists and widens nothing', async () => {
      // Raymond's scope holds his own Cell and Manuel's; Ben's, with none, is outside it.
      const attention = await withStatus(list(raymondAccount, { fewer_than_three: 'true' }), 200);
      expect(idsOf(attention)).toEqual([raymondCell.id, manuelCell.id].sort());
    });

    it('accepts only the value "true"', async () => {
      const response = await withStatus(list(adminA, { fewer_than_three: 'false' }), 422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses the closed view rather than ignoring the filter there', async () => {
      const response = await withStatus(
        list(adminA, { fewer_than_three: 'true', state: 'CLOSED' }),
        422,
      );
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details).toMatchObject({ field: 'fewer_than_three' });
    });
  });
});
