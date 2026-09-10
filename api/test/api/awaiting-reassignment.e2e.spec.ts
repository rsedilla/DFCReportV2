import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { EPOCH, assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/people/awaiting-reassignment` — the attention list section 20 requires
 * (SKILL.md sections 5, 15, 19, 20 and 22; decision 0232).
 *
 * **Authorization is exercised here rather than only in the service**, which `CLAUDE.md`
 * requires: the API is the sole authority for authorization (section 7). The guard's
 * target is the actor, so reachability and membership are different questions, and every
 * case below asks what an account is *answered* rather than what a service returns.
 *
 * The tree is `Raymond (root) -> Manuel -> Mark -> Juan`, and the gap is made by closing
 * Mark's own assignment: Juan then holds an open row naming a leader who holds none, which
 * is the condition decision 0232 keys on.
 *
 * Fixture names and email addresses are invented (`CLAUDE.md`, Secrets).
 */
describe('people awaiting reassignment (sections 5, 19 and 20)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let juan: TestPerson;

  let admin: TestAccount;
  let manuelAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);

    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);

    juan = await createPerson(db, { firstName: 'Juan', lastName: 'Reyes', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);

    const adminPerson = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** Ends a person's own assignment, leaving their disciples' leader unplaced. */
  const unplace = async (person: TestPerson): Promise<void> => {
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date('2021-01-01T00:00:00+08:00') })
      .where('person_id', '=', person.id)
      .where('ended_at', 'is', null)
      .execute();
  };

  const list = async (
    as: TestAccount,
    query: Record<string, string | number> = {},
  ): Promise<request.Response> =>
    request(app.getHttpServer())
      .get('/api/v1/people/awaiting-reassignment')
      .query(query)
      .set('Authorization', `Bearer ${as.accessToken}`);

  /**
   * Archives a Person the way the lifecycle table requires: the open row is closed
   * and the ARCHIVED one opened, because `person_lifecycle_one_open` permits one.
   */
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

  const idsOf = (response: request.Response): string[] =>
    (response.body.data as { id: string }[]).map((row) => row.id).sort();

  // ---------------------------------------------------------------------------
  // The condition
  // ---------------------------------------------------------------------------

  it('lists nobody while every leader holds an assignment', async () => {
    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.next_cursor).toBeNull();
  });

  it('lists a person whose leader holds no open assignment, and names that leader', async () => {
    await unplace(mark);

    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([juan.id]);
    expect(response.body.data[0]).toMatchObject({
      id: juan.id,
      former_leader: { person_id: mark.id },
    });
  });

  it('does not list the unplaced leader themselves', async () => {
    await unplace(mark);

    // Mark holds no open row at all, so he is not a person *whose leader* has left —
    // he is the leader who left. Section 5's other list is the one that would carry
    // him, and it does not exist.
    expect(idsOf(await list(admin))).not.toContain(mark.id);
  });

  it('keys on the condition rather than on the archived flag', async () => {
    // Nobody is archived here and the gap is real: decision 0232 keys on a leader
    // holding no open assignment, of which archival is one of section 5's three
    // causes. A list keyed on lifecycle would answer empty.
    await unplace(mark);

    expect(idsOf(await list(admin))).toEqual([juan.id]);
  });

  it('does not list a root, whose row carries a null leader', async () => {
    // Raymond's row names nobody above him, which is section 5's Network root rather
    // than a gap. The join to a leader excludes it rather than a filter doing so.
    expect(idsOf(await list(admin))).not.toContain(raymond.id);
  });

  // ---------------------------------------------------------------------------
  // The one exclusion (section 5's own remedy)
  // ---------------------------------------------------------------------------

  it('excludes a person whose unplaced leader holds an ADMIN account', async () => {
    // Mark becomes an administrator outside the pastoral structure, which section 5
    // calls the correct and permanent state. Juan is then not waiting for a repair.
    await createAccount(app, db, { person: mark, roles: ['ADMIN'] });
    await unplace(mark);

    const response = await list(admin);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Authorization, at the API layer
  // ---------------------------------------------------------------------------

  it('refuses an account holding no people.view_subtree grant', async () => {
    const stranger = await createPerson(db, { firstName: 'Stranger', network: 'MENS' });
    await assignTo(db, stranger.id, raymond.id, EPOCH);
    const account = await createAccount(app, db, { person: stranger, roles: [] });

    const response = await list(account);

    expect(response.status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/people/awaiting-reassignment');

    expect(response.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Scope
  //
  // Recorded as a finding rather than asserted as a rule: see the escalation in
  // `CLAUDE.md`. Closing a leader's assignment removes them from every ancestor's
  // `subtreeOf` walk, and their disciples with them — so the very gap this list
  // exists to surface is what puts it out of reach of every actor **above the break**.
  //
  // It is not out of reach of everybody, and saying so was this branch's own worst
  // claim: that walk seeds at the actor, so the departed leader and the person
  // themselves both see the row, and a `NETWORK` grant sees the whole list because it
  // enumerates Network membership rather than walking the tree. The cases below pin
  // all three rather than the one.
  // ---------------------------------------------------------------------------

  it('answers a subtree-scoped leader an empty list, because the broken chain is what hides it', async () => {
    await unplace(mark);

    const response = await list(manuelAccount);

    expect(response.status).toBe(200);
    // Manuel is Mark's own leader and is exactly the "upline who can act" section 20
    // names. `subtreeOf` walks open rows only, so it stops at Mark and never reaches
    // Juan. Pinned as the behaviour that ships, and escalated rather than worked
    // around: the wider graph that *would* reach Juan is section 20's placement
    // graph, which decision 0214 refuses to let authorize anything.
    expect(response.body.data).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Pagination (section 22)
  // ---------------------------------------------------------------------------

  it('pages by cursor and reports the last page with a null cursor', async () => {
    await unplace(mark);

    const second = await createPerson(db, {
      firstName: 'Ana',
      lastName: 'Abad',
      network: 'MENS',
    });
    await assignTo(db, second.id, mark.id);

    const first = await list(admin, { limit: 1 });

    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.next_cursor).not.toBeNull();

    const next = await list(admin, { limit: 1, cursor: first.body.next_cursor as string });

    expect(next.status).toBe(200);
    expect(next.body.data).toHaveLength(1);
    expect(next.body.next_cursor).toBeNull();

    // Ordered by name, never by how long a gap has stood (sections 13, 15, 17).
    // **Abad sorts first and was written second**, so this distinguishes an ordered
    // query from an unordered one. It did not before: Reyes was created in
    // `beforeEach` and Santos inside the test, so alphabetical order and physical
    // row order were the same order and an unordered query passed.
    expect([first.body.data[0].id, next.body.data[0].id]).toEqual([second.id, juan.id]);
  });

  it('does not rank by how long a gap has stood', async () => {
    // The one prohibition this list ships under (sections 13, 15, 17), and it needs a
    // fixture where staleness and name disagree. Mark's break is older than Nathan's,
    // so a query ordered by staleness answers Reyes first where an alphabetical one
    // answers Abad. Without this case, ordering by staleness passes every other case
    // in this file.
    await unplace(mark);

    const nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    const recent = await createPerson(db, {
      firstName: 'Ana',
      lastName: 'Abad',
      network: 'MENS',
    });
    await assignTo(db, recent.id, nathan.id);

    // Nathan's break is newer than Mark's, which `unplace` set at 2021-01-01.
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: new Date('2024-06-01T00:00:00+08:00') })
      .where('person_id', '=', nathan.id)
      .where('ended_at', 'is', null)
      .execute();

    const response = await list(admin);

    expect(response.status).toBe(200);
    expect((response.body.data as { id: string }[]).map((row) => row.id)).toEqual([
      recent.id,
      juan.id,
    ]);
  });

  it('does not list a person whose leader is archived but still holds an open row', async () => {
    // The reverse direction of the ruling's "both directions" claim: the flag is set
    // and the gap is not there, so Juan is waiting for nothing.
    await archive(mark);

    expect((await list(admin)).body.data).toEqual([]);
  });

  it('does not list an archived person, because section 5 refuses to reassign one', async () => {
    // Section 19 asks each entry to carry the action that resolves it, and no act
    // resolves this one (decision 0229, for the sibling list).
    await unplace(mark);
    await archive(juan);

    expect((await list(admin)).body.data).toEqual([]);
  });

  it('does not list a merged-away person', async () => {
    await unplace(mark);
    await db
      .updateTable('persons')
      .set({ merged_into_id: manuel.id })
      .where('id', '=', juan.id)
      .execute();

    expect((await list(admin)).body.data).toEqual([]);
  });

  it('lists again once the leader ADMIN role is revoked', async () => {
    // The exclusion keys on a live role. A revoked one is not an administrator, so
    // the disciple is waiting again.
    const markAdmin = await createAccount(app, db, { person: mark, roles: ['ADMIN'] });
    await unplace(mark);

    expect((await list(admin)).body.data).toEqual([]);

    await db
      .updateTable('account_roles')
      .set({ revoked_at: new Date() })
      .where('account_id', '=', markAdmin.id)
      .execute();

    expect(idsOf(await list(admin))).toEqual([juan.id]);
  });

  // ---------------------------------------------------------------------------
  // Who else reaches it
  //
  // The escalation above concerns the actor section 20 names. These pin that it is
  // only that actor: a first version of the finding generalised it to "only a Whole
  // Church grant sees anything", which is false in all three directions below.
  // ---------------------------------------------------------------------------

  it('answers a NETWORK-scoped grant the whole list', async () => {
    await unplace(mark);

    const outsider = await createPerson(db, { firstName: 'Perla', network: 'MENS' });
    await assignTo(db, outsider.id, raymond.id);
    const grantee = await createAccount(app, db, { person: outsider, roles: [] });
    await db
      .insertInto('capability_grants')
      .values({
        account_id: grantee.id,
        capability: 'people.view_subtree',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: true,
        reason: 'A Network-scoped grant reaches this list without walking the tree.',
        granted_by: admin.id,
      })
      .execute();

    // Network scope is resolved by enumerating Network membership, so a break in the
    // chain hides nobody from it.
    expect(idsOf(await list(grantee))).toEqual([juan.id]);
  });

  it('answers the departed leader their own former disciple', async () => {
    await unplace(mark);
    const markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

    // The subtree walk seeds at the actor, so Mark's own walk downward is intact. It
    // is the walk from above him that is broken.
    expect(idsOf(await list(markAccount))).toEqual([juan.id]);
  });

  it('answers the person themselves', async () => {
    await unplace(mark);
    const juanAccount = await createAccount(app, db, { person: juan, roles: ['LEADER'] });

    // OWN_SUBTREE includes the actor at depth 0.
    expect(idsOf(await list(juanAccount))).toEqual([juan.id]);
  });

  it('refuses a cursor it cannot resolve', async () => {
    const response = await list(admin, { cursor: 'not-a-cursor' });

    // Section 22 answers a refused cursor VALIDATION_FAILED, which is 422 here.
    expect(response.status).toBe(422);
  });
});
