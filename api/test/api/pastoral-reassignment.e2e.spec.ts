import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import request from 'supertest';

import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { PeopleReassignmentService } from '../../src/people/people.reassignment.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  EPOCH,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `PUT /api/v1/people/{id}/pastoral-leader` — the rules the eleven authorization
 * cases do not reach (SKILL.md sections 5, 21 and 22).
 *
 * The eleven pin authorization and pin it well. What they do not touch is
 * everything section 5 says about the *record*: the backdate bounds added for this
 * endpoint, the refusals that are not about the actor, the audit entries, and the
 * idempotency completion. Those are here.
 *
 * **Two things this file exists to pin that the eleven cannot.** Three of them pass
 * on the guard rather than on the invariant they name — the guard's target is the
 * person, so a case whose person is out of scope never reaches the domain layer at
 * all. And invariant 4's *ancestors* branch is the one check on this path that
 * fails open, reachable only by an actor holding a grant wider than their tree
 * position, which no fixture in the eleven has. Both are exercised directly below.
 *
 * Fixture names, dates and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('reassigning a pastoral leader: the record (sections 5, 21, 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Ben -> Raymond -> Manuel -> Mark, and Oriel -> Rico.
  let oriel: TestPerson;
  let ben: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let rico: TestPerson;
  let nora: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;

  /** Mark's assignment, which is the floor for every backdating case below. */
  const MARK_ASSIGNED_AT = new Date('2026-03-01T09:15:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    // Cases share an application and therefore its configuration, and one case
    // below names a Senior Pastor. Reset so no case inherits it.
    nameSeniorPastors(app, []);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    rico = await createPerson(db, { firstName: 'Rico', network: 'MENS' });
    nora = await createPerson(db, { firstName: 'Nora', network: 'WOMENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, ben.id, oriel.id);
    await assignTo(db, raymond.id, ben.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id, MARK_ASSIGNED_AT);
    await assignTo(db, rico.id, oriel.id);

    admin = await createAccount(app, db, {
      person: await createPerson(db, { firstName: 'Ester', network: 'WOMENS' }),
      roles: ['ADMIN'],
    });
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  function reassign(
    personId: string,
    body: Record<string, unknown>,
    account: TestAccount = admin,
    key: string = randomUUID(),
  ): request.Test {
    return request(app.getHttpServer())
      .put(`/api/v1/people/${personId}/pastoral-leader`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  describe('the write', () => {
    it('closes and opens at one instant, and audits the transfer', async () => {
      const response = await reassign(mark.id, { pastoral_leader_id: rico.id });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mark.id,
        pastoral_leader_id: rico.id,
        previous_pastoral_leader_id: manuel.id,
      });

      const rows = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'started_at', 'ended_at'])
        .where('person_id', '=', mark.id)
        .orderBy('started_at')
        .execute();

      expect(rows).toHaveLength(2);
      expect(rows[0].ended_at?.toISOString()).toBe(rows[1].started_at.toISOString());
      expect(rows[1].started_at.toISOString()).toBe(response.body.effective_at);
      expect(rows[1].ended_at).toBeNull();

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'before', 'after'])
        .where('target_id', '=', mark.id)
        .execute();

      // One entry, not two: nothing was backdated.
      expect(entries.map((entry) => entry.action)).toEqual(['pastoral_assignment.transferred']);
      expect(entries[0].actor_id).toBe(admin.id);
      expect(entries[0].before).toMatchObject({ leader_id: manuel.id });
      expect(entries[0].after).toMatchObject({ leader_id: rico.id });
    });

    it('replays a retry rather than reassigning twice', async () => {
      const key = randomUUID();
      const body = { pastoral_leader_id: rico.id };

      const first = await reassign(mark.id, body, admin, key);
      expect(first.status).toBe(200);

      const retry = await reassign(mark.id, body, admin, key);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);

      const rows = await db
        .selectFrom('pastoral_assignments')
        .selectAll()
        .where('person_id', '=', mark.id)
        .execute();

      expect(rows).toHaveLength(2);
    });

    it('replays a retry that spelled its identifiers in a different case', async () => {
      // **The fingerprint is the second place identifiers have to be canonical,
      // and it is reached before the first.** Interceptors run ahead of pipes, so
      // the body and path the fingerprint is taken over are exactly as the client
      // spelled them — the global boundary has not run yet.
      //
      // Left raw, one retry differing only in case hashes differently and is
      // answered `IDEMPOTENCY_KEY_REUSED`, which section 22 makes **permanent** and
      // says must never be retried. An ordinary retry from a phone on a bad
      // connection becomes a dead end, and the write it is retrying has already
      // happened. `UUID().uuidString` is uppercase on iOS by default (section 2).
      //
      // **The mutation this fails against** is deleting either canonicalization in
      // `requestPath` or the `canonicalizeIdentifiers(request.body)` argument
      // beside it. Both could be removed with the rest of the suite green, because
      // nothing else sends one key twice in two spellings.
      const key = randomUUID();

      const first = await reassign(mark.id, { pastoral_leader_id: rico.id }, admin, key);
      expect(first.status).toBe(200);

      const retry = await reassign(
        mark.id.toUpperCase(),
        { pastoral_leader_id: rico.id.toUpperCase() },
        admin,
        key,
      );

      // The stored response, not a 409 — and not a second reassignment either.
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);

      const rows = await db
        .selectFrom('pastoral_assignments')
        .selectAll()
        .where('person_id', '=', mark.id)
        .execute();

      expect(rows).toHaveLength(2);
    });
  });

  describe('the backdate bounds (section 5)', () => {
    it('refuses the floor own day and accepts the day it names', async () => {
      // The property: whatever date the refusal names must itself be accepted,
      // or the administrator is handed a date that will be refused again.
      const refused = await reassign(mark.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-03-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');

      const earliest: string = refused.body.error.details.earliest_effective_date;
      expect(earliest).toBe('2026-03-02');

      const accepted = await reassign(mark.id, {
        pastoral_leader_id: rico.id,
        effective_date: earliest,
        reason: 'Correcting a transfer recorded late.',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe(earliest);
      expect(accepted.body.effective_at).toBe('2026-03-01T16:00:00.000Z');
    });

    it('bounds a person with no open assignment by their closed periods', async () => {
      // Section 5's term (b). Without it, an effective date inside an already-closed
      // period is accepted and two rows are valid at one instant, so "who led this
      // person on date D" has two answers. The partial unique index permits it,
      // because it is partial over `ended_at IS NULL`.
      const drifted = await createPerson(db, { firstName: 'Nena', network: 'MENS' });
      const closedFrom = new Date('2026-04-01T10:00:00+08:00');
      const closedTo = new Date('2026-06-01T10:00:00+08:00');

      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: drifted.id,
          leader_id: manuel.id,
          started_at: closedFrom,
          ended_at: closedTo,
        })
        .execute();

      const refused = await reassign(drifted.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-05-01',
        reason: 'Recording a move that happened during the gap.',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');

      const accepted = await reassign(drifted.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-06-02',
        reason: 'Recording a move that happened during the gap.',
      });

      expect(accepted.status).toBe(200);
    });

    it('does not bound a reassignment by a disciple the person used to lead', async () => {
      // **The narrowing, and nothing else fails against reverting it.** Section 4's
      // term (b) reaches closed edges in either direction because the trigger it
      // guards selects them either way; this path fires a trigger that reads only
      // the row being written, so a former disciple's closed edge cannot be
      // stranded or overlapped by it.
      //
      // Manuel led Mark until today. Switch this call back to 'either-direction'
      // and Manuel's own reassignment can no longer be backdated at all.
      const movedAt = new Date();
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: movedAt })
        .where('leader_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, mark.id, rico.id, movedAt);

      const response = await reassign(manuel.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-06-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(200);
      expect(response.body.effective_date).toBe('2026-06-01');
    });

    it('bounds a closed period that carried no leader at all', async () => {
      // Section 5's term (b) deliberately does not exclude a null-`leader_id` row,
      // where section 4's does: what it prevents is two rows valid at one instant,
      // and a former root period overlaps exactly as any other does. Re-add the
      // `leader_id IS NOT NULL` restriction unconditionally and this fails.
      const formerRoot = await createPerson(db, { firstName: 'Nena', network: 'MENS' });
      const rootFrom = new Date('2026-04-01T10:00:00+08:00');
      const rootTo = new Date('2026-06-01T10:00:00+08:00');

      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: formerRoot.id,
          leader_id: null,
          started_at: rootFrom,
          ended_at: rootTo,
        })
        .execute();

      const response = await reassign(formerRoot.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-05-01',
        reason: 'Recording a move that happened during the gap.',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.details.earliest_effective_date).toBe('2026-06-02');
    });

    it('validates the edge as of the effective date, not as of now', async () => {
      // The reason the second bound exists. Nora is in the Women's Network today,
      // so an edge to her is refused — and it is refused *here*, with a date the
      // administrator can act on, rather than at COMMIT as a constraint violation.
      const response = await reassign(mark.id, {
        pastoral_leader_id: nora.id,
        effective_date: '2026-06-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses a date before the person had any Network on record', async () => {
      // Section 4: the system is authoritative for Network history only from each
      // person's encoding date forward, and the trigger raises on an unknown
      // Network rather than treating it as a match.
      //
      // **The person is chosen so the floor cannot be what refuses this.** They hold
      // no assignment at all, so their floor is empty, and their Network row begins
      // after the date submitted. Asserted against `mark`, whose floor is March
      // 2026, the case would pass with this branch deleted.
      const encodedAt = new Date('2026-02-01T00:00:00+08:00');
      const late = await createPerson(db, {
        firstName: 'Nena',
        network: 'MENS',
        startedAt: encodedAt,
      });

      const response = await reassign(late.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-01-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/no Network on record/);
      expect(response.body.error.details).not.toHaveProperty('earliest_effective_date');
    });

    it('requires a reason when backdating, and not otherwise', async () => {
      const withoutReason = await reassign(mark.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-06-01',
      });

      expect(withoutReason.status).toBe(422);
      expect(withoutReason.body.error.details.field).toBe('reason');

      // The same request without a date needs none.
      const undated = await reassign(mark.id, { pastoral_leader_id: rico.id });
      expect(undated.status).toBe(200);
    });

    it('refuses an effective date in the future', async () => {
      const response = await reassign(mark.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2099-01-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(422);
    });

    it('writes a backdating audit entry carrying both dates', async () => {
      await reassign(mark.id, {
        pastoral_leader_id: rico.id,
        effective_date: '2026-03-02',
        reason: 'Correcting a transfer recorded late.',
      }).expect(200);

      const entry = await db
        .selectFrom('audit_log')
        .select(['after', 'reason'])
        .where('target_id', '=', mark.id)
        .where('action', '=', 'effective_date.backdated')
        .executeTakeFirstOrThrow();

      const after = entry.after as Record<string, string>;
      expect(after.effective_date).toBe('2026-03-02');
      expect(after.effective_at).toBe('2026-03-01T16:00:00.000Z');
      expect(after.recorded_at).not.toBe(after.effective_at);
      expect(entry.reason).toBe('Correcting a transfer recorded late.');
    });
  });

  describe('what it refuses to record', () => {
    it('refuses a move to the leader the person already has', async () => {
      // Section 5 is silent and section 4 refuses the analogue: an audited transfer
      // whose before and after name the same leader misleads whoever reads the log,
      // and it puts a boundary in the history where nothing happened.
      const response = await reassign(mark.id, { pastoral_leader_id: manuel.id });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('pastoral_leader_id');

      const rows = await db
        .selectFrom('pastoral_assignments')
        .selectAll()
        .where('person_id', '=', mark.id)
        .execute();

      expect(rows).toHaveLength(1);
    });

    it('refuses a person absorbed by a merge', async () => {
      await db
        .updateTable('persons')
        .set({ merged_into_id: rico.id })
        .where('id', '=', mark.id)
        .execute();

      const response = await reassign(mark.id, { pastoral_leader_id: rico.id });

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/merge/i);
    });
  });

  describe('the checks the eleven reach only through the guard', () => {
    /**
     * A Whole Church grant of `people.manage_pastoral_assignment` to a Leader.
     *
     * This is the actor class invariant 4 exists for and that no fixture in the
     * eleven has: with it the guard passes over anyone, so the *only* thing left
     * standing between this leader and re-parenting their own upline is the check
     * that fails open.
     */
    async function grantManageChurchWide(account: TestAccount): Promise<void> {
      await db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: 'people.manage_pastoral_assignment',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          reason: 'Fixture: the grant that makes invariant 4 the only remaining check.',
          granted_by: admin.id,
        })
        .execute();
    }

    it('refuses a Leader re-parenting their own upline, with the guard out of the way', async () => {
      await grantManageChurchWide(raymondAccount);

      // Ben is Raymond's own leader. In the eleven this is denied by the guard,
      // because Ben is outside Raymond's subtree — so invariant 4's ancestors
      // branch is never executed there. Here the guard passes.
      const response = await reassign(ben.id, { pastoral_leader_id: rico.id }, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.message).toMatch(/upline/);

      const open = await db
        .selectFrom('pastoral_assignments')
        .select('leader_id')
        .where('person_id', '=', ben.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(open.leader_id).toBe(oriel.id);
    });

    it('refuses a Leader reassigning themselves, with the guard out of the way', async () => {
      await grantManageChurchWide(raymondAccount);

      const response = await reassign(raymond.id, { pastoral_leader_id: rico.id }, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toMatch(/your own pastoral assignment/);
    });

    it('exempts Admin from invariant 4, which is what section 5 says', async () => {
      // Without this the two cases above are satisfied by a check that refuses
      // everyone. It has to reach the exemption, which means an Admin acting on
      // **their own** Person — an Admin with no position in the tree passes
      // invariant 4 whether the exemption exists or not, which is what the first
      // version of this case did.
      const manuelAdmin = await createAccount(app, db, { person: manuel, roles: ['ADMIN'] });

      const response = await reassign(manuel.id, { pastoral_leader_id: rico.id }, manuelAdmin);

      expect(response.status).toBe(200);
      expect(response.body.previous_pastoral_leader_id).toBe(raymond.id);
    });

    it('withholds the invariant 4 exemption from a SENIOR_PASTOR section 4 does not name', async () => {
      // The identity half of section 7's `SENIOR_PASTOR` rule, on the path a
      // restore takes rather than the path provisioning takes: this role row is
      // inserted directly, so the grant-time check never ran on it.
      //
      // **This isolates `rolesFor`, which nothing else does.** The Whole Church
      // grant supplies the capability, so `grantsFor` is satisfied either way and
      // a refusal cannot be coming from there. The only thing the role row can
      // still contribute is the invariant 4 exemption, which section 5 decides by
      // role — so naming the Person is the single variable between the two halves
      // of this case.
      const manuelSeniorPastor = await createAccount(app, db, {
        person: manuel,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });
      // **`CAPABILITY_DENIED`, and it is the honest code**, asked before the grant
      // exists so that the role row is the account's only possible source of
      // authority. A refused row names nothing, so the account holds none of the
      // role's capabilities at any scope — `SCOPE_DENIED` would send an
      // administrator to widen a scope that does not exist. That is the opposite
      // of `single-scope.ts`, where the capability *is* held, and the difference
      // is what section 22's two codes are for.
      const bare = await reassign(mark.id, { pastoral_leader_id: rico.id }, manuelSeniorPastor);

      expect(bare.status).toBe(403);
      expect(bare.body.error.code).toBe('CAPABILITY_DENIED');

      await grantManageChurchWide(manuelSeniorPastor);

      const unnamed = await reassign(
        manuel.id,
        { pastoral_leader_id: rico.id },
        manuelSeniorPastor,
      );

      expect(unnamed.status).toBe(403);
      expect(unnamed.body.error.code).toBe('SCOPE_DENIED');
      expect(unnamed.body.error.message).toMatch(/your own pastoral assignment/);

      nameSeniorPastors(app, [manuel.id]);

      const named = await reassign(manuel.id, { pastoral_leader_id: rico.id }, manuelSeniorPastor);

      expect(named.status).toBe(200);
      expect(named.body.previous_pastoral_leader_id).toBe(raymond.id);
    });

    it('refuses a destination the actor does not oversee', async () => {
      // Invariant 1's destination half, end to end. Mark is inside Raymond's
      // subtree so the guard passes; Rico is outside it.
      const response = await reassign(mark.id, { pastoral_leader_id: rico.id }, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.field).toBe('pastoral_leader_id');
    });

    it('refuses a source the actor does not oversee, which no request can reach', async () => {
      // **Called directly, because no request reaches this half.**
      //
      // An earlier version of this comment said the previous version of the case
      // was not a direct call and asserted the destination label. Both halves were
      // false: every version of this case since it was written has been a direct
      // call asserting `current_leader`, the source label. Corrected rather than
      // deleted, because a false reason is worse than none.
      //
      // No request can reach it: under a subtree scope a person inside the actor's
      // scope has their current leader inside it too, and under a Network scope the
      // same-Network rule puts them in the same Network. Section 5 mandates the
      // check anyway, and a scope type added later would not be subsumed — so it
      // gets the only test that can fail against its absence.
      // **It lives in `hierarchy` and takes its coverage test as a parameter.**
      // Deciding whether an actor's scope reaches a person is `auth`'s job, and
      // `auth` answers it by asking `hierarchy` about the tree — so injecting
      // `AuthorizationService` into `hierarchy` would close a loop between the two
      // modules that decide authorization. `hierarchy` owns which endpoints must be
      // covered; `auth` owns what covered means.
      //
      // **The coverage comes from the reassignment service, not rebuilt here.** A
      // first version constructed it from `coversWith` directly, which is
      // *equivalent* rather than the same: it named the capability and the target
      // kind a second time, so changing either on the production path would have
      // left this passing against its own copy.
      const hierarchy = app.get(HierarchyService);
      const reassignment = app.get(PeopleReassignmentService);
      const authorization = app.get(AuthorizationService);
      const authority = await authorization.authorityFor(raymondAccount.id);

      const actor = { accountId: raymondAccount.id, personId: raymond.id };
      const covers = (endpointId: string): Promise<boolean> =>
        reassignment.isWithinManageScope(db, actor, authority, endpointId);

      await expect(
        hierarchy.assertBothEndpointsInScope(rico.id, manuel.id, covers),
      ).rejects.toMatchObject({ code: 'SCOPE_DENIED', details: { field: 'current_leader' } });

      // And it permits what it should, so it is not satisfied by refusing everyone.
      await expect(
        hierarchy.assertBothEndpointsInScope(manuel.id, raymond.id, covers),
      ).resolves.toBeUndefined();
    });
  });

  describe('the decision is made after the lock, not before it', () => {
    it('denies a request whose person left the actor subtree while it waited', async () => {
      // **The headline of this endpoint's authorization, and nothing else pins it.**
      // Move every authorization call back above `this.db.transaction()` and the
      // whole suite stays green except this one.
      //
      // Raymond may move Mark to Raymond, and both endpoints are his at the moment
      // he asks. While the request waits on Mark's lock, Mark is moved under Rico —
      // outside Raymond's subtree entirely. Decided beforehand, the request then
      // writes a move it is no longer authorized to make; decided after the lock,
      // it is refused.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          mark.id,
        ]);

        let settled = false;
        const pending = reassign(mark.id, { pastoral_leader_id: raymond.id }, raymondAccount).then(
          (response) => {
            settled = true;
            return response;
          },
        );

        // Wait for the request to be blocked on Mark's key, so the move below
        // genuinely lands between its authorization and its write.
        let waiting = 0;
        // Comfortably inside the 3s lock timeout, so a slow detect plus the two
        // writes below cannot turn the expected 403 into a RESOURCE_BUSY.
        const deadline = Date.now() + 1_500;
        while (Date.now() < deadline && waiting === 0) {
          const found = await holder.query<{ waiting: string }>(
            `SELECT count(*) AS waiting
               FROM pg_locks
              WHERE locktype = 'advisory'
                AND NOT granted
                AND objsubid = 1
                AND classid::bigint = ((hashtextextended($1::uuid::text, 0) >> 32) & 4294967295)
                AND objid::bigint = (hashtextextended($1::uuid::text, 0) & 4294967295)`,
            [mark.id],
          );
          waiting = Number(found.rows[0].waiting);
          if (waiting === 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        expect(waiting).toBeGreaterThan(0);
        expect(settled).toBe(false);

        // Written directly, so it takes no advisory lock and lands while the
        // request is queued behind the holder.
        const movedAt = new Date();
        await db
          .updateTable('pastoral_assignments')
          .set({ ended_at: movedAt })
          .where('person_id', '=', mark.id)
          .where('ended_at', 'is', null)
          .execute();
        await assignTo(db, mark.id, rico.id, movedAt);

        await holder.query('ROLLBACK');

        const response = await pending;

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');

        // **Which check refused, and this is the whole discrimination.** Moving the
        // authorization calls back above the transaction still produces a 403 here
        // — `assertBothEndpointsInScope` has always been inside, because it needs
        // `current`, and it would refuse on the source leader with
        // `field: 'current_leader'`. Only the person-scope re-check, which is the
        // call this commit moved, refuses with no `field` at all.
        expect(response.body.error.message).toMatch(/not over this person/);
        expect(response.body.error.details).not.toHaveProperty('field');

        // And it wrote nothing: Mark is still where the concurrent move put him.
        const open = await db
          .selectFrom('pastoral_assignments')
          .select('leader_id')
          .where('person_id', '=', mark.id)
          .where('ended_at', 'is', null)
          .executeTakeFirstOrThrow();

        expect(open.leader_id).toBe(rico.id);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });

  describe('invariant 4 is decided after the lock too', () => {
    it('denies a request whose target became the actor upline while it waited', async () => {
      // The case above pins the *scope* re-check and not this one: with a subtree
      // grant, `isWithinManageScope` refuses first and with the same message, so
      // moving `assertMayReparent` alone back above the transaction changes
      // nothing there.
      //
      // Here Raymond holds a Whole Church grant, so the scope checks all pass and
      // invariant 4 is the only thing that can refuse. Rico is not in Raymond's
      // upline when the request is authorized; while it waits, Raymond is moved
      // under Rico, and Rico becomes exactly the upline invariant 4 protects.
      await db
        .insertInto('capability_grants')
        .values({
          account_id: raymondAccount.id,
          capability: 'people.manage_pastoral_assignment',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          reason: 'Fixture: leaves invariant 4 as the only check that can refuse.',
          granted_by: admin.id,
        })
        .execute();

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          rico.id,
        ]);

        // `.then` is what dispatches it. A supertest `Test` is lazy — held without
        // one, the request is not sent until it is awaited, which here would be
        // after the lock was released, and the probe below would correctly report
        // no waiter. This repository has made that exact mistake once before
        // (`fix(test): dispatch the in-flight probe, which supertest had never
        // sent`), and CI caught it again here.
        const pending = reassign(rico.id, { pastoral_leader_id: ben.id }, raymondAccount).then(
          (response) => response,
        );

        let waiting = 0;
        const deadline = Date.now() + 1_500;
        while (Date.now() < deadline && waiting === 0) {
          const found = await holder.query<{ waiting: string }>(
            `SELECT count(*) AS waiting
               FROM pg_locks
              WHERE locktype = 'advisory'
                AND NOT granted
                AND objsubid = 1
                AND classid::bigint = ((hashtextextended($1::uuid::text, 0) >> 32) & 4294967295)
                AND objid::bigint = (hashtextextended($1::uuid::text, 0) & 4294967295)`,
            [rico.id],
          );
          waiting = Number(found.rows[0].waiting);
          if (waiting === 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        expect(waiting).toBeGreaterThan(0);

        // Raymond moves under Rico. No cycle: Rico is not below Raymond.
        const movedAt = new Date();
        await db
          .updateTable('pastoral_assignments')
          .set({ ended_at: movedAt })
          .where('person_id', '=', raymond.id)
          .where('ended_at', 'is', null)
          .execute();
        await assignTo(db, raymond.id, rico.id, movedAt);

        await holder.query('ROLLBACK');

        const response = await pending;

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect(response.body.error.message).toMatch(/upline/);

        // Rico is untouched: the request wrote nothing.
        const open = await db
          .selectFrom('pastoral_assignments')
          .select('leader_id')
          .where('person_id', '=', rico.id)
          .where('ended_at', 'is', null)
          .executeTakeFirstOrThrow();

        expect(open.leader_id).toBe(oriel.id);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });

  describe('a Person with no assignment at all', () => {
    it('opens one, since section 5 permits an unassigned Person', async () => {
      const unassigned = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      const response = await reassign(unassigned.id, { pastoral_leader_id: rico.id });

      expect(response.status).toBe(200);
      expect(response.body.previous_pastoral_leader_id).toBeNull();

      const rows = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'started_at'])
        .where('person_id', '=', unassigned.id)
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0].leader_id).toBe(rico.id);
      // Now, not backdated: an unassigned Person's first assignment takes effect
      // when it is recorded (section 5, Effective dating).
      expect(rows[0].started_at.getTime()).toBeGreaterThan(EPOCH.getTime());
    });
  });
});
