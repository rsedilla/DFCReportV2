import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { sql } from 'kysely';
import request from 'supertest';

import { holdPersonLock } from '../setup/concurrency';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
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
 * Closing a Cell (SKILL.md section 10, *What closing does*; section 11).
 *
 * The schema's own rules are pinned in `test/database/cells.spec.ts` and the lock
 * ordering in `test/database/closure-locking.spec.ts`. What is here is the
 * endpoint's half: who may close, that the decision about every member is required
 * and checked against the Cell's actual membership, what the five writes leave
 * behind, the effective-date floor, and the audit entries section 21 asks for.
 *
 * **Since decision 0355 only a Whole Church holder of `cell.manage_lifecycle` closes**,
 * which by default is Admin alone; every closure carries a note; and `MEMBERS_DISPERSED`
 * is no longer a reason a new closure may give. Cases that need a closer *below* Admin —
 * to make a destination's scope, the backdating capability or decision 0330's role check
 * actually decide something — use a Leader holding an explicit Whole Church grant of
 * `cell.manage_lifecycle` ({@link churchCloser}). That is the reading the ruling builds
 * ("the capability at Whole Church, not the `ADMIN` role"), and whether it is right is the
 * open question `CLAUDE.md` carries for direct creation; those cases rest on it.
 *
 * Fixture names and email addresses are invented (CLAUDE.md, Secrets).
 */
describe('closing a Cell (section 10)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let root: TestPerson;
  let mark: TestPerson;
  let markCell: TestCell;
  let ben: TestPerson;
  let benCell: TestCell;
  let juan: TestPerson;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);
    nameSeniorPastors(app, []);

    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const adminPerson = await createPerson(db, { firstName: 'Admina', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, root.id);
    markCell = await createCell(db, { leader: mark });

    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    await assignTo(db, ben.id, root.id);
    benCell = await createCell(db, { leader: ben });

    juan = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
    await assignTo(db, juan.id, mark.id);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** Every closure carries an explanation (decision 0355). */
  const NOTE = 'Talked through with the Senior Pastors (invented).';

  /**
   * POST a closure. A body that does not mention `note` is sent with {@link NOTE}, since
   * every closure owes one; a case about the note itself sets the key, and `note:
   * undefined` sends none at all (JSON drops it).
   */
  const close = (actor: TestAccount, cellUuid: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${cellUuid}/closure`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send('note' in body ? body : { ...body, note: NOTE });

  const grant = async (
    account: TestAccount,
    capability: 'cell.manage_lifecycle' | 'records.backdate_effective_date',
    scope: { scope_type: 'WHOLE_CHURCH' | 'OWN_SUBTREE' | 'NETWORK'; scope_network?: 'MENS' },
  ): Promise<void> => {
    await db
      .insertInto('capability_grants')
      .values({
        account_id: account.id,
        capability,
        ...scope,
        read_only: false,
        reason: 'Invented for this case (CLAUDE.md, Secrets).',
        granted_by: admin.id,
      })
      .execute();
  };

  /**
   * A Leader who may close: the role's defaults plus `cell.manage_lifecycle` at Whole
   * Church, granted explicitly. It keeps `cell.manage_membership` over its own subtree
   * only, so a destination is still bound by scope (section 10), and it holds no
   * backdating capability and no `ADMIN` role.
   */
  const churchCloser = async (person: TestPerson): Promise<TestAccount> => {
    const account = await createAccount(app, db, { person, roles: ['LEADER'] });
    await grant(account, 'cell.manage_lifecycle', { scope_type: 'WHOLE_CHURCH' });
    return account;
  };

  const addMember = async (personId: string, cellUuid: string): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/api/v1/cells/${cellUuid}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ person_id: personId })
      .expect(201);
  };

  const cellRow = (cellUuid: string) =>
    db
      .selectFrom('cells')
      .select(['state', 'closed_at', 'closure_reason', 'closure_note'])
      .where('id', '=', cellUuid)
      .executeTakeFirstOrThrow();

  const openRows = async (
    table: 'cell_leaderships' | 'cell_memberships' | 'cell_categories' | 'cell_schedules',
    cellUuid: string,
  ): Promise<number> => {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('cell_id', '=', cellUuid)
      .where('ended_at', 'is', null)
      .executeTakeFirstOrThrow();

    return Number(row.count);
  };

  describe('what closing does', () => {
    it('ends all five things at one instant', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(200);

      expect(response.body).toMatchObject({
        cell_id: markCell.cellId,
        state: 'CLOSED',
        closure_reason: 'MEMBERS_STOPPED_ATTENDING',
        members_left_unassigned: [],
      });
      expect(response.body.members_moved).toEqual([
        { person_id: juan.id, cell_id: benCell.cellId, cell_uuid: benCell.id },
      ]);

      const cell = await cellRow(markCell.id);
      expect(cell.state).toBe('CLOSED');
      expect(cell.closed_at?.toISOString()).toBe(response.body.effective_at);

      // **All four relationship and configuration tables, not the two the first
      // version of section 10 listed.** The category and schedule rows joined the
      // closure's writes on 2026-08-29, and a Cell that keeps an open schedule row
      // keeps deriving one scheduled meeting a week for ever (section 12).
      for (const table of [
        'cell_leaderships',
        'cell_memberships',
        'cell_categories',
        'cell_schedules',
      ] as const) {
        expect(await openRows(table, markCell.id)).toBe(0);
      }

      // Juan is in Ben's Cell, opened at the same instant his old one closed.
      const membership = await db
        .selectFrom('cell_memberships')
        .select(['cell_id', 'started_at'])
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(membership.cell_id).toBe(benCell.id);
      expect(membership.started_at.toISOString()).toBe(response.body.effective_at);
    });

    it('leaves a member unassigned when the decision says so', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      }).expect(200);

      expect(response.body.members_left_unassigned).toEqual([juan.id]);
      expect(response.body.members_moved).toEqual([]);

      // Section 10: closure is never blocked on placing anyone, and the people left
      // over are surfaced by section 15's attention list rather than lost.
      const anywhere = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', '=', juan.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(anywhere).toEqual([]);
    });

    it('closes a Cell with no members at all', async () => {
      // The case section 5 names as the hole in its own bound: with nobody to lock,
      // `lockPersonsWithin` returns before setting `lock_timeout`, so the closure has
      // to set it itself or take its Cell row locks unbounded.
      await close(admin, markCell.id, { reason: 'CREATED_IN_ERROR', members: [] }).expect(200);

      expect((await cellRow(markCell.id)).state).toBe('CLOSED');
    });

    it('refuses closing a Cell that is already closed', async () => {
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [],
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/never reversed or repeated/);
    });
  });

  describe('the decision about every member', () => {
    it('refuses a closure that does not name a current member', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [],
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.undecided_person_ids).toEqual([juan.id]);
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
    });

    it('refuses a closure naming somebody who is no longer a member', async () => {
      // The other half of the same rule, and the one that makes the check a version
      // check rather than a completeness check: a decision made about a list that has
      // moved on is a decision about somebody else (section 14).
      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      }).expect(409);

      expect(response.body.error.details.unknown_person_ids).toEqual([juan.id]);
    });

    it('refuses a member named twice', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [
          { person_id: juan.id, destination_cell_id: benCell.id },
          { person_id: juan.id, destination_cell_id: null },
        ],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a member dispersed into the Cell being closed', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: markCell.id }],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('requires the destination to be decided rather than omitted', async () => {
      // Section 10: members "must be dealt with explicitly rather than silently…
      // it must not complete without the decision being made and recorded". An
      // optional field would let a client leave somebody unassigned by forgetting
      // them, which is what that sentence forbids -- so `null` is a decision and an
      // absent field is not.
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id }],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      'MERGED_INTO_ANOTHER_CELL',
      'LEADER_STEPPED_DOWN',
      'LEADER_MOVED_AWAY',
      'LEADER_LEFT_THE_CHURCH',
      'LEADER_PASSED_AWAY',
      'MEMBERS_STOPPED_ATTENDING',
      'CREATED_IN_ERROR',
      'OTHER',
    ])(
      'refuses a note-less %s closure with an answer, not a constraint violation',
      async (reason) => {
        // **Every closure carries a written explanation** (decision 0355), not only
        // `OTHER` as before it. Left to the database this is a `23514` from
        // `cells_closure_explained` that nothing classifies and the caller gets
        // `INTERNAL_ERROR`; the DTO owes the answer.
        const response = await close(admin, markCell.id, {
          reason,
          note: undefined,
          members: [],
        }).expect(422);

        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(response.body.error.details)).toMatch(/note/);
        expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
      },
    );

    it.each([
      'LEADER_MOVED_AWAY',
      'LEADER_LEFT_THE_CHURCH',
      'LEADER_PASSED_AWAY',
      'MEMBERS_STOPPED_ATTENDING',
    ])('accepts %s, a reason decision 0355 added, and stores the note', async (reason) => {
      const response = await close(admin, markCell.id, {
        reason,
        note: '  He has moved to another city.  ',
        members: [],
      }).expect(200);

      expect(response.body.closure_reason).toBe(reason);
      // Trimmed before it is stored, as the DTO's transform says.
      expect(await cellRow(markCell.id)).toMatchObject({
        state: 'CLOSED',
        closure_reason: reason,
        closure_note: 'He has moved to another city.',
      });
    });

    it('refuses MEMBERS_DISPERSED for a new closure', async () => {
      // Decision 0355: retired for new closures, kept on the Cells already closed with
      // it. Refused at the edge as a value outside the closed list, so it never reaches
      // the trigger that would refuse it as a raw `check_violation`.
      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_DISPERSED',
        members: [],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(response.body.error.details)).toMatch(/reason/);
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
    });

    it('refuses a note longer than 500 characters', async () => {
      // "within the length it already had" (decision 0355, point 4).
      const response = await close(admin, markCell.id, {
        reason: 'OTHER',
        note: 'x'.repeat(501),
        members: [],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');

      await close(admin, markCell.id, {
        reason: 'OTHER',
        note: 'x'.repeat(500),
        members: [],
      }).expect(200);
    });

    it('refuses a destination that had no leader on the closure date', async () => {
      // **A backdated closure and a destination created later.**
      // `assert_membership_same_network` resolves a Cell's leader as the assignment
      // row covering the membership's `started_at`, so a membership dated February in
      // a Cell created in August has no leader to compare against and the deferred
      // trigger raises `check_violation` at COMMIT — `INTERNAL_ERROR`.
      //
      // The destination check reached for `leaderForScopeWithin`, which is section 7's
      // rule for a *scope*: current, falling back to last, ignoring dates. That agrees
      // with the trigger for every membership written at `clock_timestamp()` and parts
      // company the moment a closure is backdated. Two rules that coincide in every
      // reachable state until one operation makes them diverge is exactly what the
      // membership service's own comment says to watch for.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const closing = await createCell(db, { leader: mark, createdAt: created });

      await db
        .insertInto('cell_memberships')
        .values({ person_id: juan.id, cell_id: closing.id, started_at: created })
        .execute();

      // Ben's Cell was created today, long after the closure date.
      const response = await close(admin, closing.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'correcting the recorded date',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
        effective_date: '2026-03-02',
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/had no leader on the closure date/);
      expect((await cellRow(closing.id)).state).toBe('ACTIVE');
    });

    it('disperses into a Cell that has since changed hands', async () => {
      // The positive half of the same fix: a backdated dispersal into a Cell that
      // *did* have a leader on the effective date goes through. The case above pins
      // the refusal; this pins that the refusal is not indiscriminate.
      //
      // **It does not pin `leaderAsOfWithin`'s row selection, and a first version of
      // this comment claimed it did.** Mutating the method to ignore dates entirely
      // leaves this green, because `cell_leaderships_stay_in_network` makes every
      // leader a Cell ever has the same Network — so which of them the comparison
      // resolves to cannot change the answer. What the method's date filter decides is
      // whether there is a row at all, which is the case above. The read service says
      // the same thing in its docblock rather than leaving somebody to discover it by
      // deleting the filter.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const handedOver = new Date('2026-03-20T00:00:00+08:00');

      // Rosalio sits under the root, so he is Mark's sibling. **That placement decides
      // nothing here**, and a version of this comment said it did — that "the rejected
      // reading resolves the destination through him and refuses". This case closes as
      // `admin`, whose Whole Church grant returns true on `scopeCovers`'s first line
      // before any target is read, so no reading of the destination refuses anything.
      // The subtree staging is what makes the *Leader*-actor case below discriminate;
      // it was described here, one case up from where it is true.
      const rosa = await createPerson(db, { firstName: 'Rosalio', network: 'MENS' });
      await assignTo(db, rosa.id, root.id);

      const destination = await createCell(db, { leader: rosa, createdAt: created });
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: handedOver })
          .where('cell_id', '=', destination.id)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: ben.id, cell_id: destination.id, started_at: handedOver })
          .execute();
      });

      const closing = await createCell(db, { leader: mark, createdAt: created });
      await db
        .insertInto('cell_memberships')
        .values({ person_id: juan.id, cell_id: closing.id, started_at: created })
        .execute();

      await close(admin, closing.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'correcting the recorded date',
        members: [{ person_id: juan.id, destination_cell_id: destination.id }],
        effective_date: '2026-03-10',
      }).expect(200);

      // The leadership entry names the leader whose assignment the closure ended.
      // That is always the *open* row and never an earlier one, because the floor's
      // term (b) puts every closed leadership `ended_at` at or below the effective
      // date — so no earlier stint can still be covering it.
      const entry = await db
        .selectFrom('audit_log')
        .select('before')
        .where('action', '=', 'cell_leadership.ended')
        .executeTakeFirstOrThrow();

      expect(entry.before).toMatchObject({ cell_leader_id: mark.id });
    });

    it('refuses a whitespace-only note as validation, not a constraint violation', async () => {
      // `cells_other_requires_note` compares `btrim(...) <> ''`, and `@MinLength(1)`
      // alone accepts two spaces — so the note fix was half-closed and the same
      // `INTERNAL_ERROR` was still reachable. It also satisfied the backdating rule, so
      // a backdated closure could carry a blank explanation.
      const response = await close(admin, markCell.id, {
        reason: 'OTHER',
        note: '   ',
        members: [],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('scopes a destination by who leads it now, not by who led it then', async () => {
      // **The one testable consequence of the rule section 7 gained**, and nothing
      // pinned it: every destination case either closes as Admin, whose Whole Church
      // scope returns true before the target is read, or names a Cell that never
      // changed hands. Mutating the destination's scope check to resolve as of the
      // effective date left the whole suite green — the rule written into the source
      // of truth with nothing that could fail on it, which is this branch's own
      // recurring fault.
      //
      // The destination was Rosalio's until 20 March and is Mark's since, and the
      // closure is dated 10 March — so the two readings disagree: authority resolves
      // through Mark, who is the actor, and the rejected reading resolves through
      // Rosalio, who is his sibling and outside his subtree.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const handedOver = new Date('2026-03-20T00:00:00+08:00');

      // Under the root, so Rosalio is Mark's sibling and outside Mark's subtree: the
      // rejected reading resolves the destination through him and refuses.
      const rosa = await createPerson(db, { firstName: 'Rosalio', network: 'MENS' });
      await assignTo(db, rosa.id, root.id);

      const destination = await createCell(db, { leader: rosa, createdAt: created });
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: handedOver })
          .where('cell_id', '=', destination.id)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: mark.id, cell_id: destination.id, started_at: handedOver })
          .execute();
      });

      const closing = await createCell(db, { leader: mark, createdAt: created });
      await db
        .insertInto('cell_memberships')
        .values({ person_id: juan.id, cell_id: closing.id, started_at: created })
        .execute();

      // **A Leader, so scope is actually evaluated** — Admin's Whole Church grant
      // returns true before the target is read, which is why every earlier
      // destination case failed to discriminate. And the closure must be **backdated**,
      // because an undated one takes effect now and the two readings then agree; a
      // Leader can only backdate with an explicit grant, which section 7 permits Admin
      // to issue. Since decision 0355 a Leader closes at all only with a Whole Church
      // grant of `cell.manage_lifecycle`, which leaves `cell.manage_membership` at its
      // subtree default — so the destination is still decided by scope.
      //
      // A first version of this case used an undated closure and passed against the
      // mutation it names, which is the fault it was written to catch.
      const leader = await churchCloser(mark);
      await grant(leader, 'records.backdate_effective_date', { scope_type: 'WHOLE_CHURCH' });

      await close(leader, closing.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'correcting the recorded date',
        members: [{ person_id: juan.id, destination_cell_id: destination.id }],
        // **Before the destination's handover, which is the whole staging.** Dated
        // after it, both readings resolve to Mark and the case passes against the
        // mutation it names — which a second version of this case did.
        effective_date: '2026-03-10',
      }).expect(200);
    });

    it('refuses a member list longer than the bound', async () => {
      // Section 22 states the number and the code. Refused at the boundary, before
      // anything is locked or read, so the entries need only be well-formed.
      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: Array.from({ length: 501 }, () => ({
          person_id: randomUUID(),
          destination_cell_id: null,
        })),
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a closed destination Cell', async () => {
      await addMember(juan.id, markCell.id);
      await closeCellDirectly(db, benCell.id, { reason: 'MEMBERS_STOPPED_ATTENDING' });

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(409);

      expect(response.body.error.message).toMatch(/destination Cell is closed/);
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
    });

    it('refuses a destination in the other Network with an answer, not a 500', async () => {
      // `cell_memberships_same_network` is deferred, so left to the database this is a
      // raw `check_violation` at COMMIT rendered `INTERNAL_ERROR` -- the
      // 500-instead-of-an-answer failure this repository keeps recording. The
      // constraint stays the enforcement; the service owes the answer.
      const grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
      await assignTo(db, grace.id, null);
      const graceCell = await createCell(db, { leader: grace });

      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: graceCell.id }],
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/same Network/);
    });
  });

  describe('who may close (decision 0355)', () => {
    // Only an account holding `cell.manage_lifecycle` at Whole Church closes, checked
    // against the church as direct creation is. A Leader keeps the capability over
    // their own subtree — it is the second-object check a handover or restart makes —
    // and that grant closes nothing. The guard answers `SCOPE_DENIED` to it, because the
    // capability is held and the scope is what fails (section 7 names the half that
    // failed); a Senior Pastor, who holds no `cell.manage_lifecycle` at all, is answered
    // `CAPABILITY_DENIED`.

    const expectUntouched = async (cellUuid: string): Promise<void> => {
      const cell = await cellRow(cellUuid);
      expect(cell.state).toBe('ACTIVE');
      expect(cell.closed_at).toBeNull();
      expect(await openRows('cell_leaderships', cellUuid)).toBe(1);
      const entries = await db
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'cell.closed')
        .execute();
      expect(entries).toEqual([]);
    };

    it('lets an Admin close any Cell', async () => {
      await close(admin, benCell.id, { reason: 'LEADER_STEPPED_DOWN', members: [] }).expect(200);

      expect((await cellRow(benCell.id)).state).toBe('CLOSED');
    });

    it('refuses the Cell’s own leader, who holds the capability over their subtree', async () => {
      const leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

      const response = await close(leader, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.manage_lifecycle');
      await expectUntouched(markCell.id);
    });

    it('refuses a leader upline of the Cell’s leader', async () => {
      // Oriel -> Mark: before decision 0355 this closure went through.
      const upline = await createAccount(app, db, { person: root, roles: ['LEADER'] });

      const response = await close(upline, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      await expectUntouched(markCell.id);
    });

    it('refuses a leader closing a Cell in a branch they do not oversee', async () => {
      // Ben is Mark's sibling, so this was refused before 0355 too; the answer is the
      // same one an in-branch leader now gets, so it says nothing about the branch.
      const leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

      const outside = await close(leader, benCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);
      const inside = await close(leader, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);

      expect(outside.body.error).toEqual(inside.body.error);
      await expectUntouched(benCell.id);
    });

    it('refuses a Network-scoped grant of the capability', async () => {
      // A church target is never in scope at any value narrower than Whole Church.
      const leader = await createAccount(app, db, { person: root, roles: ['LEADER'] });
      await grant(leader, 'cell.manage_lifecycle', {
        scope_type: 'NETWORK',
        scope_network: 'MENS',
      });

      const response = await close(leader, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      await expectUntouched(markCell.id);
    });

    it('refuses a Senior Pastor, who holds no cell.manage_lifecycle', async () => {
      nameSeniorPastors(app, [root.id]);
      const pastor = await createAccount(app, db, {
        person: root,
        roles: ['SENIOR_PASTOR'],
        seniorPastorSlot: 1,
      });

      const response = await close(pastor, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
      }).expect(403);

      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      await expectUntouched(markCell.id);
    });

    it('lets a non-Admin holding the capability at Whole Church close', async () => {
      // The ruling builds "only the Admin" as the capability at Whole Church rather than
      // as the role (decision 0355, point 1). This pins that reading as built; whether
      // it is right is the open question `CLAUDE.md` records for direct creation.
      const closer = await churchCloser(ben);

      await close(closer, markCell.id, { reason: 'LEADER_STEPPED_DOWN', members: [] }).expect(200);

      expect((await cellRow(markCell.id)).state).toBe('CLOSED');
    });

    it('still lets a Leader request a handover of their own Cell, and an upline a restart', async () => {
      // The subtree default of `cell.manage_lifecycle` is kept for exactly this
      // (decision 0355, point 1): the second-object check a handover or a restart makes
      // on the Cell it names. Taking it away would have stopped both.
      const leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

      await close(leader, markCell.id, { reason: 'LEADER_STEPPED_DOWN', members: [] }).expect(403);

      const handover = await request(app.getHttpServer())
        .post('/api/v1/cells/leadership-requests')
        .set('Authorization', `Bearer ${leader.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ kind: 'HANDOVER', prospective_leader_id: juan.id, cell_id: markCell.id })
        .expect(201);

      expect(handover.body).toMatchObject({ kind: 'HANDOVER', state: 'PENDING' });

      // A restart of Ben's Cell, closed by the Admin, requested by Ben's upline Oriel.
      await close(admin, benCell.id, { reason: 'LEADER_MOVED_AWAY', members: [] }).expect(200);
      const upline = await createAccount(app, db, { person: root, roles: ['LEADER'] });

      const restart = await request(app.getHttpServer())
        .post('/api/v1/cells/leadership-requests')
        .set('Authorization', `Bearer ${upline.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          kind: 'NEW_CELL',
          prospective_leader_id: ben.id,
          category: 'YOUTH',
          day_of_week: 6,
          time_of_day: '17:00',
          restart_of_cell_id: benCell.id,
          members: (await createRequestMembers(db, 'MENS')).ids,
        });

      expect(restart.status).toBe(201);
      expect(restart.body).toMatchObject({ kind: 'NEW_CELL', state: 'PENDING' });
      expect(restart.body.restart_of_cell_uuid).toBe(benCell.id);
    });

    it('refuses a destination Cell outside the closer’s scope', async () => {
      // Section 10: "A destination Cell must be within the actor's authorized scope,
      // exactly as an ordinary move requires… they may not put people into a Cell
      // belonging to a branch they have nothing to do with."
      //
      // **The capability is `cell.manage_membership`, not the lifecycle one**, and
      // the two are asked about different Cells: authority over the Cell being closed
      // says nothing about where its members may be put. Since decision 0355 the closer
      // holds the lifecycle capability at Whole Church; this one holds the membership
      // capability over their own subtree only, and section 10 says such a closer is
      // still bound by it.
      await addMember(juan.id, markCell.id);

      const leader = await churchCloser(mark);

      const response = await close(leader, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.manage_membership');

      // Nothing was written: the closure is one transaction.
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
      expect(await openRows('cell_memberships', markCell.id)).toBe(1);
    });
  });

  describe('only an Admin may close a Cell created in error (decision 0330)', () => {
    // Section 10, *What closing does*: the closure route refuses `CREATED_IN_ERROR`
    // from anyone without the `ADMIN` role as `CAPABILITY_DENIED`. Since decision 0355 a
    // Leader reaches that check only holding `cell.manage_lifecycle` at Whole Church
    // ({@link churchCloser}); without it the guard refuses first, with `SCOPE_DENIED`.

    const closureEntries = () =>
      db
        .selectFrom('audit_log')
        .select('action')
        .where('target_id', '=', markCell.id)
        .where('action', 'in', ['cell.closed', 'cell_leadership.ended'])
        .execute();

    const expectRefusedAndUntouched = async (response: request.Response): Promise<void> => {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      expect(response.body.error.details.required_role).toBe('ADMIN');

      const cell = await cellRow(markCell.id);
      expect(cell.state).toBe('ACTIVE');
      expect(cell.closed_at).toBeNull();
      expect(cell.closure_reason).toBeNull();
      expect(await openRows('cell_leaderships', markCell.id)).toBe(1);
      expect(await openRows('cell_memberships', markCell.id)).toBe(1);
      expect(await openRows('cell_categories', markCell.id)).toBe(1);
      expect(await openRows('cell_schedules', markCell.id)).toBe(1);
      expect(await closureEntries()).toEqual([]);
    };

    it('refuses the Cell’s own leader, though they may close', async () => {
      await addMember(juan.id, markCell.id);
      const leader = await churchCloser(mark);

      const response = await close(leader, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      });

      await expectRefusedAndUntouched(response);
    });

    it('refuses a leader upline of the Cell’s leader, though they may close', async () => {
      await addMember(juan.id, markCell.id);
      // Oriel -> Mark, holding the lifecycle capability at Whole Church: the guard admits
      // the request and the refusal is the reason's alone.
      const upline = await churchCloser(root);

      const response = await close(upline, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      });

      await expectRefusedAndUntouched(response);
    });

    it('still answers SCOPE_DENIED to a leader who may not close at all', async () => {
      // The guard is decided first: an actor who may not close learns nothing about the
      // reason rule. Since decision 0355 that is every Leader without a Whole Church
      // grant, Ben (Mark's sibling) here.
      await addMember(juan.id, markCell.id);
      const sibling = await createAccount(app, db, { person: ben, roles: ['LEADER'] });

      const response = await close(sibling, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
    });

    it('lets an Admin close it as created in error', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      }).expect(200);

      expect(response.body).toMatchObject({ state: 'CLOSED', closure_reason: 'CREATED_IN_ERROR' });

      const cell = await cellRow(markCell.id);
      expect(cell.state).toBe('CLOSED');
      expect(cell.closure_reason).toBe('CREATED_IN_ERROR');
      expect((await closureEntries()).map((entry) => entry.action).sort()).toEqual([
        'cell.closed',
        'cell_leadership.ended',
      ]);
    });

    it('still lets a non-Admin closer close it for another reason', async () => {
      await addMember(juan.id, markCell.id);
      const leader = await churchCloser(mark);

      const response = await close(leader, markCell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      }).expect(200);

      expect(response.body).toMatchObject({
        state: 'CLOSED',
        closure_reason: 'MEMBERS_STOPPED_ATTENDING',
      });
      expect((await cellRow(markCell.id)).closure_reason).toBe('MEMBERS_STOPPED_ATTENDING');
    });
  });

  describe('the effective date', () => {
    const manilaToday = (): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

    it('names the day after the floor when the floor falls inside a day', async () => {
      // **The floor, which section 10 recorded as unsettled through three refuted
      // formulations.** It is the latest of: every open leadership and membership
      // row's `started_at`, and every closed one's `ended_at`. Below it the closure
      // would end a period before it began, which `period_ordered` refuses as a raw
      // constraint violation -- so the point of the floor is to answer with a date
      // rather than a 500.
      //
      // **The floor is an instant and an effective date is a Manila day**, so the
      // earliest legal date is the first Manila midnight at or after the floor. This
      // leadership starts at 08:00 Manila on 1 March -- UTC midnight, which is
      // deliberately *not* a Manila midnight -- so 1 March itself resolves to 16:00
      // UTC on 28 February, below the floor, and the earliest legal date is 2 March.
      // The case below stages a floor that *is* a Manila midnight and gets that day
      // itself; between them they pin both branches of the arithmetic, which a single
      // case would let collapse into whichever one the implementation happened to
      // take.
      const past = new Date('2026-03-01T00:00:00Z');
      await db
        .updateTable('cell_leaderships')
        .set({ started_at: past })
        .where('cell_id', '=', markCell.id)
        .execute();

      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-02-01',
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.earliest_effective_date).toBe('2026-03-02');
      expect(response.body.error.message).toMatch(/cannot be dated before 2026-03-02/);
    });

    it('accepts a date at the floor itself, because the floor is inclusive', async () => {
      // **Inclusive, unlike section 4's, and that is a decision rather than a
      // slip.** There the bound is strict because a zero-length row goes inert and
      // silently removes the period it recorded. Here a closure dated at exactly a
      // row's `started_at` closes it zero-length, and that row genuinely had no
      // duration. A floor refuses what the schema refuses and nothing more.
      const past = new Date('2026-03-01T00:00:00+08:00');
      await db
        .updateTable('cell_leaderships')
        .set({ started_at: past })
        .where('cell_id', '=', markCell.id)
        .execute();
      await db
        .updateTable('cell_categories')
        .set({ started_at: past })
        .where('cell_id', '=', markCell.id)
        .execute();

      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-03-01',
      }).expect(200);

      expect(response.body.effective_date).toBe('2026-03-01');
    });

    it('is bounded by a member who has since left, not only by open rows', async () => {
      // **Term (b) of the floor: the `ended_at` of rows this closure does not write.**
      // Migration 0009 forbids a membership or leadership row of a CLOSED Cell ending
      // after the Cell did, and that reaches rows an earlier operation closed -- so a
      // closure dated before one of them is refused by the database as a raw
      // constraint violation unless the floor catches it first.
      //
      // **It was unpinned when this file was first written**, and dropping the term
      // left all twenty-two cases green: every floor case bound on an *open* row.
      // That is the same gap section 5's own backdate floor had, recorded on
      // 2026-08-23, and it is found by asking what mutation a case would fail
      // against rather than by reading the code.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const left = new Date('2026-03-05T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      await db
        .insertInto('cell_memberships')
        .values({ person_id: juan.id, cell_id: cell.id, started_at: created, ended_at: left })
        .execute();

      const response = await close(admin, cell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-03-03',
      }).expect(409);

      expect(response.body.error.details.earliest_effective_date).toBe('2026-03-05');
    });

    it('is bounded by a leadership stint that has already ended', async () => {
      // The same term on the other table, and pinned separately because the floor
      // asks each of them in its own statement -- so a case covering one leaves the
      // other deletable with the suite green.
      //
      // The state is what a handover leaves behind: an earlier leader's row closed at
      // the instant the current one opened. Section 10's handover workflow is a later
      // slice, so it is staged directly.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const handedOver = new Date('2026-03-06T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      // One transaction, because section 11 makes a leaderless Cell impossible rather
      // than merely unusual, and its trigger is deferred exactly so a handover can
      // pass through that instant.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: handedOver })
          .where('cell_id', '=', cell.id)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: ben.id, cell_id: cell.id, started_at: handedOver })
          .execute();
      });

      const response = await close(admin, cell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-03-04',
      }).expect(409);

      expect(response.body.error.details.earliest_effective_date).toBe('2026-03-06');
    });

    it('is bounded by a member who joined after the Cell opened', async () => {
      // Term (a) on the membership table. The leadership cases above bound on
      // `cell_leaderships`, so without this the membership half of the floor could be
      // deleted entirely and nothing would notice.
      const created = new Date('2026-03-01T00:00:00+08:00');
      const joined = new Date('2026-03-07T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      await db
        .insertInto('cell_memberships')
        .values({ person_id: juan.id, cell_id: cell.id, started_at: joined })
        .execute();

      const response = await close(admin, cell.id, {
        reason: 'MEMBERS_STOPPED_ATTENDING',
        note: 'correcting the recorded date',
        members: [{ person_id: juan.id, destination_cell_id: null }],
        effective_date: '2026-03-04',
      }).expect(409);

      expect(response.body.error.details.earliest_effective_date).toBe('2026-03-07');
    });

    it('says so plainly when no date can clear the floor', async () => {
      // The ordinary case rather than a corner: a Cell created today has a
      // leadership row starting today, so the floor sits inside the current day and
      // the earliest legal date is tomorrow -- which a closure may not take, because
      // it is not forward-dated. Section 4 settled the shape of this refusal: naming
      // tomorrow would be naming the one answer guaranteed to be refused again.
      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [],
        effective_date: manilaToday(),
      }).expect(409);

      expect(response.body.error.message).toMatch(/cannot be backdated/);
      expect(response.body.error.details.earliest_effective_date).toBeUndefined();

      // And the advice it gives works.
      await close(admin, markCell.id, { reason: 'CREATED_IN_ERROR', members: [] }).expect(200);
    });

    it('requires a note when backdating, and since decision 0355 when not', async () => {
      // **Section 7: backdating a closure "is Admin-only and always requires a
      // reason".** The closure reason cannot be that reason — every closure carries
      // one from the fixed list, so reading it that way makes the requirement vacuous.
      // What is owed is an explanation of the backdating, which is what section 5
      // requires of a backdated reassignment and for the reason section 10 gives: a
      // backdated closure erases the scheduled-meeting count a coverage line is read
      // against.
      //
      // Decision 0355 made the note owed on every closure, so an undated closure
      // without one is refused too — and the backdated one explains its date in the
      // same note (point 4).
      const created = new Date('2026-03-01T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      const refused = await close(admin, cell.id, {
        reason: 'CREATED_IN_ERROR',
        note: undefined,
        members: [],
        effective_date: '2026-03-02',
      }).expect(422);

      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(refused.body.error.details)).toMatch(/note/);

      const undated = await close(admin, cell.id, {
        reason: 'CREATED_IN_ERROR',
        note: undefined,
        members: [],
      }).expect(422);
      expect(undated.body.error.code).toBe('VALIDATION_FAILED');

      await close(admin, cell.id, {
        reason: 'CREATED_IN_ERROR',
        note: 'Created twice at setup; this one never met.',
        members: [],
        effective_date: '2026-03-02',
      }).expect(200);
    });

    it('does not treat an explicit date of today as backdating', async () => {
      // Section 10: "Any effective date earlier than the current day requires that
      // capability." Today's date is not earlier than today, so a Leader may send it —
      // an earlier version asked for the capability on any supplied date at all, which
      // was stricter than the specification and refused a request section 10 permits.
      //
      // It is refused here, but by the **floor**: this Cell's leadership began today,
      // so Manila midnight is below it. That is the point — the refusal names the
      // rule that actually applies rather than a capability the actor does not need.
      const leader = await churchCloser(mark);

      const response = await close(leader, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        members: [],
        effective_date: manilaToday(),
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    });

    it('decides backdating after the locks, not at handler entry', async () => {
      // **The decision moved inside the transaction, after the locks**, and this is
      // what fails if it moves back. `manilaDayOf(new Date())` at handler entry is a
      // different clock and a different moment from the `clock_timestamp()` the write
      // is stamped with: a request arriving at 23:59:59.7 and waiting out part of the
      // three-second `lock_timeout` crosses Manila midnight, and a date that was
      // today's when it arrived is yesterday's when the rows are ended at it —
      // backdated, with no capability asked and no note required.
      //
      // **It pins the placement, not the clock, and the title said both until it
      // didn't.** The wait is staged: a Leader is refused for backdating while holding
      // no capability, which is only decided at all if the decision happens after the
      // lock. Mutating `manilaDayOf(recordedAt)` back to `manilaDayOf(new Date())`
      // *inside* the transaction leaves this green, because the request has waited and
      // the host clock has crossed midnight too. What stays unpinned is the residue —
      // host-to-server skew, which section 24 bounds nowhere and no test can stage.
      const leader = await churchCloser(mark);
      const created = new Date('2026-03-01T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        const holderPid = Number(
          (await holder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await holder.query('BEGIN');
        await holder.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [cell.id]);

        const closing = close(leader, cell.id, {
          reason: 'LEADER_STEPPED_DOWN',
          note: 'well before today',
          members: [],
          effective_date: '2026-03-02',
        }).then((response) => response);

        await waitForApiBlocked(holderPid);
        await holder.query('ROLLBACK');

        const response = await closing;

        // Refused for the capability, which means the check ran — and it ran after the
        // lock, because the request could not reach it until the row was released.
        expect(response.status).toBe(403);
        expect(response.body.error.details.capability).toBe('records.backdate_effective_date');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });

    it('refuses a narrow grant of the backdating capability with SCOPE_DENIED', async () => {
      // **What this pins is the code split, and only that.** `coversWith` answers a
      // boolean, so the two errors are chosen at the call site because section 7 makes
      // the code name the half that failed. Deleting that and throwing
      // `CAPABILITY_DENIED` unconditionally left every other case green, and it is the
      // wrong answer here — this actor *holds* the capability, and an administrator
      // told `CAPABILITY_DENIED` would grant what they already granted. Verified red
      // against that mutation.
      //
      // **It does not pin the `{ kind: 'church' }` target, and nothing can.** An
      // earlier version of this comment claimed it did, on the reasoning that
      // resolving against the Cell's leader instead — what copying
      // `PeopleReassignmentService` would have done — would cover Mark and let the
      // closure succeed. That is false, and the mutation was run: it leaves this case
      // green. `coversWith` skips a grant `grantCoversNothing` voids *before* it
      // reaches `scopeCovers`, so a narrower grant of a `WHOLE_CHURCH_ONLY` capability
      // is discarded whatever target is passed; and a Whole Church grant returns true
      // on `scopeCovers`'s first line, before the target is read. Only `ADMIN` holds
      // this capability by default, at Whole Church, so both routes to it bypass the
      // target and no actor can be built that distinguishes the two.
      //
      // The target is therefore right on section 7's terms and unfalsifiable, which is
      // said here rather than left as a green case asserting more than it holds. It
      // becomes observable the day `records.backdate_effective_date` leaves
      // `WHOLE_CHURCH_ONLY`, and not before.
      const leader = await churchCloser(mark);
      const created = new Date('2026-03-01T00:00:00+08:00');
      const cell = await createCell(db, { leader: mark, createdAt: created });

      await db
        .insertInto('capability_grants')
        .values({
          account_id: leader.id,
          capability: 'records.backdate_effective_date',
          scope_type: 'OWN_SUBTREE',
          read_only: false,
          reason: 'Invented for this case (CLAUDE.md, Secrets).',
          granted_by: admin.id,
        })
        .execute();

      const response = await close(leader, cell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        note: 'well before today',
        members: [],
        effective_date: '2026-03-02',
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('records.backdate_effective_date');
    });

    it('accepts a backdated OTHER closure with one note carrying both', async () => {
      // **The second Stop Condition this branch settled, and nothing could fail on
      // it.** Section 10 says one note explains both the closure and its backdating
      // where the reason is `OTHER`, which already requires a note — so for that one
      // reason the backdating requirement adds no field, and section 10 says so
      // rather than leaving the code to take that reading silently.
      //
      // Every other case pairs `OTHER` with an undated closure or a backdate with one
      // of the other four reasons, so a service demanding a second explanation for a
      // backdated `OTHER` passed the whole suite. That mutation reddens this.
      const past = new Date('2026-03-01T00:00:00+08:00');
      for (const table of ['cell_leaderships', 'cell_categories'] as const) {
        await db
          .updateTable(table)
          .set({ started_at: past })
          .where('cell_id', '=', markCell.id)
          .execute();
      }

      await close(admin, markCell.id, {
        reason: 'OTHER',
        // One note, doing both jobs.
        note: 'the venue was sold, and this is dated to the day it closed',
        members: [],
        effective_date: '2026-03-02',
      }).expect(200);

      const backdated = await db
        .selectFrom('audit_log')
        .select(['after'])
        .where('action', '=', 'effective_date.backdated')
        .executeTakeFirstOrThrow();

      expect(backdated.after).toMatchObject({
        operation: 'cell.closed',
        effective_date: '2026-03-02',
      });
    });

    it.each(['2026-02-30', '2026-09-31', '2026-13-05', '2026-04-00'])(
      'refuses %s, which is well-shaped and is not a day',
      async (impossible) => {
        // **The defect this pins wrote a closure on a day nobody named** (ruling of
        // 2026-09-02). This field carried a shape check alone, so `2026-02-30` passed
        // it and reached `startOfManilaDay`, where `Date.UTC(2026, 1, 30)` rolls into
        // **2026-03-02** -- and the Cell was closed effective on that invented day,
        // into an effective-dated history table, with the response and the
        // `effective_date.backdated` audit entry both reporting it back as though it
        // had been asked for. Nothing errored anywhere on the path.
        //
        // It was reachable in the ordinary way: 2026-03-02 is in the past, so the
        // forward-dated refusal below did not catch it, and the floor is cleared by
        // anything after the Cell's own rows.
        const response = await close(admin, markCell.id, {
          reason: 'CREATED_IN_ERROR',
          note: 'correcting the recorded date',
          members: [],
          effective_date: impossible,
        }).expect(422);

        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.fields).toContainEqual(
          expect.objectContaining({ field: 'effective_date' }),
        );

        // And the Cell is untouched, which is the half a status code does not say.
        expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
      },
    );

    it('refuses a forward-dated closure', async () => {
      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2099-01-01',
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.field).toBe('effective_date');
    });

    it('refuses an effective date from an actor without the backdating capability', async () => {
      // Section 10: the floor says how far back a closure *can* be dated;
      // `records.backdate_effective_date` says who may date it back at all. Admin
      // holds it and a Leader does not -- and the reason is the coverage line, which a
      // leader who has submitted nothing all month could otherwise erase by closing
      // effective the first of it.
      const leader = await churchCloser(mark);

      const response = await close(leader, markCell.id, {
        reason: 'LEADER_STEPPED_DOWN',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-03-01',
      }).expect(403);

      expect(response.body.error.details.capability).toBe('records.backdate_effective_date');

      // The same leader may still close it today, so nothing is blocked.
      await close(leader, markCell.id, { reason: 'LEADER_STEPPED_DOWN', members: [] }).expect(200);
    });
  });

  describe('a pending schedule change', () => {
    it('does not make the Cell unclosable, and the pending row goes inert', async () => {
      // **The case that killed two of the three withdrawn floor formulations.** A
      // schedule change takes effect at the start of the following month, so a Cell
      // with one queued holds two rows carrying next month's timestamps -- an
      // outgoing row ending on the 1st and an incoming row starting on the 1st and
      // still open. A floor that read them sat in the future, and the Cell was then
      // closable by nobody, because a forward-dated closure is not an operation this
      // specification defines.
      //
      // What resolves it is that the closure ends each configuration row at
      // `GREATEST(closure, its own start)`: the pending row ends at its own start and
      // is zero-length, which section 5 makes inert -- a schedule change that was
      // decided and will now never take effect.
      await request(app.getHttpServer())
        .put(`/api/v1/cells/${markCell.id}/schedule`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ day_of_week: 7, time_of_day: '18:00' })
        .expect(200);

      const response = await close(admin, markCell.id, {
        reason: 'MERGED_INTO_ANOTHER_CELL',
        members: [],
      }).expect(200);

      const schedules = await db
        .selectFrom('cell_schedules')
        .select(['day_of_week', 'started_at', 'ended_at'])
        .where('cell_id', '=', markCell.id)
        .orderBy('started_at')
        .execute();

      expect(schedules).toHaveLength(2);

      // The row that was running ends at the closure.
      expect(schedules[0].ended_at?.toISOString()).toBe(response.body.effective_at);

      // The queued one is zero-length: in force at no instant, so it derives no
      // scheduled meeting for any date and answers no as-of read.
      expect(schedules[1].day_of_week).toBe(7);
      expect(schedules[1].ended_at?.toISOString()).toBe(schedules[1].started_at.toISOString());

      expect(await openRows('cell_schedules', markCell.id)).toBe(0);
    });
  });

  describe('the record it leaves', () => {
    it('writes the closure and one entry per member', async () => {
      await addMember(juan.id, markCell.id);

      await close(admin, markCell.id, {
        reason: 'OTHER',
        note: 'the venue was sold',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(200);

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'target_type', 'target_id', 'before', 'after', 'reason'])
        .where('action', 'in', ['cell.closed', 'cell_leadership.ended', 'cell_membership.moved'])
        .orderBy('action')
        .execute();

      expect(entries.map((entry) => entry.action)).toEqual([
        'cell.closed',
        'cell_leadership.ended',
        'cell_membership.moved',
      ]);

      // **Section 21 lists the leadership ending as an action in its own right** —
      // "carrying the outgoing and the incoming leader where each exists" — and the
      // first version of this operation wrote none, on the reasoning that it is not a
      // separate decision. That is the reasoning section 21 rejects for a membership
      // twelve lines away.
      expect(entries[1].target_id).toBe(markCell.id);
      // **The Cell**, which the ruling of 2026-08-31 makes the rule for all three
      // leadership actions rather than this one's own habit. `target_id` was asserted
      // here and `target_type` was not, so this entry agreed with the rule before there
      // was one and could have drifted off it silently.
      expect(entries[1].target_type).toBe('cell');
      expect(entries[1].before).toMatchObject({ cell_leader_id: mark.id });
      // No incoming leader, which is what distinguishes a closure from a handover here.
      expect(entries[1].after).toMatchObject({ cell_leader_id: null });

      const closed = entries[0];
      expect(closed.target_id).toBe(markCell.id);
      expect(closed.after).toMatchObject({
        state: 'CLOSED',
        closure_reason: 'OTHER',
        closure_note: 'the venue was sold',
      });

      // **A dispersal is a move, and is recorded as one.** Section 21 names "Cell
      // membership added, moved, or ended" and asks for one entry per action
      // performed -- so a reader searching for moves must find this one whether the
      // move came from the membership endpoint or from a closure. Recording it only
      // inside the closure entry would make a member's history depend on which
      // operation happened to move them.
      expect(entries[2].target_id).toBe(juan.id);
      expect(entries[2].before).toMatchObject({ cell_id: markCell.cellId });
      expect(entries[2].after).toMatchObject({ cell_id: benCell.cellId });
    });

    it('records a backdated closure separately', async () => {
      const past = new Date('2026-03-01T00:00:00+08:00');
      for (const table of ['cell_leaderships', 'cell_categories'] as const) {
        await db
          .updateTable(table)
          .set({ started_at: past })
          .where('cell_id', '=', markCell.id)
          .execute();
      }

      await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        note: 'correcting the recorded date',
        members: [],
        effective_date: '2026-03-02',
      }).expect(200);

      const backdated = await db
        .selectFrom('audit_log')
        .select(['after'])
        .where('action', '=', 'effective_date.backdated')
        .executeTakeFirstOrThrow();

      expect(backdated.after).toMatchObject({
        operation: 'cell.closed',
        effective_date: '2026-03-02',
      });
    });
  });

  describe('what the locks make safe', () => {
    it('takes its person locks before it touches a Cell row', async () => {
      // **The class order, pinned against the service rather than only against the
      // schema.** `closure-locking.spec.ts` measures what happens when the two are
      // reversed -- a genuine cycle against the membership writer, which takes the
      // person lock first and the Cell row lock at commit -- but nothing failed if
      // *this service* swapped its two statements, because no case observed which it
      // took first.
      //
      // Observed here without staging a deadlock: hold the person lock, and while the
      // closure is stuck on it, take its Cell row. That succeeds only if the closure
      // is not holding it -- which is what "people first" means.
      await addMember(juan.id, markCell.id);

      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      const prober = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      await prober.connect();

      try {
        const holderPid = Number(
          (await holder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await holder.query('BEGIN');
        await holdPersonLock(holder, juan.id);

        const closing = close(admin, markCell.id, {
          reason: 'MEMBERS_STOPPED_ATTENDING',
          members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
        }).then((response) => response);

        await waitForApiBlocked(holderPid);

        // The Cell row is free, so the closure has not reached it. Bounded, so that a
        // service taking its Cell locks first fails this as a timeout rather than
        // hanging the run.
        await prober.query('BEGIN');
        await prober.query("SET LOCAL lock_timeout = '2s'");
        await prober.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [markCell.id]);
        await prober.query('ROLLBACK');

        await holder.query('ROLLBACK');

        expect((await closing).status).toBe(200);
      } finally {
        await prober.query('ROLLBACK').catch(() => undefined);
        await holder.query('ROLLBACK').catch(() => undefined);
        await prober.end();
        await holder.end();
      }
    });

    it('bounds its wait even with nobody to disperse', async () => {
      // **The hole section 5 names, and the case that closes it.**
      // `lockPersonsWithin` sets `lock_timeout` and returns early on an empty list,
      // so a Cell with no members to disperse reaches its Cell row locks with no
      // bound at all -- and an unbounded wait inside a transaction holding one of
      // section 24's ten connections is the liveness hazard that section exists for.
      // Section 5 names this operation as the case: "a Cell closure with no members
      // to disperse is exactly it".
      //
      // Without `boundLockWaitsWithin` this hangs until jest gives up rather than
      // answering, which is why the assertion is on the answer and its code rather
      // than on the absence of a hang.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [markCell.id]);

        const response = await close(admin, markCell.id, {
          reason: 'CREATED_IN_ERROR',
          members: [],
        });

        // Section 22: an elapsed wait is `RESOURCE_BUSY`, a 503, so the idempotency
        // key is released and the retry the message advises is one that can work.
        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    }, 20000);

    it('closes a Cell handed away while it waited, ending the leadership in force', async () => {
      // **Decision 0355 moved who may close onto the church.** This case used to have a
      // Leader refused `SCOPE_DENIED` when the Cell left their subtree mid-wait: the
      // in-transaction re-check below caught authority going stale. A closer now holds
      // `cell.manage_lifecycle` at Whole Church, which covers every Cell whoever leads
      // it, so no handover can take a Cell out of a closer's scope and that refusal is
      // unreachable. What a handover mid-wait can still get wrong is *which* leadership
      // the closure ends, so that is what is pinned: the one in force after the lock.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        const holderPid = Number(
          (await holder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await holder.query('BEGIN');
        await holder.query('SELECT id FROM cells WHERE id = $1 FOR NO KEY UPDATE', [markCell.id]);

        // Dispatched, not merely constructed: the object supertest returns is lazy,
        // and a case that holds a lock and asserts a request waits must first send it
        // (section 25 rule 19, which names this exact copy).
        const closing = close(admin, markCell.id, {
          reason: 'LEADER_STEPPED_DOWN',
          members: [],
        }).then((response) => response);

        await waitForApiBlocked(holderPid);

        // The Cell changes hands while the closure waits for its row lock.
        await holder.query(
          'UPDATE cell_leaderships SET ended_at = now() WHERE cell_id = $1 AND ended_at IS NULL',
          [markCell.id],
        );
        await holder.query(
          'INSERT INTO cell_leaderships (person_id, cell_id, started_at) VALUES ($1, $2, now())',
          [ben.id, markCell.id],
        );
        await holder.query('COMMIT');

        const response = await closing;

        expect(response.status).toBe(200);
        expect((await cellRow(markCell.id)).state).toBe('CLOSED');

        // Ben's leadership, opened while the closure waited, is the one it ended.
        const ended = await db
          .selectFrom('audit_log')
          .select('before')
          .where('action', '=', 'cell_leadership.ended')
          .executeTakeFirstOrThrow();
        expect(ended.before).toMatchObject({ cell_leader_id: ben.id });
        expect(await openRows('cell_leaderships', markCell.id)).toBe(0);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });

  /**
   * Wait until the API's own backend is blocked on a lock.
   *
   * The request runs on a pooled connection whose pid this case cannot know, so the
   * poll is keyed on the database and on excluding the backend deliberately holding
   * the lock. That is weaker than keying on a pid and it is the strongest key
   * available here; what it rules out is the failure that matters, a poll satisfied
   * by a blocked backend in `dfc_dev` on the same cluster.
   */
  const waitForApiBlocked = async (holderPid: number): Promise<void> => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const waiting = await sql<{ count: string }>`
        SELECT count(*) AS count
          FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND state = 'active'
           AND pid <> ${holderPid}
           AND pid <> pg_backend_pid()
      `.execute(db);

      if (Number(waiting.rows[0].count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error('the closure never blocked on the Cell row; the case proves nothing');
  };
});
