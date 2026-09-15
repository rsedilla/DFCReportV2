import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestCell, TestPerson } from '../setup/fixtures';

/**
 * A person's current Cell, and the Cells they lead (SKILL.md sections 8 and 10; decision
 * 0248).
 *
 * `GET /api/v1/cells/people/{id}/membership` is guarded by `cell.view_subtree` against the
 * person and names no period, so it asks about now. These cases pin who may read it, that
 * it reads open rows only, that membership and leadership come back apart, and that a
 * reader holding the person in scope sees a Cell led outside that scope without seeing the
 * Cell's other members.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('a person’s current Cell (sections 8 and 10, decision 0248)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Raymond (root) -> Manuel -> Mark, Raymond -> Joel -> Peter, Raymond -> Norma -> Tessa.
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let joel: TestPerson;
  let peter: TestPerson;
  let norma: TestPerson;
  let tessa: TestPerson;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let normaAccount: TestAccount;

  let manuelCell: TestCell;
  let joelCell: TestCell;

  /** Long enough ago that a Cell created here has history behind it. */
  const CREATED = new Date('2020-01-04T10:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', lastName: 'Uy', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Tan', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Sy', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    joel = await createPerson(db, { firstName: 'Joel', lastName: 'Lim', network: 'MENS' });
    await assignTo(db, joel.id, raymond.id);

    peter = await createPerson(db, { firstName: 'Peter', lastName: 'Go', network: 'MENS' });
    await assignTo(db, peter.id, joel.id);

    norma = await createPerson(db, { firstName: 'Norma', lastName: 'Chua', network: 'MENS' });
    await assignTo(db, norma.id, raymond.id);

    tessa = await createPerson(db, { firstName: 'Tessa', lastName: 'Ong', network: 'MENS' });
    await assignTo(db, tessa.id, norma.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    normaAccount = await createAccount(app, db, { person: norma, roles: [] });

    manuelCell = await createCell(db, { leader: manuel, createdAt: CREATED });
    joelCell = await createCell(db, { leader: joel, createdAt: CREATED });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  const joinCell = async (person: TestPerson, cell: TestCell): Promise<void> => {
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: cell.id, started_at: CREATED })
      .execute();
  };

  const cellsOf = (account: TestAccount, personId: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/cells/people/${personId}/membership`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  // ---------------------------------------------------------------------------
  // What it returns
  // ---------------------------------------------------------------------------

  it('returns a member’s Cell with its current leader, and no Cells led', async () => {
    await joinCell(mark, manuelCell);

    const response = await cellsOf(admin, mark.id).expect(200);

    expect(response.body).toEqual({
      person_id: mark.id,
      membership: {
        id: manuelCell.id,
        cell_id: manuelCell.cellId,
        leader: {
          person_id: manuel.id,
          member_id: expect.any(String),
          full_name: expect.stringContaining('Manuel'),
        },
      },
      leads: [],
    });
  });

  it('returns the Cells a leader leads apart from membership, to the leader themselves', async () => {
    const second = await createCell(db, { leader: manuel, createdAt: CREATED });

    const response = await cellsOf(manuelAccount, manuel.id).expect(200);

    expect(response.body.membership).toBeNull();
    expect(response.body.leads).toEqual(
      [manuelCell, second]
        .sort((a, b) => a.cellId.localeCompare(b.cellId))
        .map((cell) => ({ id: cell.id, cell_id: cell.cellId })),
    );
  });

  it('returns a membership and the Cells led together, for a person who holds both', async () => {
    // Manuel leads his own Cell and belongs to Joel's, which nothing refuses (decision 0248).
    await joinCell(manuel, joelCell);

    const response = await cellsOf(admin, manuel.id).expect(200);

    expect(response.body.membership).toMatchObject({
      id: joelCell.id,
      cell_id: joelCell.cellId,
      leader: { person_id: joel.id },
    });
    expect(response.body.leads).toEqual([{ id: manuelCell.id, cell_id: manuelCell.cellId }]);
  });

  it('returns neither for a person who belongs to no Cell and leads none', async () => {
    const response = await cellsOf(admin, tessa.id).expect(200);

    expect(response.body).toEqual({ person_id: tessa.id, membership: null, leads: [] });
  });

  it('ignores a membership and a leadership that have ended', async () => {
    await joinCell(peter, joelCell);
    await closeCellDirectly(db, joelCell.id, { reason: 'MEMBERS_DISPERSED' });

    const member = await cellsOf(admin, peter.id).expect(200);
    expect(member.body.membership).toBeNull();

    const leader = await cellsOf(admin, joel.id).expect(200);
    expect(leader.body.leads).toEqual([]);
  });

  it('names the leader the Cell has now, after a handover', async () => {
    await joinCell(mark, joelCell);

    await db.transaction().execute(async (trx) => {
      const at = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(trx)).rows[0]
        .now;

      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', joelCell.id)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ person_id: peter.id, cell_id: joelCell.id, started_at: at })
        .execute();
    });

    const response = await cellsOf(admin, mark.id).expect(200);

    expect(response.body.membership.leader.person_id).toBe(peter.id);
  });

  // ---------------------------------------------------------------------------
  // Who may read it
  // ---------------------------------------------------------------------------

  it('shows a Cell led outside the reader’s scope, and nothing of its other members', async () => {
    // Mark is in Manuel's subtree; Joel and Peter are not.
    await joinCell(mark, joelCell);
    await joinCell(peter, joelCell);

    const response = await cellsOf(manuelAccount, mark.id).expect(200);

    expect(response.body.membership).toMatchObject({
      id: joelCell.id,
      cell_id: joelCell.cellId,
      leader: { person_id: joel.id, full_name: expect.stringContaining('Joel') },
    });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(peter.id);
    expect(body).not.toContain('Peter');
  });

  it('refuses a person outside the actor’s scope, and says nothing of their Cell', async () => {
    await joinCell(peter, joelCell);

    const response = await cellsOf(manuelAccount, peter.id);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('SCOPE_DENIED');

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(joelCell.id);
    expect(body).not.toContain(joelCell.cellId);
  });

  it('answers an unknown person not found to a whole-church reader and refuses it to a leader', async () => {
    const unknown = randomUUID();

    const wholeChurch = await cellsOf(admin, unknown);
    expect(wholeChurch.status).toBe(404);
    expect(wholeChurch.body.error.code).toBe('NOT_FOUND');

    const leader = await cellsOf(manuelAccount, unknown);
    expect(leader.status).toBe(403);
    expect(leader.body.error.code).toBe('SCOPE_DENIED');
  });

  it('refuses a malformed person identifier', async () => {
    const response = await cellsOf(admin, 'not-a-uuid');

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses an account without cell.view_subtree and admits a read-only grant of it', async () => {
    await joinCell(tessa, manuelCell);

    const refused = await cellsOf(normaAccount, tessa.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CAPABILITY_DENIED');

    await db
      .insertInto('capability_grants')
      .values({
        account_id: normaAccount.id,
        capability: 'cell.view_subtree',
        scope_type: 'OWN_SUBTREE',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

    const admitted = await cellsOf(normaAccount, tessa.id).expect(200);
    expect(admitted.body.membership.id).toBe(manuelCell.id);
  });

  it('admits a Senior Pastor to a person', async () => {
    await joinCell(mark, manuelCell);

    // Section 7 names the two Senior Pastors from configuration, so the fixture says who.
    const oriel = await createPerson(db, { firstName: 'Oriel', network: 'WOMENS' });
    nameSeniorPastors(app, [oriel.id]);
    const orielAccount = await createAccount(app, db, {
      person: oriel,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });

    const response = await cellsOf(orielAccount, mark.id).expect(200);
    expect(response.body.membership.id).toBe(manuelCell.id);
  });

  it('holds a NETWORK grant to the person’s current Network', async () => {
    await joinCell(peter, joelCell);

    await db
      .insertInto('capability_grants')
      .values({
        account_id: normaAccount.id,
        capability: 'cell.view_subtree',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: true,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();

    // Peter is in the Men's Network and outside Norma's own subtree.
    const admitted = await cellsOf(normaAccount, peter.id).expect(200);
    expect(admitted.body.membership.id).toBe(joelCell.id);

    // The admin account's person is in the Women's Network.
    const refused = await cellsOf(normaAccount, admin.personId);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('SCOPE_DENIED');
  });
});
