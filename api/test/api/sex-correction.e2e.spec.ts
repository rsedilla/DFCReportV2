import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';
import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  EPOCH,
} from '../setup/fixtures';

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

  describe('refused while the person holds a Cell relationship (section 4)', () => {
    // Settled on 2026-08-30, and the second half of section 4's Cell obligation. The
    // failure it prevents is invisible to the schema: `assert_membership_same_network`
    // compares both sides as of the membership's own `started_at`, so after a Network
    // change the comparison instant precedes it, both sides still resolve to the old
    // Network, and no trigger objects — even if the row were written again.

    it('refuses while the person leads a Cell, naming it', async () => {
      const cell = await createCell(db, { leader: mark });

      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      // Naming the Cell is what makes the refusal actionable, and is safe only
      // because every capability reaching this path is Whole Church (section 7).
      expect(response.body.error.details.cells).toEqual([{ id: cell.id, cell_id: cell.cellId }]);

      // Refused means nothing written: the Network row is untouched.
      const networks = await db
        .selectFrom('network_assignments')
        .select('network')
        .where('person_id', '=', mark.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(networks.network).toBe('MENS');
    });

    it('names every Cell a person leads, not just the first', async () => {
      // Section 10 permits one leader to lead many. An administrator told about one
      // Cell, who resolves it and is then refused for a second, learns the shape of
      // the obligation one Cell at a time.
      // **Created in the order that makes the assertion disagree with heap order.**
      // `cell_id` is `CELL-` plus a zero-padded sequence value, so it ascends with
      // creation and a sequential scan returns freshly inserted rows in that same
      // order — which means deleting the `ORDER BY` would leave a creation-ordered
      // assertion green, deterministically. The first Cell is given an explicit high
      // handle so that handle order and creation order are opposites, and both the
      // deletion and a switch to `cells.id` redden.
      // **The handle and the UUID are both chosen, and they sort opposite ways.**
      // `cell_id` is immutable once written (`cells_record_is_final`), so the high
      // handle is set at insert; the `id` is set low so that `ORDER BY cells.id` would
      // put this Cell *first* while `ORDER BY cells.cell_id` puts it last. That makes
      // all three states distinguishable deterministically: the correct ordering, the
      // ordering deleted (heap order, which is insertion order), and the ordering moved
      // to the UUID — which is otherwise a coin flip, and this repository has twice
      // recorded that a mutation caught on some runs is not a pin.
      //
      // Four rows from one statement, sharing the Cell's `created_at`, because
      // migration 0009 refuses a partly-built Cell and requires the schedule row to
      // start exactly there.
      const highHandle = (
        await sql<{ id: string }>`
          WITH new_cell AS (
            INSERT INTO cells (id, cell_id)
            VALUES ('00000000-0000-4000-8000-000000000001'::uuid, 'CELL-999900')
            RETURNING id, created_at
          ), category AS (
            INSERT INTO cell_categories (cell_id, category, started_at)
            SELECT id, 'YOUTH'::cell_category, created_at FROM new_cell
          ), schedule AS (
            INSERT INTO cell_schedules (cell_id, day_of_week, time_of_day, started_at)
            SELECT id, 6::smallint, '18:00'::time, created_at FROM new_cell
          ), leadership AS (
            INSERT INTO cell_leaderships (person_id, cell_id, started_at)
            SELECT ${mark.id}::uuid, id, created_at FROM new_cell
          )
          SELECT id FROM new_cell
        `.execute(db)
      ).rows[0];

      const lowHandle = await createCell(db, { leader: mark, category: 'COUPLE' });

      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      // Compared in order rather than sorted on both sides: sorting would leave the
      // query free to order by anything at all.
      expect(response.body.error.details.cells).toEqual([
        { id: lowHandle.id, cell_id: lowHandle.cellId },
        { id: highHandle.id, cell_id: 'CELL-999900' },
      ]);

      // **Both orderings the assertion depends on, asserted.** The handle order is what
      // makes deleting the `ORDER BY` redden; the id order is what makes switching it to
      // `cells.id` redden, and nothing checked it — true with probability 1 - 2^-32,
      // which is not the same as checked.
      //
      // The handle is a fixed `CELL-999900` against a sequence that `truncateAll` does
      // not reset (`cell_id_seq` has no `OWNED BY`). It degrades loudly rather than
      // silently: at 999,900 the insert hits the unique index, and past 999,999 the
      // handle grows a digit and lexicographic order inverts — at which point this
      // assertion is what goes red.
      expect(lowHandle.cellId < 'CELL-999900').toBe(true);
      expect(highHandle.id < lowHandle.id).toBe(true);
    });

    it('refuses while the person holds a Cell membership', async () => {
      // Reached by nothing the leadership half does: Mark leads no Cell here, and
      // membership does not mirror pastoral assignment, so the Cell's leader need not
      // be anywhere near him.
      const manuelCell = await createCell(db, { leader: manuel });
      await db
        .insertInto('cell_memberships')
        // **`clock_timestamp()`, not `new Date()`.** The Cell's leadership row starts at
        // the database's clock; a host `Date` a few milliseconds behind it makes the
        // membership predate the leadership, and `assert_membership_same_network`
        // correctly refuses — "had no leader as of ...". That is what failed once,
        // was wrongly written off as a flake, and then reproduced.
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: sql<Date>`clock_timestamp()`,
        })
        .execute();

      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.cell).toEqual({
        id: manuelCell.id,
        cell_id: manuelCell.cellId,
      });
    });

    it('reports leadership before membership where the person holds both', async () => {
      // Section 4 fixes the order so somebody holding both is told about the
      // obligation that takes weeks — a handover — rather than the one that takes
      // minutes. Swapping the two checks reddens this and nothing else.
      const own = await createCell(db, { leader: mark });
      const manuelCell = await createCell(db, { leader: manuel });
      await db
        .insertInto('cell_memberships')
        // **`clock_timestamp()`, not `new Date()`.** The Cell's leadership row starts at
        // the database's clock; a host `Date` a few milliseconds behind it makes the
        // membership predate the leadership, and `assert_membership_same_network`
        // correctly refuses — "had no leader as of ...". That is what failed once,
        // was wrongly written off as a flake, and then reproduced.
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: sql<Date>`clock_timestamp()`,
        })
        .execute();

      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      expect(response.status).toBe(409);
      expect(response.body.error.details.cells).toEqual([{ id: own.id, cell_id: own.cellId }]);
      expect(response.body.error.details.cell).toBeUndefined();
    });

    it('accepts the correction once the Cell has been closed and the membership ended', async () => {
      const own = await createCell(db, { leader: mark });
      const manuelCell = await createCell(db, { leader: manuel });
      await db
        .insertInto('cell_memberships')
        // **`clock_timestamp()`, not `new Date()`.** The Cell's leadership row starts at
        // the database's clock; a host `Date` a few milliseconds behind it makes the
        // membership predate the leadership, and `assert_membership_same_network`
        // correctly refuses — "had no leader as of ...". That is what failed once,
        // was wrongly written off as a flake, and then reproduced.
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: sql<Date>`clock_timestamp()`,
        })
        .execute();

      await closeCellDirectly(db, own.id, { reason: 'LEADER_STEPPED_DOWN' });
      await db
        .updateTable('cell_memberships')
        // **Both ends of the period from the database clock, and this is the third
        // instance of that hazard on this branch.** Before the fix above, both sides
        // came from the host and `ended_at >= started_at` held by construction; moving
        // only `started_at` to `clock_timestamp()` turned that into a race against
        // `cell_memberships_period_ordered`. Measured on this machine,
        // `clock_timestamp()` runs 6-8ms *ahead* of `Date.now()` — PostgreSQL reads
        // `GetSystemTimePreciseAsFileTime` while V8 interpolates from the coarse tick —
        // so a host instant taken 1-3ms later still lands behind the start. It is not
        // skew between two hosts, which is why "the database is local" is the wrong
        // intuition.
        .set({ ended_at: sql<Date>`clock_timestamp()` })
        .where('person_id', '=', mark.id)
        .where('ended_at', 'is', null)
        .execute();

      const response = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
      });

      // **The refusal clears, which is what makes it a precondition rather than a
      // bar.** A closed Cell holds no open leadership (section 11), so it never
      // blocks — that falls out of the schema rather than needing a filter.
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: mark.id, sex: 'FEMALE' });
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

    it('names the pastoral bound where it ties with the Network row', async () => {
      // **The tie is the ordinary fixture shape rather than a corner**, and nothing
      // pinned it: `createPerson` writes the Network row at `EPOCH` and `assignTo`
      // defaults to `EPOCH`, so term (a) equals the Network row's start for most
      // people. Grace is one — a leaf, with no Cell and no disciples.
      //
      // Two assertions, and each catches a different mutation. The wording pins
      // `MESSAGE_FOR.edges`, which no other case in the suite reaches. That it is the
      // *pastoral* wording pins the tie direction: the bound is resolved by a reduce
      // that keeps the earlier candidate, so `>` becoming `>=` would name the Network
      // row here and change nothing else in the suite.
      // **The premise, asserted rather than assumed.** Both bounds are `EPOCH` only
      // because `createPerson` and `assignTo` happen to default to it. If either default
      // moved, this would quietly become a plain pastoral-floor case and would stop
      // distinguishing `>` from `>=` while still passing on the wording.
      const premise = await db
        .selectFrom('network_assignments')
        .innerJoin(
          'pastoral_assignments',
          'pastoral_assignments.person_id',
          'network_assignments.person_id',
        )
        .select([
          'network_assignments.started_at as network_started_at',
          'pastoral_assignments.started_at as assignment_started_at',
        ])
        .where('network_assignments.person_id', '=', grace.id)
        .where('network_assignments.ended_at', 'is', null)
        .where('pastoral_assignments.ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(premise.network_started_at.getTime()).toBe(premise.assignment_started_at.getTime());

      const response = await correct(grace.id, {
        sex: 'MALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: raymond.id,
        effective_date: manilaDayOf(EPOCH),
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(response.body.error.details.earliest_effective_date).toBe('2020-01-02');
      expect(response.body.error.message).toMatch(/pastoral assignment/);
    });
  });

  describe("the floor's two Cell terms (section 4)", () => {
    /**
     * Every instant here is a fixed constant, which is the per-*period* rule in
     * `test/setup/fixtures.ts`: both ends of a period from one clock. Mixing a host
     * `Date` with `clock_timestamp()` writes a period that ends before it begins on
     * some runs only, and it has been shipped three times on this project.
     *
     * All of them are later than `MARK_ASSIGNED_AT`, so the Cell term is the one that
     * binds. With a pastoral term above them these cases would pass against a floor
     * that ignored Cell rows entirely, which is what they exist to refuse.
     */
    const LED_FROM = new Date('2026-04-03T19:00:00+08:00');
    const LED_UNTIL = new Date('2026-04-30T18:00:00+08:00');
    const JOINED_AT = new Date('2026-05-10T19:00:00+08:00');
    const LEFT_AT = new Date('2026-06-20T18:00:00+08:00');
    /** Both inside the membership's span, which is what makes them comparison instants. */
    const HANDED_OVER_FIRST_AT = new Date('2026-05-20T19:00:00+08:00');
    const HANDED_OVER_AT = new Date('2026-06-01T19:00:00+08:00');

    it('bounds on a closed membership start, and accepts a date inside that membership', async () => {
      // **The second request is what pins the column**, and without it this case
      // passes just as well against a term over `ended_at`.
      //
      // This Cell never changes hands, which is the condition that makes the
      // membership's own start the last instant it was ever compared at — the case
      // below is the one where it is not. With no handover to span, every date after
      // the join leaves the membership legal, and a term over `ended_at` would refuse
      // the second request here for nothing.
      const manuelCell = await createCell(db, { leader: manuel, createdAt: JOINED_AT });

      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: manilaDayOf(JOINED_AT),
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-05-11');

      // **The wording, which is the `kind`.** A pastoral message here would send an
      // administrator looking for an assignment that is not the problem — the reason
      // section 4's three bounds do not share one message.
      expect(refused.body.error.message).toMatch(/Cell relationship/);

      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-01',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe('2026-06-01');

      // And the membership it reached over is still legal, which is the property the
      // column choice rests on: it is compared at its own start, where Mark still
      // resolves to the Network he is being corrected out of.
      const membership = await db
        .selectFrom('cell_memberships')
        .select('started_at')
        .where('person_id', '=', mark.id)
        .executeTakeFirstOrThrow();

      expect(membership.started_at.getTime()).toBeLessThan(
        new Date(accepted.body.effective_at).getTime(),
      );
    });

    it('extends the membership term to a handover the membership spanned', async () => {
      // **The membership is compared at more than one instant, and the first version
      // of this term assumed it was compared at exactly one.**
      // `assert_leadership_stays_in_network` reads the member's Network again at the
      // *incoming* leadership row's `started_at`, for every membership open then. So a
      // correction dated after the join but before the handover clears a `started_at`
      // bound and falsifies the handover's own comparison.
      //
      // Reproduced against the schema before this was written: the correction commits,
      // and at the handover instant the member resolves to one Network and the leader
      // to the other. Nothing re-examines it.
      const marco = await createPerson(db, { firstName: 'Marco', network: 'MENS' });
      await assignTo(db, marco.id, manuel.id);

      const manuelCell = await createCell(db, { leader: manuel, createdAt: JOINED_AT });
      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      // A real handover inside the membership's span: the outgoing row ends and the
      // incoming one opens at the same instant, which contiguity requires.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: HANDED_OVER_AT })
          .where('cell_id', '=', manuelCell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: marco.id, cell_id: manuelCell.id, started_at: HANDED_OVER_AT })
          .execute();
      });

      // 20 May: after the join on 10 May, before the handover on 1 June. Accepted by
      // a term over `started_at` alone, which is the defect.
      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-05-20',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');
      expect(refused.body.error.message).toMatch(/Cell relationship/);

      // The date it names is accepted, and it is past the handover rather than merely
      // past the join — so this also pins that the term did not simply move to
      // `ended_at`, which would name 21 June.
      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-02',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe('2026-06-02');
    });

    it('takes the last of several handovers a membership spanned', async () => {
      // **`max` against `min` on the inner subquery, pinned on a shape production can
      // produce.** The `extends` case above also catches that mutation, but only because
      // its Cell is created at the very instant the member joins, so the Cell's own first
      // leadership row falls inside the window and gives it two rows. That equality is a
      // fixture artefact — the docblock declaring the window's lower bound says in terms
      // that production cannot produce it, since it needs two identical
      // `clock_timestamp()` reads.
      //
      // Here the Cell pre-exists the membership, which is the ordinary shape, so its
      // opening row is outside the window and the two rows inside it are genuine
      // handovers. `min` collapses the term to the first of them.
      const marco = await createPerson(db, { firstName: 'Marco', network: 'MENS' });
      await assignTo(db, marco.id, manuel.id);

      const manuelCell = await createCell(db, { leader: manuel, createdAt: LED_FROM });
      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      for (const [at, to] of [
        [HANDED_OVER_FIRST_AT, marco.id],
        [HANDED_OVER_AT, raymond.id],
      ] as const) {
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', manuelCell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: to, cell_id: manuelCell.id, started_at: at })
            .execute();
        });
      }

      // 25 May sits between the two handovers. The term is the later one, so this is
      // refused and the date named is past 1 June; under `min` the term would be 20 May
      // and this would be accepted.
      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-05-25',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-06-02');
    });

    it('ignores a handover in a Cell the person was not a member of', async () => {
      // **The correlation, and nothing else pinned it.** Dropping
      // `spanned.cell_id = cm.cell_id` was green across the whole suite until this
      // case: every other fixture has one Cell, or a second whose handover falls
      // outside the membership window. Uncorrelated, the term picks up any Cell's
      // handover and over-refuses a correction that strands nothing.
      //
      // Mark's own Cell never changes hands, so his term is the join instant. The
      // other Cell changes hands inside his membership window and has nothing to do
      // with him.
      //
      // **It is a negative case, so it pins the correlation only alongside `extends`.**
      // Deleting the whole membership term, or `min` for `max`, or either inequality,
      // all leave this green — a case asserting that something is *accepted* cannot
      // distinguish a term that is correctly narrow from one that is absent. `extends`
      // establishes that the term exists and reaches handovers; this one establishes
      // that it reaches only the person's own Cell.
      const marco = await createPerson(db, { firstName: 'Marco', network: 'MENS' });
      await assignTo(db, marco.id, manuel.id);

      const manuelCell = await createCell(db, { leader: manuel, createdAt: JOINED_AT });
      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      const otherCell = await createCell(db, { leader: raymond, createdAt: LED_FROM });
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: HANDED_OVER_AT })
          .where('cell_id', '=', otherCell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: marco.id, cell_id: otherCell.id, started_at: HANDED_OVER_AT })
          .execute();
      });

      // The same date the `extends` case above is refused at, and here it is accepted
      // — the difference being whose Cell changed hands.
      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-01',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe('2026-06-01');
    });

    it('does not extend to a handover at the instant the membership ended', async () => {
      // **The boundary the span predicate turns on**, and `<` against `<=` is invisible
      // without it. The member scan selects memberships with `cm.ended_at > H`, false at
      // equality, so at commit a membership ending exactly at a leadership's start is not
      // compared there.
      //
      // **That is the state at commit rather than a claim about history.** A backdated
      // closure may close an *open* membership at exactly the sitting leadership's
      // `started_at` — `CellsClosureService`'s floor is inclusive for that case — and the
      // scan did run at that instant when the leadership was written.
      //
      // Bounding past it would still be wrong, and the reason is about the **leadership**
      // row rather than the membership. That closure ends both at the same instant, so a
      // leadership `[H, ∞)` becomes `[H, H]` — zero-length, and inert under section 5,
      // since `assert_membership_same_network`'s leader lookup asks
      // `cl.started_at <= t AND ended_at > t`, unsatisfiable at `H`. The membership
      // becomes `[m, H]`, which is positive length and fully resolvable. So the
      // comparison the correction would falsify belongs to a row no query resolves, and
      // it is not the row whose term is being computed.
      //
      // *An earlier version of this comment called the membership zero-length. The
      // conclusion was right and the row was wrong — the subject was carried across from
      // `CellsClosureService`'s own inclusivity rationale, which is written about a
      // membership closed at its own `started_at`.*
      const marco = await createPerson(db, { firstName: 'Marco', network: 'MENS' });
      await assignTo(db, marco.id, manuel.id);

      const manuelCell = await createCell(db, { leader: manuel, createdAt: JOINED_AT });
      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: LEFT_AT })
          .where('cell_id', '=', manuelCell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: marco.id, cell_id: manuelCell.id, started_at: LEFT_AT })
          .execute();
      });

      // The term is the join instant, so a date after it is accepted even though a
      // handover sits later inside the calendar window.
      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-06-01',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe('2026-06-01');
    });

    it('bounds on a closed leadership end, and refuses a date inside that stint', async () => {
      // **Term over `cl.ended_at`, and a date inside the stint is what pins it.**
      // Over `started_at` this correction would be accepted, and it would strand
      // every membership opened in the Cell after 3 April — rows belonging to other
      // people, which is why the bound cannot be read off Mark's own membership rows.
      const own = await createCell(db, { leader: mark, createdAt: LED_FROM });
      await closeCellDirectly(db, own.id, { reason: 'LEADER_STEPPED_DOWN', at: LED_UNTIL });

      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-04-15',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('INVARIANT_VIOLATION');
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-05-01');
      expect(refused.body.error.message).toMatch(/Cell relationship/);

      // The date it names is accepted, which is the property every floor case owes:
      // an administrator handed a date must not be refused again.
      const accepted = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-05-01',
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.effective_date).toBe('2026-05-01');
    });

    it('takes the later of the two Cell terms', async () => {
      // Both present, and the membership start is the later — so a floor taking only
      // the leadership half would accept a date that strands the membership. Neither
      // subquery alone satisfies this case.
      const own = await createCell(db, { leader: mark, createdAt: LED_FROM });
      await closeCellDirectly(db, own.id, { reason: 'LEADER_STEPPED_DOWN', at: LED_UNTIL });

      const manuelCell = await createCell(db, { leader: manuel, createdAt: JOINED_AT });
      await db
        .insertInto('cell_memberships')
        .values({
          person_id: mark.id,
          cell_id: manuelCell.id,
          started_at: JOINED_AT,
          ended_at: LEFT_AT,
        })
        .execute();

      const refused = await correct(mark.id, {
        sex: 'FEMALE',
        reason: 'Sex entered in error at encoding.',
        pastoral_leader_id: grace.id,
        effective_date: '2026-05-01',
      });

      expect(refused.status).toBe(409);
      expect(refused.body.error.details.earliest_effective_date).toBe('2026-05-11');
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
      // Mark is inside Raymond's subtree, so a scope-covering grant would pass the
      // guard — which is what makes this about the *scope of the grant* rather than
      // the position of the target.
      //
      // **The refusal now comes from the guard**, not from the service check it
      // used to. The rule generalised on 2026-08-24: every capability section 7
      // gives at Whole Church only is refused there, rather than each operation
      // carrying its own version. The assertions below are unchanged and still
      // distinguish this from an ordinary scope denial, which is the property that
      // mattered.
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

  describe('serializing against a concurrent edge write (sections 4 and 5)', () => {
    it('answers RESOURCE_BUSY when the record is held by another change', async () => {
      // **Rewritten from a timing assertion.** It used to sleep 500ms and assert
      // the request had not settled, which the 3-second lock timeout turned into a
      // 2.5-second margin — a slow runner would fail it with no diagnostic. This
      // asserts the answer instead, which is deterministic and is what a client
      // sees.
      //
      // The lock sites themselves, and the release of the idempotency key on this
      // failure, are pinned individually in `person-lock.e2e.spec.ts`.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          mark.id,
        ]);

        const response = await correct(mark.id, {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        });

        expect(response.status).toBe(503);
        expect(response.body.error.code).toBe('RESOURCE_BUSY');

        // Nothing was written: the correction rolled back rather than proceeding
        // without the serialization the lock exists to give it.
        const networks = await db
          .selectFrom('network_assignments')
          .selectAll()
          .where('person_id', '=', mark.id)
          .execute();

        expect(networks).toHaveLength(1);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await holder.end();
      }
    });
  });

  describe('the effective instant is stamped after the lock (issue #16)', () => {
    it('records an instant not earlier than the moment the lock was released', async () => {
      // **The defect this pins was a contention-only failure with a permanent
      // answer.** The instant was stamped before the transaction opened, so two
      // corrections on one person both stamped at roughly the same moment; the winner
      // committed a `network_assignments` row whose `started_at` was later than the
      // loser's stamp, and the loser — reading that row after taking the lock second
      // — was refused as too early with `INVARIANT_VIOLATION`. Section 22 **stores** a
      // 409 against the idempotency key and replays it for the whole retention, so a
      // request that was legal when it arrived was refused for ever, for having
      // waited.
      //
      // The reassignment path was moved to stamp after its lock by `216be37` on
      // 2026-08-23, and this one was not — although both methods sat in a single file
      // three hundred lines apart at that commit. A defect fixed on one member of a
      // class with the class left unswept, rather than two copies drifting.
      //
      // Asserting the instant rather than a status, because the status is 200 either
      // way here: only a *second* writer produces the refusal, and staging that
      // deterministically needs a raw row write. An instant earlier than the release
      // is the same defect one step upstream, and it is what `new Date()` before the
      // lock cannot avoid producing.
      const holder = new Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();

      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 0))', [
          mark.id,
        ]);
        const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

        // Dispatched, not held: a supertest object is lazy, and an unawaited one is
        // never sent — the fault CLAUDE.md records at `19dfe3c`. Handlers are attached
        // now so a poll failure cannot become an unhandled rejection, which Node 22
        // treats as fatal.
        const pending = correct(mark.id, {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        }).then(
          (response) => ({ ok: true, response }) as const,
          (error: unknown) => ({ ok: false, error }) as const,
        );

        await waitForBlockedBy(rows[0].pid);

        // **Node's clock, not the database's**, and the first version used
        // `clock_timestamp()` and was flaky about one run in three. The service stamps
        // with `new Date()`, so comparing against a PostgreSQL instant compares two
        // clocks that agree only approximately. The test and the application run in
        // one process, so this is the same clock the value under test came from.
        const releasedAt = new Date();

        await holder.query('COMMIT');

        const settled = await pending;
        if (!settled.ok) {
          throw settled.error;
        }

        expect(settled.response.status).toBe(200);

        // `>=` rather than `>`: both instants come from the same clock and can land in
        // one millisecond. What discriminates is the ordering, not a margin. Under the
        // defect the stamp is taken early in the handler — after dispatch and before the
        // transaction, third statement rather than first — so it necessarily precedes the backend becoming blocked,
        // which precedes `waitForBlockedBy` observing it, which precedes this read.
        // Strictly ordered by construction rather than by a timing margin; an earlier
        // version of this comment said "before the request is dispatched", which the
        // handler cannot do.
        expect(
          new Date(settled.response.body.effective_at as string).getTime(),
        ).toBeGreaterThanOrEqual(releasedAt.getTime());
      } finally {
        try {
          await holder.query('ROLLBACK').catch(() => undefined);
        } finally {
          await holder.end();
        }
      }
    }, 20000);
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

    it('refuses a Leader correcting their own record spelled in uppercase', async () => {
      // **The check is two string comparisons, and a `uuid` column is not.** An id
      // in uppercase is the same record to the guard, to the lock and to every
      // read on this path — and was a different string to invariant 4, which is
      // the one place on the path that fails *open*. The actor this protects
      // against is the only one it protects against, so a bypass here is the whole
      // of the escalation section 7 keeps this capability Admin-only to prevent.
      await grantCorrectSexChurchWide(raymondAccount);

      const response = await correct(
        raymond.id.toUpperCase(),
        {
          sex: 'FEMALE',
          reason: 'Sex entered in error at encoding.',
          pastoral_leader_id: grace.id,
        },
        raymondAccount,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
      expect(response.body.error.message).toMatch(/your own pastoral assignment/);

      const person = await db
        .selectFrom('persons')
        .select('sex')
        .where('id', '=', raymond.id)
        .executeTakeFirstOrThrow();

      expect(person.sex).toBe('MALE');
    });

    it('refuses an upline spelled in uppercase', async () => {
      await grantCorrectSexChurchWide(raymondAccount);

      const response = await correct(
        oriel.id.toUpperCase(),
        { sex: 'FEMALE', reason: 'Sex entered in error at encoding.' },
        raymondAccount,
      );

      expect(response.status).toBe(403);
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

/**
 * Wait until some backend is blocked **by this holder**.
 *
 * Keyed on the holder's own backend pid through `pg_blocking_pids`, which names
 * exactly the wait this test created. A bare `pg_stat_activity` predicate is
 * cluster-wide — this machine also carries `dfc_dev`, and in CI the test role is a
 * superuser — so it would match waits the test knows nothing about.
 *
 * The budget is deliberately under the service's 3s `lock_timeout`: a wider one lets
 * a slow-but-correct run time out here and report the message a genuine regression
 * produces.
 */
async function waitForBlockedBy(holderPid: number): Promise<void> {
  const probe = createTestDb();

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await sql<{ count: string }>`
        SELECT count(*) AS count
          FROM pg_stat_activity
         WHERE ${holderPid}::int = ANY (pg_blocking_pids(pid))
      `.execute(probe);

      if (Number(waiting.rows[0].count) > 0) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Nothing ever blocked on backend ${holderPid}.`);
  } finally {
    await probe.destroy();
  }
}
