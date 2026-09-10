import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
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
 * `GET /api/v1/cells/people-without-a-cell` — the attention list section 15 requires
 * (SKILL.md sections 10, 15, 19 and 22; decision 0233).
 *
 * **Authorization is exercised here rather than only in the service**, which `CLAUDE.md`
 * requires: the API is the sole authority for authorization (section 7). The guard's
 * target is the actor, so reachability and membership are different questions, and every
 * case asks what an account is *answered*.
 *
 * The tree is `Raymond (root) -> Manuel -> { Mark, Nathan }`. Cells and memberships are
 * added per case, because what each one is about is who is left out.
 *
 * Fixture names and email addresses are invented (`CLAUDE.md`, Secrets).
 */
describe('people without a Cell (sections 10, 15 and 19)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nathan: TestPerson;

  let admin: TestAccount;
  let markAccount: TestAccount;

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

    nathan = await createPerson(db, { firstName: 'Nathan', lastName: 'Ramos', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** Opens a membership, which is what takes somebody off this list. */
  const joinCell = async (person: TestPerson, cell: TestCell): Promise<void> => {
    await db
      .insertInto('cell_memberships')
      .values({ person_id: person.id, cell_id: cell.id, started_at: CREATED })
      .execute();
  };

  /** Archives a Person: the open lifecycle row closes and the ARCHIVED one opens. */
  const archive = async (person: TestPerson): Promise<void> => {
    const at = new Date();

    await db
      .updateTable('person_lifecycle')
      .set({ ended_at: at })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();

    await db
      .insertInto('person_lifecycle')
      .values({ person_id: person.id, state: 'ARCHIVED', started_at: at })
      .execute();
  };

  const list = async (
    as: TestAccount,
    query: Record<string, string | number> = {},
  ): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/cells/people-without-a-cell')
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  const idsOf = (response: request.Response): string[] =>
    (response.body.data as { id: string }[]).map((row) => row.id).sort();

  // ---------------------------------------------------------------------------
  // The condition
  // ---------------------------------------------------------------------------

  it('lists everyone holding no membership, and names them', async () => {
    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual(
      [raymond.id, manuel.id, mark.id, nathan.id, admin.personId].sort(),
    );
    expect(response.body.data[0]).toMatchObject({ full_name: expect.any(String) });
  });

  it('does not list somebody who holds an open membership', async () => {
    const cell = await createCell(db, { leader: mark, createdAt: CREATED });
    await joinCell(nathan, cell);

    expect(idsOf(await list(admin))).not.toContain(nathan.id);
  });

  // ---------------------------------------------------------------------------
  // Leading a Cell counts as having one (decision 0233)
  // ---------------------------------------------------------------------------

  it('does not list a leader of an ACTIVE Cell, who holds no membership row', async () => {
    // The case the ruling turns on. A leader is absent from their own roster, so the
    // literal reading of section 15 would place every Cell Leader on this list.
    await createCell(db, { leader: mark, createdAt: CREATED });

    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(idsOf(response)).not.toContain(mark.id);
  });

  it('lists a leader again once their Cell is closed', async () => {
    // The exclusion keys on leading an ACTIVE Cell rather than on holding any Cell
    // relationship, so a closure puts the former leader back on the list — which is
    // right, because they now need a Cell like anybody else.
    const cell = await createCell(db, { leader: mark, createdAt: CREATED });

    expect(idsOf(await list(admin))).not.toContain(mark.id);

    await closeCellDirectly(db, cell.id, { reason: 'MEMBERS_DISPERSED' });

    expect(idsOf(await list(admin))).toContain(mark.id);
  });

  it('lists a Cell’s members once it closes, which is what fills this list', async () => {
    // **The scenario section 15 exists for**, and it was untested. Section 10 says a
    // closure must not complete without deciding where its members go, that they may be
    // left unassigned by explicit choice, and that "people left without a Cell appear in
    // the attention list in Section 15". This is that sentence, exercised.
    const cell = await createCell(db, { leader: mark, createdAt: CREATED });
    await joinCell(nathan, cell);

    expect(idsOf(await list(admin))).not.toContain(nathan.id);

    await closeCellDirectly(db, cell.id, { reason: 'MEMBERS_DISPERSED' });

    // Closure ends every membership, so the member is waiting for a Cell again — and so
    // is the leader, for the separate reason the case above pins.
    const after = idsOf(await list(admin));

    expect(after).toContain(nathan.id);
    expect(after).toContain(mark.id);
  });

  // ---------------------------------------------------------------------------
  // The two exclusions this list shares with its sibling
  // ---------------------------------------------------------------------------

  it('does not list an archived person, because no act resolves their entry', async () => {
    await archive(nathan);

    expect(idsOf(await list(admin))).not.toContain(nathan.id);
  });

  it('does not list a merged-away person', async () => {
    await db
      .updateTable('persons')
      .set({ merged_into_id: manuel.id })
      .where('id', '=', nathan.id)
      .execute();

    expect(idsOf(await list(admin))).not.toContain(nathan.id);
  });

  // ---------------------------------------------------------------------------
  // Authorization, at the API layer
  // ---------------------------------------------------------------------------

  it('refuses an account holding no cell.view_subtree grant', async () => {
    const stranger = await createPerson(db, { firstName: 'Stranger', network: 'MENS' });
    await assignTo(db, stranger.id, raymond.id);
    const account = await createAccount(app, db, { person: stranger, roles: [] });

    expect((await list(account)).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/cells/people-without-a-cell');

    expect(response.status).toBe(401);
  });

  it('narrows to the actor’s own scope rather than the church', async () => {
    // Mark oversees nobody, so `OWN_SUBTREE` reaches himself alone. The Whole Church
    // answer above holds five people; this must not.
    const response = await list(markAccount);

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([mark.id]);
  });

  // ---------------------------------------------------------------------------
  // Ordering and pagination (sections 13, 15, 17 and 22)
  // ---------------------------------------------------------------------------

  it('orders by name rather than by anything else', async () => {
    // Ramos, Sy, Tan, Uy — alphabetical, and deliberately not the order the fixture
    // writes them in, which is Uy, Tan, Sy, Ramos. An unordered query fails this.
    const response = await list(admin, { limit: 200 });

    // Filtered by identifier rather than by name: the administrator is a fixture of
    // this file rather than part of the spine, and their surname sorts into the
    // middle of it.
    const spine = (response.body.data as { id: string; full_name: string }[])
      .filter((row) => row.id !== admin.personId)
      .map((row) => row.full_name);

    expect(spine).toEqual(['Nathan Ramos', 'Mark Sy', 'Manuel Tan', 'Raymond Uy']);
  });

  it('pages by cursor and reports the last page with a null cursor', async () => {
    const first = await list(admin, { limit: 2 });

    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_cursor).not.toBeNull();

    const next = await list(admin, { limit: 200, cursor: first.body.next_cursor as string });

    expect(next.status).toBe(200);
    expect(next.body.next_cursor).toBeNull();

    // No row appears on both pages, which is what a keyset cursor buys.
    const overlap = idsOf(first).filter((id) => idsOf(next).includes(id));
    expect(overlap).toEqual([]);
  });

  it('refuses a cursor it cannot resolve', async () => {
    // Section 22 answers a refused cursor `VALIDATION_FAILED`, which is 422 here.
    expect((await list(admin, { cursor: 'not-a-cursor' })).status).toBe(422);
  });
});
