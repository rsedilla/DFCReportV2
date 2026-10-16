import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
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
 * The Primary moves a member to another Cell (SKILL.md sections 7 and 10, decision 0357),
 * pinned at the API as the ruling's "What the build owes" asks.
 *
 * ```text
 * Oriel (Men's root, SENIOR_PASTOR account)
 * ├── Elena     (LEADER, ticked Moves people and Approves Cells, leads cell E)
 * │   ├── Corazon  (LEADER, not ticked, leads cell C; Marilou is a member)
 * │   │   └── Mia
 * │   └── Teresa   (in no Cell)
 * └── Gina      (LEADER, ticked Approves Cells only)
 *     └── Rosa     (LEADER, not ticked, leads cell R; Lito is a member)
 *         └── Pablo
 * Ester (Women's, outside the tree, ADMIN account)
 * ```
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('Moving a Cell member (decision 0357)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let orielAccount: TestAccount;
  let admin: TestAccount;
  let elenaAccount: TestAccount;
  let corazonAccount: TestAccount;
  let ginaAccount: TestAccount;
  let rosaAccount: TestAccount;
  let mia: TestPerson;
  let teresa: TestPerson;
  let marilou: TestPerson;
  let lito: TestPerson;
  let pablo: TestPerson;
  let cellE: TestCell;
  let cellC: TestCell;
  let cellR: TestCell;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, oriel.id, null);
    nameSeniorPastors(app, [oriel.id]);
    orielAccount = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });

    const elena = await createPerson(db, { firstName: 'Elena', network: 'MENS' });
    await assignTo(db, elena.id, oriel.id);
    cellE = await createCell(db, { leader: elena });
    elenaAccount = await createAccount(app, db, {
      person: elena,
      roles: ['LEADER'],
      movesPeople: true,
    });

    const corazon = await createPerson(db, { firstName: 'Corazon', network: 'MENS' });
    await assignTo(db, corazon.id, elena.id);
    cellC = await createCell(db, { leader: corazon });
    corazonAccount = await createAccount(app, db, { person: corazon, roles: ['LEADER'] });

    marilou = await createPerson(db, { firstName: 'Marilou', network: 'MENS' });
    await assignTo(db, marilou.id, corazon.id);
    await enrol(marilou.id, cellC.id);

    mia = await createPerson(db, { firstName: 'Mia', network: 'MENS' });
    await assignTo(db, mia.id, corazon.id);

    teresa = await createPerson(db, { firstName: 'Teresa', network: 'MENS' });
    await assignTo(db, teresa.id, elena.id);

    const gina = await createPerson(db, { firstName: 'Gina', network: 'MENS' });
    await assignTo(db, gina.id, oriel.id);
    ginaAccount = await createAccount(app, db, { person: gina, roles: ['LEADER'] });

    const rosa = await createPerson(db, { firstName: 'Rosa', network: 'MENS' });
    await assignTo(db, rosa.id, gina.id);
    cellR = await createCell(db, { leader: rosa });
    rosaAccount = await createAccount(app, db, { person: rosa, roles: ['LEADER'] });

    lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, rosa.id);
    await enrol(lito.id, cellR.id);

    pablo = await createPerson(db, { firstName: 'Pablo', network: 'MENS' });
    await assignTo(db, pablo.id, rosa.id);

    await db
      .updateTable('accounts')
      .set({ approves_cells: true })
      .where('id', 'in', [elenaAccount.id, ginaAccount.id])
      .execute();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** An open membership of `cell`, from the Cell's own first instant. */
  async function enrol(personId: string, cellUuid: string): Promise<void> {
    await sql`
      INSERT INTO cell_memberships (person_id, cell_id, started_at)
      SELECT ${personId}::uuid, id, created_at FROM cells WHERE id = ${cellUuid}::uuid
    `.execute(db);
  }

  const http = () => request(app.getHttpServer());

  const addMember = (actor: TestAccount, cellUuid: string, personId: string) =>
    http()
      .post(`/api/v1/cells/${cellUuid}/members`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ person_id: personId });

  const removeMember = (actor: TestAccount, cellUuid: string, personId: string) =>
    http()
      .delete(`/api/v1/cells/${cellUuid}/members/${personId}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID());

  const submit = (actor: TestAccount, prospectiveLeaderId: string, members: string[]) =>
    http()
      .post('/api/v1/cells/leadership-requests')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'NEW_CELL',
        prospective_leader_id: prospectiveLeaderId,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '18:00',
        members,
      });

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

  const queueIds = async (actor: TestAccount): Promise<string[]> => {
    const response = await http()
      .get('/api/v1/cells/leadership-requests')
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .expect(200);
    return (response.body.data as { id: string }[]).map((row) => row.id);
  };

  const codeOf = (response: request.Response): unknown => response.body.error?.code;

  /** The Cell a person is a member of now, or null. */
  const cellOf = async (personId: string): Promise<string | null> => {
    const row = await db
      .selectFrom('cell_memberships')
      .select('cell_id')
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    return row?.cell_id ?? null;
  };

  const moveHolding = async (account: TestAccount): Promise<unknown[]> => {
    const response = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    return (response.body.capabilities as { capability: string; scope_type: string }[])
      .filter((grant) => grant.capability === 'cell.move_members')
      .map((grant) => grant.scope_type);
  };

  // ---------------------------------------------------------------------------
  // Points 1 and 2: who holds it
  // ---------------------------------------------------------------------------

  describe('who holds cell.move_members', () => {
    it('is held by a ticked Leader over its own subtree, by the Admin at Whole Church, and by nobody else', async () => {
      expect(await moveHolding(elenaAccount)).toEqual(['OWN_SUBTREE']);
      expect(await moveHolding(admin)).toEqual(['WHOLE_CHURCH']);
      expect(await moveHolding(corazonAccount)).toEqual([]);
      expect(await moveHolding(ginaAccount)).toEqual([]);
      expect(await moveHolding(orielAccount)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Points 3 to 6: moving, removing, adding
  // ---------------------------------------------------------------------------

  describe('a Leader without the tick', () => {
    it('adds somebody in no Cell at once', async () => {
      await addMember(corazonAccount, cellC.id, teresa.id).expect(201);
      expect(await cellOf(teresa.id)).toBe(cellC.id);
    });

    it('is refused adding somebody already in another Cell, which is a move, and nothing moves', async () => {
      const response = await addMember(corazonAccount, cellC.id, lito.id).expect(403);
      expect(codeOf(response)).toBe('CAPABILITY_DENIED');
      expect(response.body.error.details).toEqual({ capability: 'cell.move_members' });
      expect(await cellOf(lito.id)).toBe(cellR.id);
    });

    it('is refused removing a member of its own Cell', async () => {
      const response = await removeMember(corazonAccount, cellC.id, marilou.id).expect(403);
      expect(codeOf(response)).toBe('CAPABILITY_DENIED');
      expect(await cellOf(marilou.id)).toBe(cellC.id);
    });
  });

  describe('a Leader ticked Moves people', () => {
    it('moves a member between two Cells of its branch at once, as one audited move', async () => {
      const response = await addMember(elenaAccount, cellE.id, marilou.id).expect(201);
      expect(response.body.moved_from_cell_id).toBe(cellC.cellId);
      expect(await cellOf(marilou.id)).toBe(cellE.id);

      const entry = await db
        .selectFrom('audit_log')
        .select(['action', 'before'])
        .where('target_id', '=', marilou.id)
        .where('action', 'in', ['cell_membership.added', 'cell_membership.moved'])
        .executeTakeFirstOrThrow();
      expect(entry).toEqual({
        action: 'cell_membership.moved',
        before: { cell_uuid: cellC.id, cell_id: cellC.cellId },
      });
    });

    it('is refused SCOPE_DENIED moving somebody out of a Cell in another branch, and names no Cell', async () => {
      const response = await addMember(elenaAccount, cellE.id, lito.id).expect(403);
      expect(codeOf(response)).toBe('SCOPE_DENIED');
      expect(response.body.error.details).toEqual({ capability: 'cell.move_members' });
      expect(JSON.stringify(response.body)).not.toContain(cellR.cellId);
      expect(await cellOf(lito.id)).toBe(cellR.id);
    });

    it('removes a member of a Cell in its branch, who then holds no Cell', async () => {
      await removeMember(elenaAccount, cellC.id, marilou.id).expect(200);
      expect(await cellOf(marilou.id)).toBeNull();
    });

    it('is refused removing a member of a Cell outside its branch', async () => {
      const response = await removeMember(elenaAccount, cellR.id, lito.id).expect(403);
      expect(codeOf(response)).toBe('SCOPE_DENIED');
      expect(await cellOf(lito.id)).toBe(cellR.id);
    });
  });

  describe('the Admin and the Senior Pastors', () => {
    it('lets the Admin move a member across branches and remove one', async () => {
      await addMember(admin, cellC.id, lito.id).expect(201);
      expect(await cellOf(lito.id)).toBe(cellC.id);

      await removeMember(admin, cellC.id, marilou.id).expect(200);
      expect(await cellOf(marilou.id)).toBeNull();
    });

    it('refuses a Senior Pastor moving and removing a member', async () => {
      expect(codeOf(await addMember(orielAccount, cellE.id, marilou.id).expect(403))).toBe(
        'CAPABILITY_DENIED',
      );
      expect(codeOf(await removeMember(orielAccount, cellC.id, marilou.id).expect(403))).toBe(
        'CAPABILITY_DENIED',
      );
      expect(await cellOf(marilou.id)).toBe(cellC.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Point 7: a new-Cell request naming somebody in a Cell
  // ---------------------------------------------------------------------------

  describe('a new-Cell request naming somebody already in a Cell', () => {
    const fresh = async (): Promise<string[]> =>
      (await createRequestMembers(db, 'MENS')).ids.slice(0, 2);

    it('is sent, leaves them in their Cell while it waits, and moves them when approved', async () => {
      const members = [marilou.id, ...(await fresh())];
      const sent = await submit(corazonAccount, mia.id, members).expect(201);
      expect(await cellOf(marilou.id)).toBe(cellC.id);

      const approved = await approve(elenaAccount, sent.body.id as string).expect(200);
      const newCell = approved.body.cell_uuid as string;
      expect(await cellOf(marilou.id)).toBe(newCell);
      for (const id of members) {
        expect(await cellOf(id)).toBe(newCell);
      }

      // The old membership closed at the instant the new one opened.
      const rows = await db
        .selectFrom('cell_memberships')
        .select(['cell_id', 'started_at', 'ended_at'])
        .where('person_id', '=', marilou.id)
        .orderBy('started_at')
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows[0].cell_id).toBe(cellC.id);
      expect(rows[0].ended_at?.getTime()).toBe(rows[1].started_at.getTime());

      const moved = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('target_id', '=', marilou.id)
        .where('action', '=', 'cell_membership.moved')
        .executeTakeFirstOrThrow();
      expect(moved.before).toEqual({ cell_uuid: cellC.id, cell_id: cellC.cellId });
      expect(moved.after).toMatchObject({ cell_uuid: newCell });
    });

    it('is refused SCOPE_DENIED to an approver whose branch does not hold that Cell, and leaves its queue', async () => {
      const sent = await submit(corazonAccount, mia.id, [lito.id, ...(await fresh())]).expect(201);
      const id = sent.body.id as string;

      expect(await queueIds(elenaAccount)).not.toContain(id);
      expect(codeOf(await approve(elenaAccount, id).expect(403))).toBe('SCOPE_DENIED');
      expect(codeOf(await decline(elenaAccount, id).expect(403))).toBe('SCOPE_DENIED');
      expect(await cellOf(lito.id)).toBe(cellR.id);

      // It reaches the Admin, who moves them by approving it.
      expect(await queueIds(admin)).toContain(id);
      const approved = await approve(admin, id).expect(200);
      expect(await cellOf(lito.id)).toBe(approved.body.cell_uuid);
    });

    it('is refused CAPABILITY_DENIED to an approver who moves nobody, neither listed for it nor declinable', async () => {
      const sent = await submit(rosaAccount, pablo.id, [marilou.id, ...(await fresh())]).expect(
        201,
      );
      const id = sent.body.id as string;

      expect(await queueIds(ginaAccount)).not.toContain(id);
      expect(codeOf(await approve(ginaAccount, id).expect(403))).toBe('CAPABILITY_DENIED');
      expect(codeOf(await decline(ginaAccount, id).expect(403))).toBe('CAPABILITY_DENIED');
      expect(await cellOf(marilou.id)).toBe(cellC.id);
    });

    it('stays with an approver who moves nobody when it names nobody in a Cell', async () => {
      const sent = await submit(
        rosaAccount,
        pablo.id,
        (await createRequestMembers(db, 'MENS')).ids,
      ).expect(201);
      const id = sent.body.id as string;

      expect(await queueIds(ginaAccount)).toContain(id);
      await approve(ginaAccount, id).expect(200);
    });
  });
});
