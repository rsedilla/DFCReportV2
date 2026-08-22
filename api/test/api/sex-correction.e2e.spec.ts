import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp, EPOCH } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `PUT /api/v1/people/{id}/sex` — the audited sex correction of SKILL.md section 4.
 *
 * The rules that fail quietly here are the atomic pair and the backdate floor. A
 * correction that writes its four rows at four instants leaves a permanent
 * cross-Network edge or is rejected by a constraint nobody can act on, and a floor
 * that names the wrong day hands an administrator a date that will be refused
 * again. Both are asserted directly rather than inferred from a 200.
 *
 * The floor's *schema* behaviour is pinned separately, in
 * `test/database/backdate-floor.spec.ts`. What is asserted here is that the
 * endpoint enforces section 4's rule, which is deliberately one instant stricter
 * than the schema's.
 *
 * Fixture names, dates and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('sex correction (SKILL.md sections 4, 5, 7, 21, 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  // Men's: Oriel -> Raymond -> Manuel -> Mark. Women's: Geraldine -> Grace.
  let oriel: TestPerson;
  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let geraldine: TestPerson;
  let grace: TestPerson;

  let admin: TestAccount;
  let raymondAccount: TestAccount;

  /** Mark's assignment, which is term (a) of the floor for every case below. */
  const MARK_ASSIGNED_AT = new Date('2026-03-01T09:15:00+08:00');

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    oriel = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    geraldine = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });

    await assignTo(db, oriel.id, null);
    await assignTo(db, geraldine.id, null);
    await assignTo(db, raymond.id, oriel.id);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id, MARK_ASSIGNED_AT);
    await assignTo(db, grace.id, geraldine.id);

    admin = await createAccount(app, db, { person: oriel, roles: ['ADMIN'] });
    raymondAccount = await createAccount(app, db, { person: raymond, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  function correct(
    personId: string,
    body: Record<string, unknown>,
    account: TestAccount = admin,
    key: string = randomUUID(),
  ): request.Test {
    return request(app.getHttpServer())
      .put(`/api/v1/people/${personId}/sex`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  describe('the correction and the reassignment it forces', () => {
    it('writes all four rows at one identical instant', async () => {
      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: mark.id,
        sex: 'FEMALE',
        network: 'WOMENS',
        pastoral_leader_id: grace.id,
      });

      const networks = await db
        .selectFrom('network_assignments')
        .select(['network', 'started_at', 'ended_at', 'reason', 'actor_id'])
        .where('person_id', '=', mark.id)
        .orderBy('started_at')
        .execute();

      const assignments = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'started_at', 'ended_at'])
        .where('person_id', '=', mark.id)
        .orderBy('started_at')
        .execute();

      expect(networks).toHaveLength(2);
      expect(assignments).toHaveLength(2);

      // **The rule section 4 states, asserted as one set.** The closing of the old
      // Network row, the opening of the new one, the closing of the old edge and
      // the opening of its replacement all carry the same timestamp — and section 4
      // is explicit that the schema permits the operation at that instant and at no
      // other.
      const instants = new Set([
        networks[0].ended_at?.toISOString(),
        networks[1].started_at.toISOString(),
        assignments[0].ended_at?.toISOString(),
        assignments[1].started_at.toISOString(),
      ]);

      expect(instants.size).toBe(1);
      expect([...instants][0]).toBe(response.body.effective_at);

      expect(networks[0].network).toBe('MENS');
      expect(networks[1].network).toBe('WOMENS');
      expect(networks[1].reason).toBe('Sex entered in error at encoding.');
      expect(networks[1].actor_id).toBe(admin.id);

      expect(assignments[0].leader_id).toBe(manuel.id);
      expect(assignments[1].leader_id).toBe(grace.id);
      expect(assignments[1].ended_at).toBeNull();

      const person = await db
        .selectFrom('persons')
        .select('sex')
        .where('id', '=', mark.id)
        .executeTakeFirstOrThrow();

      expect(person.sex).toBe('FEMALE');
    });

    it('writes one audit entry per action it performed', async () => {
      await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      }).expect(200);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'actor_id', 'target_type', 'target_id', 'before', 'after', 'reason'])
        .where('target_id', '=', mark.id)
        .orderBy('action')
        .execute();

      // Three, not one and not four: section 21 lists each separately, and nothing
      // was backdated. `effective_date.backdated` has its own case below.
      expect(entries.map((entry) => entry.action)).toEqual([
        'network.changed',
        'pastoral_assignment.transferred',
        'sex.corrected',
      ]);

      for (const entry of entries) {
        expect(entry.actor_id).toBe(admin.id);
        expect(entry.target_type).toBe('person');
        expect(entry.reason).toBe('Sex entered in error at encoding.');
      }

      const transfer = entries.find((entry) => entry.action === 'pastoral_assignment.transferred')!;

      // Section 5: previous leader, new leader, and the timestamp.
      expect(transfer.before).toMatchObject({ leader_id: manuel.id });
      expect(transfer.after).toMatchObject({ leader_id: grace.id });

      const corrected = entries.find((entry) => entry.action === 'sex.corrected')!;
      expect(corrected.before).toMatchObject({ sex: 'MALE' });
      expect(corrected.after).toMatchObject({ sex: 'FEMALE' });
    });

    it('changes the Network alone where the person holds no pastoral assignment', async () => {
      // Section 5 permits a Person encoded but not yet assigned. There is nothing
      // to strand, so no leader is named and none is required.
      const unassigned = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      const response = await correct(unassigned.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ network: 'WOMENS', pastoral_leader_id: null });

      const assignments = await db
        .selectFrom('pastoral_assignments')
        .selectAll()
        .where('person_id', '=', unassigned.id)
        .execute();

      expect(assignments).toHaveLength(0);
    });

    it('replays a retry rather than correcting twice', async () => {
      const key = randomUUID();
      const body = {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      };

      const first = await correct(mark.id, body, admin, key);
      expect(first.status).toBe(200);

      const retry = await correct(mark.id, body, admin, key);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);

      // The replay is the point: a second Network row would mean the write ran
      // again (section 22).
      const networks = await db
        .selectFrom('network_assignments')
        .selectAll()
        .where('person_id', '=', mark.id)
        .execute();

      expect(networks).toHaveLength(2);
    });
  });

  describe('refused while the person leads anyone (section 4)', () => {
    it('names the disciples that must be moved first', async () => {
      // Manuel leads Mark. Section 4 refuses rather than choosing where Mark goes:
      // that is a pastoral decision, and putting it inside a data-correction form
      // is what the rule exists to prevent.
      const response = await correct(manuel.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.disciples).toEqual([
        expect.objectContaining({ id: mark.id, full_name: expect.stringContaining('Mark') }),
      ]);

      const networks = await db
        .selectFrom('network_assignments')
        .selectAll()
        .where('person_id', '=', manuel.id)
        .execute();

      expect(networks).toHaveLength(1);
    });

    it('accepts the correction once the disciples have been moved', async () => {
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: new Date() })
        .where('leader_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, mark.id, raymond.id, new Date());

      const response = await correct(manuel.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(200);
      expect(response.body.network).toBe('WOMENS');
    });
  });

  describe('the backdate floor (section 4)', () => {
    it('refuses the floor own day and accepts the day it names', async () => {
      // **The property, not a case.** Whatever date the refusal names must itself
      // be accepted; otherwise the administrator is handed a date that will be
      // refused again. An off-by-one in either direction fails one half of this.
      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: manilaDayOf(MARK_ASSIGNED_AT),
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');

      const earliest: string = refused.body.error.details.earliest_effective_date;
      expect(earliest).toBe('2026-03-02');

      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: earliest,
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe(earliest);

      // And it took effect then rather than now, which is the whole point of the
      // capability.
      const opened = await db
        .selectFrom('network_assignments')
        .select('started_at')
        .where('person_id', '=', mark.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(opened.started_at.toISOString()).toBe(accepted.body.effective_at);
    });

    it('refuses a correction backdated past a closed edge the person led', async () => {
      // Term (b), in the leader direction. Section 4's sharp consequence: moving a
      // disciple out of the way closes their edge as of today, and that `ended_at`
      // becomes the floor immediately — so clearing the blockage does not unblock
      // backdating, it fixes the effective date to today.
      const movedAt = new Date();

      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: movedAt })
        .where('leader_id', '=', manuel.id)
        .where('ended_at', 'is', null)
        .execute();
      await assignTo(db, mark.id, raymond.id, movedAt);

      const response = await correct(manuel.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-01',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');

      // **It names no date, and that is the assertion.** The floor is today, so
      // the day after it is tomorrow — and a correction cannot be dated in the
      // future. Naming it would hand back the one answer guaranteed to be refused
      // again, which is what section 4 requires the system not to do.
      expect(response.body.error.details).not.toHaveProperty('earliest_effective_date');
      expect(response.body.error.message).toMatch(/without an effective date/);

      // And the route it points at works, so the refusal is not a dead end.
      const now = await correct(manuel.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(now.status).toBe(200);
      // Compared as instants rather than as Manila days: the assertion is that it
      // took effect now, and a day comparison would flake on a run straddling
      // midnight without testing anything more.
      expect(new Date(now.body.effective_at).getTime()).toBeGreaterThanOrEqual(movedAt.getTime());
    });

    it('reaches a closed edge on which the person was the subordinate', async () => {
      // Term (b)'s `person_id` disjunct, which no other case covers at this level:
      // delete it from `backdateFloorFor` and every other floor case still passes,
      // because they all bind on term (a) or on the leader side.
      //
      // The open assignment starts before the closed edge rather than after it, so
      // term (a) cannot be what refuses this. A closed period overlapping an open
      // one is what the partial unique index permits, and is all this needs.
      const closedFrom = new Date('2026-04-01T10:00:00+08:00');
      const closedTo = new Date('2026-06-01T10:00:00+08:00');

      const person = await createPerson(db, { firstName: 'Nena', network: 'MENS' });
      await assignTo(db, person.id, manuel.id, EPOCH);
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: person.id,
          leader_id: raymond.id,
          started_at: closedFrom,
          ended_at: closedTo,
        })
        .execute();

      const refused = await correct(person.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-05-01',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');

      // Submitted back, as everywhere else here: without this the case passes
      // against a floor that refuses everything.
      const accepted = await correct(person.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-02',
      });

      expect(accepted.status).toBe(200);
    });

    it('writes a backdating audit entry carrying both dates', async () => {
      await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-03-02',
      }).expect(200);

      const entry = await db
        .selectFrom('audit_log')
        .select(['after', 'reason'])
        .where('target_id', '=', mark.id)
        .where('action', '=', 'effective_date.backdated')
        .executeTakeFirstOrThrow();

      // Section 5: "audit logged with both the recorded date and the effective
      // date". Two undefineds compare equal, so each is asserted for its shape as
      // well as its presence.
      const after = entry.after as Record<string, string>;
      expect(after.effective_date).toBe('2026-03-02');
      // The literal instant, not a value recomputed with the same function the
      // code used, which would agree with itself whatever it did. Manila midnight
      // is 16:00 UTC the previous day.
      expect(after.effective_at).toBe('2026-03-01T16:00:00.000Z');
      expect(after.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(after.effective_at).not.toBe(after.recorded_at);
      expect(entry.reason).toBe('Sex entered in error at encoding.');
    });

    it('refuses an effective date in the future', async () => {
      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2099-01-01',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('authorization (sections 5 and 7)', () => {
    it('denies a Leader who does not hold the capability at all', async () => {
      const response = await correct(
        mark.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        raymondAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
    });

    it('denies the capability granted at a scope narrower than Whole Church', async () => {
      // Mark is inside Raymond's subtree, so the **guard passes** and the refusal
      // comes from the rule under test. Without that the case would pass on the
      // guard's own SCOPE_DENIED and assert nothing.
      await db
        .insertInto('capability_grants')
        .values({
          account_id: raymondAccount.id,
          capability: 'people.correct_sex',
          scope_type: 'OWN_SUBTREE',
          scope_network: null,
          read_only: false,
          reason: 'Fixture: a grant section 7 does not permit at this scope.',
          granted_by: admin.id,
        })
        .execute();

      const response = await correct(
        mark.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        raymondAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      // The guard's own denial carries `target_kind` and says nothing about Whole
      // Church. This distinguishes the two, which share a code.
      expect(response.body.error.message).toMatch(/Whole Church/);
      expect(response.body.error.details).not.toHaveProperty('target_kind');
    });

    it('denies backdating to a holder who lacks records.backdate_effective_date', async () => {
      // The second capability, which the guard does not check: section 7's guard
      // evaluates one capability against one target, and section 5 makes
      // backdating a separate grant.
      await db
        .insertInto('capability_grants')
        .values({
          account_id: raymondAccount.id,
          capability: 'people.correct_sex',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          reason: 'Fixture: correct_sex without the power to date it in the past.',
          granted_by: admin.id,
        })
        .execute();

      const undated = await correct(
        mark.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        raymondAccount,
      );

      // The grant works, which is what makes the next assertion about backdating
      // rather than about the grant.
      expect(undated.status).toBe(200);

      const backdated = await correct(
        manuel.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
          effective_date: '2026-03-02',
        },
        raymondAccount,
      );

      expect(backdated.status).toBe(403);
      expect(backdated.body.error.code).toBe('CAPABILITY_DENIED');
      expect(backdated.body.error.details.capability).toBe('records.backdate_effective_date');
    });
  });

  describe('section 5 invariant 4: never oneself, never an upline', () => {
    /**
     * The gap the Whole Church check does not close. That one asks how far a grant
     * reaches; this asks who the actor is relative to the target — and a non-Admin
     * holding an explicit Whole Church grant passes the first and must not pass
     * the second.
     */
    async function grantCorrectSexChurchWide(account: TestAccount): Promise<void> {
      await db
        .insertInto('capability_grants')
        .values({
          account_id: account.id,
          capability: 'people.correct_sex',
          scope_type: 'WHOLE_CHURCH',
          scope_network: null,
          read_only: false,
          reason: 'Fixture: the grant section 7 reserves to Admin.',
          granted_by: admin.id,
        })
        .execute();
    }

    it('refuses a Leader correcting their own record', async () => {
      // The escalation section 7 names as the reason this capability is
      // Admin-only: correcting their own sex re-parents them under a leader they
      // choose in the other Network, detaching them from their own upline without
      // ever holding people.manage_pastoral_assignment.
      await grantCorrectSexChurchWide(raymondAccount);

      const response = await correct(
        raymond.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        raymondAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      // Distinguished from the Whole Church refusal, which shares the code and
      // would otherwise let this pass for the wrong reason.
      expect(response.body.error.message).toMatch(/your own pastoral assignment/);

      const person = await db
        .selectFrom('persons')
        .select('sex')
        .where('id', '=', raymond.id)
        .executeTakeFirstOrThrow();

      expect(person.sex).toBe('MALE');
    });

    it('refuses a Leader correcting anyone upline of them', async () => {
      await grantCorrectSexChurchWide(raymondAccount);

      const response = await correct(
        oriel.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
        },
        raymondAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.message).toMatch(/upline/);
    });

    it('exempts Admin, which is what section 5 says', async () => {
      // Without this the rule is satisfied by refusing everyone, and the two cases
      // above would pass against an implementation that never lets anybody through.
      // Mark is a leaf, so nothing else refuses this.
      const markAdmin = await createAccount(app, db, { person: mark, roles: ['ADMIN'] });

      const response = await correct(
        mark.id,
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        markAdmin,
      );

      expect(response.status).toBe(200);
    });
  });

  describe('what the correction refuses to record', () => {
    it('refuses a correction that changes nothing', async () => {
      const response = await correct(mark.id, {
        sex: 'MALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('sex');
    });

    it('requires a reason', async () => {
      const response = await correct(mark.id, {
        sex: 'FEMALE',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('requires the new leader where the person holds an open edge', async () => {
      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('pastoral_leader_id');
    });

    it('refuses a leader named where there is no reassignment to perform', async () => {
      const unassigned = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      const response = await correct(unassigned.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('pastoral_leader_id');
    });

    it('refuses a leader in the Network the person is leaving', async () => {
      // Section 4: the person being corrected moves to a leader in their **new**
      // Network. Naming their old one is the mistake this refuses, and the
      // constraint trigger would otherwise reject it at commit with a message an
      // administrator cannot act on.
      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: manuel.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('refuses an archived person who still holds a pastoral assignment', async () => {
      const archived = await createPerson(db, {
        firstName: 'Nena',
        network: 'MENS',
        archived: true,
      });
      await assignTo(db, archived.id, manuel.id, EPOCH);

      const response = await correct(archived.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/archived/i);
    });

    it('corrects an archived person who holds none', async () => {
      // Section 5 forbids reassigning an archived Person, not correcting their
      // record. With no open edge nothing is stranded.
      const archived = await createPerson(db, {
        firstName: 'Nena',
        network: 'MENS',
        archived: true,
      });

      const response = await correct(archived.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
      });

      expect(response.status).toBe(200);
      expect(response.body.network).toBe('WOMENS');
    });

    it('refuses a Network root', async () => {
      // Section 5: each Network has exactly one root, and changing who holds a
      // root position is a Network-level decision rather than a data correction.
      // Moving one here would leave one Network rootless and the other with two.
      const response = await correct(geraldine.id, {
        sex: 'MALE',
        reason: 'Sex entered in error at encoding.',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      // Not the disciple refusal, which a root would otherwise always hit first
      // and which would report the wrong reason.
      expect(response.body.error.message).toMatch(/Network root/);
    });

    it('refuses a Network root named with a new leader, for the root reason', async () => {
      // A root holds an open row whose `leader_id` is null, so the "no open
      // pastoral assignment, and no leader to name" refusal would state something
      // false about the record and would fire first. Section 4 requires a root to
      // be refused for the reason that actually applies.
      const response = await correct(geraldine.id, {
        sex: 'MALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: manuel.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/Network root/);
    });

    it('names one earliest date, not one the next refusal would reject', async () => {
      // The two bounds resolved together. This person's floor — a closed edge that
      // ended in April — lies *below* the start of the Network row they are in
      // now, which a later correction opened in June. Refusing on the floor alone
      // would name 2026-04-02, which the Network-row bound then refuses naming
      // 2026-06-02: two round trips, the second answer contradicting the first.
      const closedFrom = new Date('2026-03-01T10:00:00+08:00');
      const closedTo = new Date('2026-04-01T10:00:00+08:00');
      const networkChangedAt = new Date('2026-06-01T10:00:00+08:00');

      const person = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      // A closed edge, and no open assignment: section 4 says such a correction may
      // be backdated freely, which is what leaves the floor below the row start.
      await db
        .insertInto('pastoral_assignments')
        .values({
          person_id: person.id,
          leader_id: manuel.id,
          started_at: closedFrom,
          ended_at: closedTo,
        })
        .execute();

      // Their Network row now begins later than that floor.
      await db
        .updateTable('network_assignments')
        .set({ ended_at: networkChangedAt })
        .where('person_id', '=', person.id)
        .where('ended_at', 'is', null)
        .execute();
      await db
        .insertInto('network_assignments')
        .values({ person_id: person.id, network: 'MENS', started_at: networkChangedAt })
        .execute();

      const refused = await correct(person.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        effective_date: '2026-03-15',
      });

      expect(refused.status).toBe(409);
      // The later of the two bounds, named once.
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');

      // And submitting it succeeds, which is what makes the date the *earliest*
      // rather than merely a later one.
      const accepted = await correct(person.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        effective_date: '2026-06-02',
      });

      expect(accepted.status).toBe(200);
    });

    it('refuses an effective date at the instant the Network row itself began', async () => {
      // It would close the live Network row at its own `started_at`, and section 5
      // makes such a row inert: the period the person spent in their former
      // Network would vanish from every as-of query with nothing raised.
      //
      // Reachable precisely because section 4 says a Person with no pastoral
      // assignment has no floor and may be backdated freely. `EPOCH` is Manila
      // midnight, which is what makes the instants line up exactly.
      const unassigned = await createPerson(db, { firstName: 'Nena', network: 'MENS' });

      const response = await correct(unassigned.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        effective_date: manilaDayOf(EPOCH),
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      // The Network-row wording, not the stranded-edge one. This person holds no
      // pastoral assignment at all, and telling them they had stranded one would
      // be a message about somebody else's problem.
      expect(response.body.error.message).toMatch(/erase that period/);
      expect(response.body.error.details.earliest_effective_date).toBe('2020-01-02');

      const networks = await db
        .selectFrom('network_assignments')
        .select(['network', 'started_at', 'ended_at'])
        .where('person_id', '=', unassigned.id)
        .execute();

      // Still one open row covering a real period, rather than two rows of which
      // the first is invisible.
      expect(networks).toHaveLength(1);
      expect(networks[0].ended_at).toBeNull();
    });

    it('refuses a person who does not exist', async () => {
      const response = await correct(randomUUID(), {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
      });

      expect(response.status).toBe(404);
    });
  });
});
