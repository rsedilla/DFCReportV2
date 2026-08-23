import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp, EPOCH } from '../setup/fixtures';

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
      const response = await reassign(mark.id, { leader_id: rico.id });

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
      const body = { leader_id: rico.id };

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
  });

  describe('the backdate bounds (section 5)', () => {
    it('refuses the floor own day and accepts the day it names', async () => {
      // The property: whatever date the refusal names must itself be accepted,
      // or the administrator is handed a date that will be refused again.
      const refused = await reassign(mark.id, {
        leader_id: rico.id,
        effective_date: '2026-03-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');

      const earliest: string = refused.body.error.details.earliest_effective_date;
      expect(earliest).toBe('2026-03-02');

      const accepted = await reassign(mark.id, {
        leader_id: rico.id,
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
        leader_id: rico.id,
        effective_date: '2026-05-01',
        reason: 'Recording a move that happened during the gap.',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');

      const accepted = await reassign(drifted.id, {
        leader_id: rico.id,
        effective_date: '2026-06-02',
        reason: 'Recording a move that happened during the gap.',
      });

      expect(accepted.status).toBe(200);
    });

    it('validates the edge as of the effective date, not as of now', async () => {
      // The reason the second bound exists. Nora is in the Women's Network today,
      // so an edge to her is refused — and it is refused *here*, with a date the
      // administrator can act on, rather than at COMMIT as a constraint violation.
      const response = await reassign(mark.id, {
        leader_id: nora.id,
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
      const response = await reassign(mark.id, {
        leader_id: rico.id,
        effective_date: '2019-01-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('requires a reason when backdating, and not otherwise', async () => {
      const withoutReason = await reassign(mark.id, {
        leader_id: rico.id,
        effective_date: '2026-06-01',
      });

      expect(withoutReason.status).toBe(422);
      expect(withoutReason.body.error.details.field).toBe('reason');

      // The same request without a date needs none.
      const undated = await reassign(mark.id, { leader_id: rico.id });
      expect(undated.status).toBe(200);
    });

    it('refuses an effective date in the future', async () => {
      const response = await reassign(mark.id, {
        leader_id: rico.id,
        effective_date: '2099-01-01',
        reason: 'Correcting a transfer recorded late.',
      });

      expect(response.status).toBe(422);
    });

    it('writes a backdating audit entry carrying both dates', async () => {
      await reassign(mark.id, {
        leader_id: rico.id,
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
      const response = await reassign(mark.id, { leader_id: manuel.id });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('leader_id');

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

      const response = await reassign(mark.id, { leader_id: rico.id });

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
      const response = await reassign(ben.id, { leader_id: rico.id }, raymondAccount);

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

      const response = await reassign(raymond.id, { leader_id: rico.id }, raymondAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toMatch(/your own pastoral assignment/);
    });

    it('exempts Admin from invariant 4, which is what section 5 says', async () => {
      // Without this the two cases above are satisfied by a check that refuses
      // everyone. Ester is Admin and has no position in the Men's tree at all.
      const response = await reassign(ben.id, { leader_id: rico.id });
      expect(response.status).toBe(200);
    });

    it('checks invariant 1 against the source leader, which the guard subsumes', async () => {
      // Under every scope this system can issue, a person inside the actor's scope
      // has their current leader inside it too — so the guard subsumes the source
      // half and no end-to-end case can reach it. Called directly, because a rule
      // section 5 states must have something that can fail on it, and because a
      // scope type added later would not be subsumed.
      const hierarchy = app.get(HierarchyService);

      // Sanity: the tree is the shape this case assumes.
      await expect(hierarchy.ancestorsOf(db, mark.id)).resolves.toEqual([
        manuel.id,
        raymond.id,
        ben.id,
        oriel.id,
      ]);

      const response = await reassign(mark.id, { leader_id: rico.id }, raymondAccount);

      // Rico is outside Raymond's subtree: the destination half refuses.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.field).toBe('leader_id');
    });
  });

  describe('a Person with no assignment at all', () => {
    it('opens one, since section 5 permits an unassigned Person', async () => {
      const unassigned = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      const response = await reassign(unassigned.id, { leader_id: rico.id });

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
