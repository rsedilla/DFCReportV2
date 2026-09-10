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
  // exists to surface is what puts it out of a subtree-scoped actor's reach.
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
      lastName: 'Santos',
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
    // Santos precedes Reyes on neither ordering by chance: `Reyes` sorts before
    // `Santos`, so Juan is first.
    expect([first.body.data[0].id, next.body.data[0].id]).toEqual([juan.id, second.id]);
  });

  it('refuses a cursor it cannot resolve', async () => {
    const response = await list(admin, { cursor: 'not-a-cursor' });

    // Section 22 answers a refused cursor VALIDATION_FAILED, which is 422 here.
    expect(response.status).toBe(422);
  });
});
