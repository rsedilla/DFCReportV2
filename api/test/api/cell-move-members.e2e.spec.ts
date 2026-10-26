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

  /** Everything a refusal says: its code, its words and its details. */
  const refusalOf = (response: request.Response): unknown => ({
    code: response.body.error?.code,
    message: response.body.error?.message,
    details: response.body.error?.details,
  });

  /** The one refusal of adding somebody the actor does not oversee (decisions 0389, 0390). */
  const OUTSIDE_SCOPE = {
    code: 'SCOPE_DENIED',
    message: 'You can add only somebody you oversee to a Cell (SKILL.md section 10).',
    details: {},
  };

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
      // Mia is beneath Corazon: since decision 0389 a leader adds only somebody they oversee.
      await addMember(corazonAccount, cellC.id, mia.id).expect(201);
      expect(await cellOf(mia.id)).toBe(cellC.id);
    });

    it('is refused adding somebody already in another Cell, which is a move, and nothing moves', async () => {
      // Mia is beneath Corazon, so the person is in his scope and the refusal is the move's.
      await enrol(mia.id, cellE.id);

      const response = await addMember(corazonAccount, cellC.id, mia.id).expect(403);
      expect(codeOf(response)).toBe('CAPABILITY_DENIED');
      expect(response.body.error.details).toEqual({ capability: 'cell.move_members' });
      expect(await cellOf(mia.id)).toBe(cellE.id);
    });

    it('is refused somebody outside its scope with one answer, in a Cell or in none (decision 0390)', async () => {
      // Lito is beneath Rosa and in her Cell; Teresa is Elena's, not Corazon's, and in no
      // Cell. Until decision 0390 Lito's refusal was the move's CAPABILITY_DENIED and
      // Teresa's SCOPE_DENIED, which told Corazon which of the two was in a Cell.
      const inACell = await addMember(corazonAccount, cellC.id, lito.id).expect(403);
      const inNoCell = await addMember(corazonAccount, cellC.id, teresa.id).expect(403);

      expect(refusalOf(inACell)).toEqual(OUTSIDE_SCOPE);
      expect(refusalOf(inNoCell)).toEqual(OUTSIDE_SCOPE);
      expect(JSON.stringify(inACell.body)).not.toContain(cellR.cellId);
      expect(await cellOf(lito.id)).toBe(cellR.id);
      expect(await cellOf(teresa.id)).toBeNull();
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
      // Beneath Elena, so in her scope, and in Rosa's Cell outside her branch: Cell
      // membership does not follow the pastoral tree. The refusal is the move's, over the
      // source Cell.
      const crossing = await createPerson(db, { firstName: 'Crossing', network: 'MENS' });
      await assignTo(db, crossing.id, mia.id);
      await enrol(crossing.id, cellR.id);

      const response = await addMember(elenaAccount, cellE.id, crossing.id).expect(403);
      expect(codeOf(response)).toBe('SCOPE_DENIED');
      expect(response.body.error.details).toEqual({ capability: 'cell.move_members' });
      expect(JSON.stringify(response.body)).not.toContain(cellR.cellId);
      expect(await cellOf(crossing.id)).toBe(cellR.id);
    });

    it('is refused somebody outside its scope with one answer, in another branch’s Cell or in none (decision 0390)', async () => {
      // Lito is Rosa's and in her Cell, outside Elena's branch; Pablo is Rosa's and in no
      // Cell. Until decision 0390 the two were both SCOPE_DENIED and told apart by the
      // message and `details.capability`.
      const inACell = await addMember(elenaAccount, cellE.id, lito.id).expect(403);
      const inNoCell = await addMember(elenaAccount, cellE.id, pablo.id).expect(403);

      expect(refusalOf(inACell)).toEqual(OUTSIDE_SCOPE);
      expect(refusalOf(inNoCell)).toEqual(OUTSIDE_SCOPE);
      expect(JSON.stringify(inACell.body)).not.toContain(cellR.cellId);
      expect(await cellOf(lito.id)).toBe(cellR.id);
      expect(await cellOf(pablo.id)).toBeNull();
    });

    it('moves a member pastorally outside its branch between two of its own Cells (decision 0389)', async () => {
      // An Admin placed somebody of Rosa's in Corazon's Cell; Elena oversees both Cells, so
      // she may move them, though she does not pastor them.
      const placed = await createPerson(db, { firstName: 'Placed', network: 'MENS' });
      await assignTo(db, placed.id, lito.id);
      await enrol(placed.id, cellC.id);

      const moved = await addMember(elenaAccount, cellE.id, placed.id).expect(201);
      expect(moved.body.moved_from_cell_id).toBe(cellC.cellId);
      expect(await cellOf(placed.id)).toBe(cellE.id);
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

    it('answers NOT_FOUND when the Admin removes from a Cell that does not exist', async () => {
      const response = await removeMember(admin, randomUUID(), lito.id).expect(404);
      expect(codeOf(response)).toBe('NOT_FOUND');
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
      (await createRequestMembers(db, 'MENS', { under: mia.id })).ids.slice(0, 2);

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
      // Beneath Corazon, so Corazon may name them (decision 0369), and in Rosa's Cell,
      // outside Elena's branch: Cell membership does not follow the pastoral tree.
      const crossing = await createPerson(db, { firstName: 'Crossing', network: 'MENS' });
      await assignTo(db, crossing.id, mia.id);
      await enrol(crossing.id, cellR.id);

      const sent = await submit(corazonAccount, mia.id, [crossing.id, ...(await fresh())]).expect(
        201,
      );
      const id = sent.body.id as string;

      expect(await queueIds(elenaAccount)).not.toContain(id);
      expect(codeOf(await approve(elenaAccount, id).expect(403))).toBe('SCOPE_DENIED');
      expect(codeOf(await decline(elenaAccount, id).expect(403))).toBe('SCOPE_DENIED');
      expect(await cellOf(crossing.id)).toBe(cellR.id);

      // It reaches the Admin, who moves them by approving it.
      expect(await queueIds(admin)).toContain(id);
      const approved = await approve(admin, id).expect(200);
      expect(await cellOf(crossing.id)).toBe(approved.body.cell_uuid);
    });

    it('is refused CAPABILITY_DENIED to an approver who moves nobody, neither listed for it nor declinable', async () => {
      // Lito is beneath Rosa and in Rosa's Cell, which Gina may not move anybody out of.
      const sent = await submit(rosaAccount, pablo.id, [
        lito.id,
        ...(await createRequestMembers(db, 'MENS', { under: pablo.id })).ids.slice(0, 2),
      ]).expect(201);
      const id = sent.body.id as string;

      expect(await queueIds(ginaAccount)).not.toContain(id);
      expect(codeOf(await approve(ginaAccount, id).expect(403))).toBe('CAPABILITY_DENIED');
      expect(codeOf(await decline(ginaAccount, id).expect(403))).toBe('CAPABILITY_DENIED');
      expect(await cellOf(lito.id)).toBe(cellR.id);
    });

    it('locks each named member’s current Cell before writing anything', async () => {
      // Section 5's order: approval takes a named member's current Cell in its one sorted
      // `cells` lock call, before it writes. Hold that row. The outcome alone cannot tell
      // whether approval took it up front: migration 0009's membership trigger takes the
      // same row `FOR SHARE` at commit, so approval waits either way. What the up-front lock
      // decides is **when** it waits, so this reads `pg_locks` while it waits: it must hold
      // no lock on `cell_leaderships`, the table it writes once its locks are taken.
      const sent = await submit(corazonAccount, mia.id, [marilou.id, ...(await fresh())]).expect(
        201,
      );

      let release!: () => void;
      let locked!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      let holderPid!: number;
      const holder = db.transaction().execute(async (trx) => {
        await sql`SELECT id FROM cells WHERE id = ${cellC.id}::uuid FOR NO KEY UPDATE`.execute(trx);
        holderPid = (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx))
          .rows[0].pid;
        locked();
        await held;
      });

      await isLocked;
      // Its own connection, so the probe never waits on the pool the holder is using.
      const probe = createTestDb();
      let settled = false;
      const pending = approve(elenaAccount, sent.body.id as string).then((response) => {
        settled = true;
        return response;
      });

      let waiter: number | undefined;
      let writtenWhileWaiting: number | undefined;
      try {
        // The approval's backend: the one the holder blocks (`pg_blocking_pids`), which no
        // other backend on the server can be, as `test/setup/concurrency.ts` requires.
        while (waiter === undefined && !settled) {
          const rows = await sql<{ pid: number }>`
            SELECT pid FROM pg_stat_activity
             WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
             LIMIT 1`.execute(probe);
          waiter = rows.rows[0]?.pid;
          if (waiter === undefined) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }

        if (waiter !== undefined) {
          const written = await sql<{ n: number }>`
            SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
             WHERE l.pid = ${waiter} AND c.relname = 'cell_leaderships'`.execute(probe);
          writtenWhileWaiting = written.rows[0].n;
        }
      } finally {
        release();
        await holder;
        await probe.destroy();
      }
      const response = await pending;

      expect(waiter).toBeDefined();
      expect(writtenWhileWaiting).toBe(0);

      // Released inside its lock bound, the approval goes on and moves her.
      expect(response.status).toBe(200);
      expect(await cellOf(marilou.id)).toBe(response.body.cell_uuid);
    });

    it('refuses an approver for the request’s own reasons before anything about its members', async () => {
      // Teresa is Elena's direct disciple, so the request goes to the Admin (decision 0352)
      // whatever its members; Lito's Cell is outside Elena's branch too. The refusal must be
      // the first, so it says nothing about where a member is (section 7, decision 0193).
      const sent = await submit(orielAccount, teresa.id, [lito.id, ...(await fresh())]).expect(201);

      for (const response of [
        await approve(elenaAccount, sent.body.id as string).expect(403),
        await decline(elenaAccount, sent.body.id as string).expect(403),
      ]) {
        expect(codeOf(response)).toBe('SCOPE_DENIED');
        expect(response.body.error.details).toEqual({ capability: 'cell.approve_leadership' });
      }
    });

    it('stays with an approver who moves nobody when it names nobody in a Cell', async () => {
      const sent = await submit(
        rosaAccount,
        pablo.id,
        (await createRequestMembers(db, 'MENS', { under: pablo.id })).ids,
      ).expect(201);
      const id = sent.body.id as string;

      expect(await queueIds(ginaAccount)).toContain(id);
      await approve(ginaAccount, id).expect(200);
    });
  });
});
