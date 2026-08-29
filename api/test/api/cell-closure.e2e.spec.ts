import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
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

  const close = (actor: TestAccount, cellUuid: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/cells/${cellUuid}/closure`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

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
        reason: 'MEMBERS_DISPERSED',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(200);

      expect(response.body).toMatchObject({
        cell_id: markCell.cellId,
        state: 'CLOSED',
        closure_reason: 'MEMBERS_DISPERSED',
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
      await closeCellDirectly(db, markCell.id, { reason: 'MEMBERS_DISPERSED' });

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
        members: [{ person_id: juan.id, destination_cell_id: null }],
      }).expect(409);

      expect(response.body.error.details.unknown_person_ids).toEqual([juan.id]);
    });

    it('refuses a member named twice', async () => {
      await addMember(juan.id, markCell.id);

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
        members: [{ person_id: juan.id }],
      }).expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a closed destination Cell', async () => {
      await addMember(juan.id, markCell.id);
      await closeCellDirectly(db, benCell.id, { reason: 'MEMBERS_DISPERSED' });

      const response = await close(admin, markCell.id, {
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
        members: [{ person_id: juan.id, destination_cell_id: graceCell.id }],
      }).expect(409);

      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.message).toMatch(/same Network/);
    });
  });

  describe('who may close', () => {
    it('lets the Cell leader close their own Cell', async () => {
      const leader = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
      });

      await close(leader, markCell.id, { reason: 'CREATED_IN_ERROR', members: [] }).expect(200);
    });

    it('refuses a leader closing a Cell in a branch they do not oversee', async () => {
      // Ben is Mark's sibling under the root, so `cell.manage_lifecycle` at
      // own/subtree does not reach Ben's Cell (section 7, resolved through its
      // leader).
      const leader = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
      });

      const response = await close(leader, benCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect((await cellRow(benCell.id)).state).toBe('ACTIVE');
    });

    it('refuses a destination Cell outside the closer’s scope', async () => {
      // Section 10: "A destination Cell must be within the actor's authorized scope,
      // exactly as an ordinary move requires… they may not put people into a Cell
      // belonging to a branch they have nothing to do with."
      //
      // **The capability is `cell.manage_membership`, not the lifecycle one**, and
      // the two are asked about different Cells: authority over the Cell being closed
      // says nothing about where its members may be put.
      await addMember(juan.id, markCell.id);

      const leader = await createAccount(app, db, {
        person: mark,
        roles: ['LEADER'],
      });

      const response = await close(leader, markCell.id, {
        reason: 'MEMBERS_DISPERSED',
        members: [{ person_id: juan.id, destination_cell_id: benCell.id }],
      }).expect(403);

      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.details.capability).toBe('cell.manage_membership');

      // Nothing was written: the closure is one transaction.
      expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
      expect(await openRows('cell_memberships', markCell.id)).toBe(1);
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
        reason: 'MEMBERS_DISPERSED',
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
        reason: 'MEMBERS_DISPERSED',
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

    it('refuses a forward-dated closure', async () => {
      const response = await close(admin, markCell.id, {
        reason: 'CREATED_IN_ERROR',
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
      const leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });

      const response = await close(leader, markCell.id, {
        reason: 'CREATED_IN_ERROR',
        members: [],
        effective_date: '2026-03-01',
      }).expect(403);

      expect(response.body.error.details.capability).toBe('records.backdate_effective_date');

      // The same leader may still close it today, so nothing is blocked.
      await close(leader, markCell.id, { reason: 'CREATED_IN_ERROR', members: [] }).expect(200);
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
        .where('action', 'in', ['cell.closed', 'cell_membership.moved'])
        .orderBy('action')
        .execute();

      expect(entries.map((entry) => entry.action)).toEqual([
        'cell.closed',
        'cell_membership.moved',
      ]);

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
      expect(entries[1].target_id).toBe(juan.id);
      expect(entries[1].before).toMatchObject({ cell_id: markCell.cellId });
      expect(entries[1].after).toMatchObject({ cell_id: benCell.cellId });
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
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          juan.id,
        ]);

        const closing = close(admin, markCell.id, {
          reason: 'MEMBERS_DISPERSED',
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

    it('refuses a closure whose Cell was handed away while it waited', async () => {
      // **Section 10 requires scope to be re-decided inside the transaction, after
      // the locks**, and nothing failed without it until this case existed. The
      // guard answers on the pool before the transaction opens, so a handover
      // committing in between leaves that answer describing authority the actor no
      // longer holds -- the staleness section 24 records for an intermediate
      // ancestor, reached here through the Cell rather than through the tree.
      //
      // Deleting the re-check left all twenty-five other cases green, because every
      // one of them is decided the same way by the guard. That is the
      // disjunction-with-one-member shape this repository keeps recording, and the
      // only thing that separates the two layers is making the guard's answer go
      // stale on purpose.
      const leader = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
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
        const closing = close(leader, markCell.id, {
          reason: 'CREATED_IN_ERROR',
          members: [],
        }).then((response) => response);

        await waitForApiBlocked(holderPid);

        // The Cell changes hands while the closure waits for its row lock. Ben is
        // Mark's sibling under the root, so the Cell leaves Mark's subtree.
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

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('SCOPE_DENIED');
        expect((await cellRow(markCell.id)).state).toBe('ACTIVE');
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
