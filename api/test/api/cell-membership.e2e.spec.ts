import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { CellsMembershipService } from '../../src/cells/cells.membership.service';
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
 * Cell membership (SKILL.md section 10, Managing Cell membership).
 *
 * The database already refuses a second open membership, a cross-Network member, a
 * member on a closed Cell and a membership outliving its Cell — those are pinned in
 * `test/database/cells.spec.ts`. What is here is the endpoint's half: who may make a
 * membership change, that a move is one transaction, and the audit entries section
 * 10 requires.
 *
 * **The scope rule is the interesting one.** Section 7 resolves a Cell through its
 * leader, so section 10's list of holders — the Cell's current leader over their own
 * Cells, any leader upline of them within their own subtree, Admin, Senior Pastors —
 * falls out of the scope rather than being restated in the service.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('cell membership (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let juan: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const adminPerson = await createPerson(db, { firstName: 'Admina', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const addMember = (actor: TestAccount, cellUuid: string, personId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${cellUuid}/members`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ person_id: personId });

  const removeMember = (actor: TestAccount, cellUuid: string, personId: string) =>
    request(app.getHttpServer())
      .delete(`/api/v1/cells/${cellUuid}/members/${personId}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send();

  const openMembership = (personId: string) =>
    db
      .selectFrom('cell_memberships')
      .select(['cell_id', 'started_at'])
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .execute();

  describe('who may change a membership', () => {
    it("lets the Cell's own leader add a member", async () => {
      // Section 10's first holder, and section 7 is what makes it work: the scope
      // resolves through the Cell's leader, so Mark's OWN_SUBTREE covers his own
      // Cell without anything naming him.
      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      await addMember(account, markCell.id, juan.id).expect(201);

      expect(await openMembership(juan.id)).toEqual([
        { cell_id: markCell.id, started_at: expect.any(Date) as unknown },
      ]);
    });

    it('lets a leader upline of the Cell leader add a member', async () => {
      // Section 10's second holder. Oriel is above Mark, so Mark's Cell is inside
      // Oriel's subtree and resolves there.
      const account = await createAccount(app, db, {
        person: root,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      await addMember(account, markCell.id, juan.id).expect(201);
    });

    it('refuses a leader with no authority over the Cell', async () => {
      // A peer in another branch. Section 7 resolves the Cell through Mark, who is
      // not in this leader's subtree.
      const peer = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, peer.id, root.id);
      const account = await createAccount(app, db, {
        person: peer,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      const response = await addMember(account, markCell.id, juan.id).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await openMembership(juan.id)).toEqual([]);
    });

    it('answers identically for a Cell that is out of scope and one that does not exist', async () => {
      // **The oracle this closes is a scoped actor's, which is why the case uses
      // one.** An Admin holds Whole Church and legitimately sees that a Cell is
      // absent — they are told 404 by the handler, correctly. A Leader must not be
      // able to tell the two apart, and an earlier version of the guard let them:
      // it threw from `resolveTarget`, before `authorize`, so an absent Cell and an
      // out-of-scope one differed by message and `details`, and for an actor holding
      // no capability at all they differed by code.
      //
      // Handing `authorize` a target that resolves to nobody is what the Account path
      // already does, and it makes both refusals one refusal.
      const peer = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, peer.id, root.id);
      const outOfScope = await createCell(db, { leader: peer });

      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      const absent = await addMember(account, randomUUID(), juan.id).expect(403);
      const existing = await addMember(account, outOfScope.id, juan.id).expect(403);

      expect(absent.body.error.code).toBe('SCOPE_DENIED');
      expect(absent.body.error).toEqual(existing.body.error);
    });

    it('resolves a closed Cell through its last leader', async () => {
      // Section 7: a Cell resolves through its leader, "falling back to its last
      // leader where the Cell is closed. A closed Cell keeps its history and its
      // roster visible to the leader who led it (sections 10 and 15), which
      // resolving through a current leader it no longer has would prevent."
      //
      // **Nothing pinned the fallback**, and what implements it is the *absence of an
      // `ended_at IS NULL` filter* — not a sort key. A closed Cell holds exactly one
      // leadership row, so any ordering returns it; adding `where('ended_at','is',null)`
      // is the mutation this case reddens, and deleting an `orderBy` is not. An earlier
      // version of this comment credited the sort key, which is the third time that
      // sentence has been wrong on this branch — `cells.read.service.ts` carries the
      // correction. The refusal here is about the Cell being closed rather than about
      // scope, which is what shows the scope resolved.
      const closing = await createCell(db, { leader: mark, category: 'COUPLE' });
      await closeCellDirectly(db, closing.id, { reason: 'MEMBERS_DISPERSED' });

      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      const response = await addMember(account, closing.id, juan.id).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/closed/);
    });

    it('resolves through the row still in force where two share a start instant', async () => {
      // **The `ended_at DESC NULLS FIRST` key, which nothing else reaches.**
      // `started_at DESC` picks the right row in every ordinary history, so the
      // second key decides only the pair a section 5 correction leaves: the row
      // entered in error closed at its own start, and the right one opened at the
      // same instant. Resolving through the wrong one of those is an authorization
      // decision made against a person who never led the Cell.
      //
      // The corrected row takes the lowest possible id so the `id DESC` fallback
      // loses deterministically — without which this catches the mutant only when a
      // random UUID happens to sort low, which is not a pin.
      // **Both leaders are MENS, and the distinguisher is the subtree.** Making them
      // differ by Network would be simpler and is refused: migration 0009 will not
      // let a Cell's first leadership row be corrected across Networks, which is the
      // question slice 1 escalated. A sibling branch separates them without asking
      // that question.
      const wrong = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, wrong.id, root.id);
      const cell = await createCell(db, { leader: wrong });

      await db.transaction().execute(async (trx) => {
        await sql`
          UPDATE cell_leaderships
             SET ended_at = (SELECT created_at FROM cells WHERE id = ${cell.id})
           WHERE cell_id = ${cell.id} AND ended_at IS NULL
        `.execute(trx);
        await sql`
          INSERT INTO cell_leaderships (id, person_id, cell_id, started_at)
          SELECT '00000000-0000-4000-8000-000000000000'::uuid, ${mark.id}, id, created_at
            FROM cells WHERE id = ${cell.id}
        `.execute(trx);
      });

      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      // Mark leads it now. Resolving through the corrected-away leader would place
      // the Cell in a sibling branch that Mark's own subtree does not cover, and
      // refuse him.
      await addMember(account, cell.id, juan.id).expect(201);
    });

    it('adds somebody from outside the actor own pastoral subtree', async () => {
      // **Section 10 in terms**: "Cell membership does not have to mirror pastoral
      // assignment. A person may be pastorally under one leader and a member of
      // another leader's Cell." Resolving the guard's scope against the *member*
      // rather than the Cell would refuse exactly this, which is why it resolves
      // against the Cell.
      const stranger = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
      await assignTo(db, stranger.id, root.id);

      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      await addMember(account, markCell.id, stranger.id).expect(201);
    });
  });

  describe('moving a member', () => {
    it('closes the old membership and opens the new one at one instant', async () => {
      // Section 10: the move "closes the current membership and opens the new one
      // within a single transaction. It must never leave two open memberships, and
      // never silently drop a person out of every Cell."
      const other = await createCell(db, { leader: mark, category: 'YOUNG_PRO' });

      await addMember(admin, markCell.id, juan.id).expect(201);
      const response = await addMember(admin, other.id, juan.id).expect(201);

      // Section 22: one concept, one field name. `cell_id` is the handle
      // `CELL-000000` everywhere in this API and the UUID travels as `*_uuid`, which
      // slice 2's creation response already established — an earlier version of this
      // endpoint returned a UUID under `cell_id` and under `moved_from_cell_id`.
      //
      // **The exact handles, not their shape.** Matching `/^CELL-\d{6,}$/` on both
      // passes with the two swapped, which is the defect this case exists for.
      expect(response.body.cell_id).toBe(other.cellId);
      expect(response.body.moved_from_cell_id).toBe(markCell.cellId);
      expect(response.body.cell_uuid).toBe(other.id);
      expect(await openMembership(juan.id)).toEqual([
        { cell_id: other.id, started_at: expect.any(Date) as unknown },
      ]);

      const rows = await sql<{ same: boolean }>`
        SELECT (closed.ended_at = opened.started_at) AS same
          FROM cell_memberships closed, cell_memberships opened
         WHERE closed.person_id = ${juan.id} AND closed.ended_at IS NOT NULL
           AND opened.person_id = ${juan.id} AND opened.ended_at IS NULL
      `.execute(db);

      expect(rows.rows).toEqual([{ same: true }]);
    });

    it('refuses a move out of a Cell the actor has no authority over', async () => {
      // **The source Cell is the second object, and the guard resolves only the
      // destination.** Without this check a leader could pull anybody in the church
      // into their own Cell, ending a membership in a Cell they have nothing to do
      // with and moving that person out of another leader's denominator — the shape
      // section 5 forbids for pastoral assignment, reached through the relationship
      // section 1 keeps separate from it.
      const peer = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, peer.id, root.id);
      const peerCell = await createCell(db, { leader: peer });
      await addMember(admin, peerCell.id, juan.id).expect(201);

      const account = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
        grantedBy: admin.id,
      });

      const response = await addMember(account, markCell.id, juan.id).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(await openMembership(juan.id)).toEqual([
        { cell_id: peerCell.id, started_at: expect.any(Date) as unknown },
      ]);

      // **Section 8: no Cell membership and no Cell ID for a person outside the
      // actor's pastoral scope**, and this refusal is reached exactly for such a
      // person — the guard resolved against the destination Cell, not the member. An
      // earlier version returned the source Cell's identifier and said the person
      // belonged to one, which any Leader could use as an oracle: names are
      // church-wide, so pick a UUID out of a search and read both facts back,
      // writing nothing.
      // Both identifiers, because section 8 protects "Cell membership or Cell IDs"
      // and `CELL-000000` is what section 10 calls a Cell ID — an earlier version
      // excluded only the UUID. And the message must not assert the membership by
      // any wording, which is checked against the whole body rather than against one
      // phrase.
      const body = JSON.stringify(response.body);
      expect(body).not.toContain(peerCell.id);
      expect(body).not.toContain(peerCell.cellId);
      // The message must not assert the person is in a Cell. It may say what it
      // refused — "that membership change" discloses nothing, because the actor named
      // the person and the destination themselves.
      expect(response.body.error.message).not.toMatch(/belongs to|is a member of|is in a Cell/i);
    });

    it('lets Admin move somebody between two leaders Cells', async () => {
      // The same move Admin may make, so the refusal above is about scope rather
      // than about the operation.
      const peer = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
      await assignTo(db, peer.id, root.id);
      const peerCell = await createCell(db, { leader: peer });
      await addMember(admin, peerCell.id, juan.id).expect(201);

      await addMember(admin, markCell.id, juan.id).expect(201);

      expect(await openMembership(juan.id)).toEqual([
        { cell_id: markCell.id, started_at: expect.any(Date) as unknown },
      ]);
    });

    it('refuses adding somebody who already belongs to this Cell', async () => {
      // Section 4 refuses a correction that changes nothing and section 5 a
      // reassignment to the leader a person already has, both because an audited
      // operation with identical before and after misleads whoever reads the log —
      // and here it would put a boundary in the membership history where nothing
      // happened.
      await addMember(admin, markCell.id, juan.id).expect(201);

      const response = await addMember(admin, markCell.id, juan.id).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(await openMembership(juan.id)).toHaveLength(1);
    });
  });

  describe('refusals about the person', () => {
    it('refuses an archived person', async () => {
      const archived = await createPerson(db, {
        firstName: 'Ana',
        network: 'MENS',
        archived: true,
      });

      const response = await addMember(admin, markCell.id, archived.id).expect(409);

      expect(response.body.error.message).toMatch(/archived/);
    });

    it('refuses a person absorbed by a merge', async () => {
      const survivor = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
      const absorbed = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
      await db
        .updateTable('persons')
        .set({ merged_into_id: survivor.id })
        .where('id', '=', absorbed.id)
        .execute();

      const response = await addMember(admin, markCell.id, absorbed.id).expect(409);

      expect(response.body.error.message).toMatch(/merge/);
    });

    it('refuses a member of the other Network, with a sentence rather than a trigger', async () => {
      // The database refuses it too (migration 0009), as a *deferred* trigger — so
      // it raises at COMMIT as a raw `check_violation` that the exception filter does
      // not recognise, and the caller got `INTERNAL_ERROR` until this check existed.
      //
      // **The exact code is asserted, not merely "not 500".** `not.toBe('INTERNAL_ERROR')`
      // also passes for `NOT_FOUND` and `VALIDATION_FAILED`, so it would have been
      // satisfied by refusing for the wrong reason.
      const ana = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });

      const response = await addMember(admin, markCell.id, ana.id).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/same Network/);
      expect(response.body.error.details).toMatchObject({
        member_network: 'WOMENS',
        cell_network: 'MENS',
      });
    });
  });

  describe('removing a member', () => {
    it('ends the membership and leaves the record', async () => {
      // Section 10: removal is ordinary, and the record is preserved in full. The row
      // is closed rather than deleted — migration 0009 refuses a DELETE.
      await addMember(admin, markCell.id, juan.id).expect(201);

      await removeMember(admin, markCell.id, juan.id).expect(200);

      expect(await openMembership(juan.id)).toEqual([]);

      const all = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', '=', juan.id)
        .execute();

      expect(all).toHaveLength(1);
    });

    it('refuses removing somebody who holds no membership at all', async () => {
      await removeMember(admin, markCell.id, juan.id).expect(404);
    });

    it('refuses removing somebody whose membership is in another Cell', async () => {
      // **The whole cross-Cell authorization of this route**, and nothing pinned it.
      // The guard resolves scope against the Cell in the path only, so without the
      // `current.cell_uuid !== cellId` clause a leader scoped to their own Cell could
      // end a membership held anywhere in the church by naming their own Cell in the
      // path and somebody else's member in it. The case it replaces gave Juan no
      // membership at all, so it entered the `!current` branch and left the clause
      // unfalsifiable.
      const other = await createCell(db, { leader: mark, category: 'YOUNG_PRO' });
      await addMember(admin, other.id, juan.id).expect(201);

      await removeMember(admin, markCell.id, juan.id).expect(404);

      expect(await openMembership(juan.id)).toEqual([
        { cell_id: other.id, started_at: expect.any(Date) as unknown },
      ]);
    });

    it('refuses a person_id that is not a UUID, rather than answering 500', async () => {
      // Section 7: "a route with a path parameter the guard does not resolve against
      // must validate it itself… reaching a `uuid` comparison with one produces a
      // database error rather than an answer." The guard resolves the Cell and
      // nothing else, so before this was validated the value reached a `uuid` column
      // and `22P02` rendered `INTERNAL_ERROR`.
      const response = await request(app.getHttpServer())
        .delete(`/api/v1/cells/${markCell.id}/members/not-a-uuid`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send();

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('the audit trail section 10 requires', () => {
    it('records an add and a move, with the move naming both Cells', async () => {
      // Section 21 names three membership actions — "added, moved, or ended" — and
      // asks for one entry per action performed. A move is one action, so it is one
      // entry rather than an ending plus an opening: a reader searching for moves
      // has something to search on, and a reader asking who left a Cell finds it in
      // that entry's `before`.
      //
      // **Ordered by `id` as well as `occurred_at`.** These two entries come from two
      // requests, so their `occurred_at` values do differ and the second key is inert
      // *here* — an earlier comment justified it by an intra-transaction tie, which
      // is not this case. It is kept because `audit_log.occurred_at` defaults to
      // `now()`, which is transaction start, so any case reading two entries written
      // by one request would tie; leaving the ordering total costs nothing and stops
      // the next such case passing on heap order.
      const other = await createCell(db, { leader: mark, category: 'COUPLE' });

      await addMember(admin, markCell.id, juan.id).expect(201);
      await addMember(admin, other.id, juan.id).expect(201);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'target_id', 'before', 'after'])
        .where('action', 'in', ['cell_membership.added', 'cell_membership.moved'])
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();

      expect(entries.map((e) => e.action)).toEqual([
        'cell_membership.added',
        'cell_membership.moved',
      ]);
      expect(entries.every((e) => e.actor_id === admin.id && e.target_id === juan.id)).toBe(true);

      const moved = entries[1];
      expect((moved.before as Record<string, unknown>).cell_uuid).toBe(markCell.id);
      expect((moved.after as Record<string, unknown>).cell_uuid).toBe(other.id);
    });

    it('records a removal as an ending with no destination', async () => {
      await addMember(admin, markCell.id, juan.id).expect(201);
      await removeMember(admin, markCell.id, juan.id).expect(200);

      const entry = await db
        .selectFrom('audit_log')
        .select(['before', 'after'])
        .where('action', '=', 'cell_membership.ended')
        .executeTakeFirstOrThrow();

      // An ending names the Cell left and nothing else. A move is its own action
      // (section 21), so "ended" means left with no Cell rather than moved.
      expect((entry.before as Record<string, unknown>).cell_uuid).toBe(markCell.id);
      expect(entry.after).toEqual({ ended_at: expect.any(String) as unknown });
    });
  });

  it('stamps the membership after acquiring the lock, not when the request arrived', async () => {
    // **The defect the person lock itself introduced, and nothing pinned it.**
    // `now()` is *transaction start*, which is before the lock is waited for — so a
    // request that queued behind another writer stamped its rows with the instant it
    // arrived. A request waking to find a membership opened while it waited would
    // then close that row at an instant before the row began, violating
    // `cell_memberships_period_ordered` and answering 500.
    //
    // Held from a separate connection on the same advisory key `lockPersonsWithin`
    // uses, so the wait is real rather than simulated; the assertion is that the
    // instant recorded is after the lock was released, which `now()` cannot satisfy
    // and `clock_timestamp()` does.
    const blocker = await openClient();

    try {
      await blocker.query('BEGIN');
      const { rows } = await blocker.query<{ key: string }>(
        'SELECT hashtextextended($1::uuid::text, 0) AS key',
        [juan.id],
      );
      const lockKey = rows[0].key;
      await blocker.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

      // **Dispatched, and the wait asserted.** A supertest object is lazy: an earlier
      // version held it unawaited and it was never sent, so nothing ever blocked and
      // the case passed against the defect. CLAUDE.md records that exact fault once
      // already (`19dfe3c`). Calling `.then` sends it, and the poll below is what
      // makes the contention real rather than assumed.
      const pending = addMember(admin, markCell.id, juan.id).then((r) => r);

      await waitForBlockedOn(lockKey);

      const releasedAt = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db))
        .rows[0].now;

      await blocker.query('COMMIT');

      const response = await pending;

      expect(response.status).toBe(201);
      expect(new Date(response.body.started_at as string).getTime()).toBeGreaterThanOrEqual(
        releasedAt.getTime(),
      );
    } finally {
      await blocker.end();
    }
  });

  it('refuses a mis-cased Cell identifier as the same Cell, called directly', async () => {
    // **Called through the service rather than the API, deliberately**, and the
    // 2026-08-23 ruling is why: `CanonicalIdentifierPipe` is global, so a mis-cased
    // path value never survives to the service and every end-to-end case passes
    // whether or not this check normalizes. Section 7 requires both layers, and a
    // case that only exercises the boundary pins the disjunction rather than either
    // half.
    //
    // The comparison this reaches decides whether the person is already in the Cell,
    // and it fails **open**: with `===`, a mis-cased identifier skips the refusal and
    // the membership is closed and reopened in the same Cell — the spurious history
    // boundary section 10 forbids, with a `moved` audit entry naming one Cell twice.
    //
    // The claim is a stub because the refusal happens long before `completeWithin`
    // is reached; nothing here writes.
    await addMember(admin, markCell.id, juan.id).expect(201);

    const service = app.get(CellsMembershipService);
    const actor = { accountId: admin.id, personId: admin.personId };
    const claim = { key: randomUUID(), accountId: admin.id, claimId: randomUUID() };

    await expect(service.add(markCell.id.toUpperCase(), juan.id, actor, claim)).rejects.toThrow(
      /already belongs/,
    );
  });

  it('replays the first answer for a repeated Idempotency-Key', async () => {
    const key = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post(`/api/v1/cells/${markCell.id}/members`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ person_id: juan.id });

    const first = await send().expect(201);
    const second = await send().expect(201);

    expect(second.body).toEqual(first.body);

    const all = await db
      .selectFrom('cell_memberships')
      .select('id')
      .where('person_id', '=', juan.id)
      .execute();

    expect(all).toHaveLength(1);
  });
});

/**
 * Waits until somebody is genuinely blocked on this person's advisory lock.
 *
 * **Keyed on the lock, and the first version was keyed on nothing.** It polled
 * `pg_stat_activity` for any active backend with `wait_event_type = 'Lock'`, and
 * justified that by `--runInBand` — which bounds the jest suite and not the
 * PostgreSQL instance. `pg_stat_activity` is cluster-wide, this server also carries
 * the development database, and in CI the test role is a superuser, so there every
 * blocked backend in the cluster satisfied that predicate.
 *
 * What was actually keeping it honest locally is a property of the role rather than
 * of the runner: `dfc_ci` is not a superuser, and a non-superuser reads `state` and
 * `wait_event_type` as null for other roles' backends. That stops holding the moment
 * anything else connects as the same role — a second jest process, or a dev server
 * pointed at the scratch database — and when it stops holding this returns on the
 * first poll, `releasedAt` is read before anything blocked, and the case passes
 * against the defect it exists for.
 *
 * The waiter's PID is genuinely unknown, because it is a pooled connection inside the
 * application. The **lock key is not**: the caller computes it. `pg_locks` keyed on
 * it, in this database, names exactly the wait being waited for.
 */
async function waitForBlockedOn(lockKey: string): Promise<void> {
  const probe = createTestDb();

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await sql<{ count: string }>`
        SELECT count(*) AS count
          FROM pg_locks l
          JOIN pg_database d ON d.oid = l.database
         WHERE l.locktype = 'advisory'
           AND NOT l.granted
           AND d.datname = current_database()
           AND ((l.classid::bigint << 32) | l.objid::bigint) = ${lockKey}::bigint
      `.execute(probe);

      if (Number(waiting.rows[0].count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`nothing ever blocked on advisory key ${lockKey}; the case proves nothing`);
  } finally {
    await probe.destroy();
  }
}

/** A connection of its own, for the case that must hold a lock while a request waits. */
async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
