import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import { Client } from 'pg';

import { createTestDb, truncateAll } from '../setup/database';
import { manilaDayOf, startOfManilaDay } from '../../src/common/time/manila';
import { createCell, createPerson, EPOCH, type TestPerson } from '../setup/fixtures';

import type { Database } from '../../src/database/schema';

/**
 * The six tables migration 0009 creates, exercised against the database.
 *
 * A rule this repository states in prose and leaves to an application that does
 * not exist yet is the failure it keeps repeating, so every constraint in 0009 is
 * checked here by writing through it rather than by reading the migration. There
 * is no `cells` service yet: everything below is what the database refuses on its
 * own, which is the half that survives a developer forgetting a service-layer
 * check, and the half that `pg_restore` and a psql session are subject to.
 *
 * The structural half -- that the index exists, is unique, is partial, and that the
 * constraint triggers are deferred -- is in `schema.spec.ts`. Both are needed: a
 * constraint that exists but does not fire, and a rule that fires from application
 * code with no constraint behind it, look identical from a passing test of the
 * other kind.
 */
describe('the Cell tables (SKILL.md sections 10 and 11)', () => {
  let db: Kysely<Database>;
  let leader: TestPerson;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    leader = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  // -------------------------------------------------------------------------
  // cells (section 10)
  // -------------------------------------------------------------------------

  describe('cells', () => {
    it('assigns a Cell ID from the sequence, server-side and formatted', async () => {
      const cell = await createCell(db, { leader });

      expect(cell.cellId).toMatch(/^CELL-[0-9]{6,}$/);
    });

    it('never lets a Cell ID be rewritten', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db.updateTable('cells').set({ cell_id: 'CELL-999999' }).where('id', '=', cell.id).execute(),
      ).rejects.toThrow(/cell_id is immutable/);
    });

    it('never lets created_at move, because a schedule row may start at it', async () => {
      // Not a general tidiness rule. `cell_schedules_start_is_legal` admits a row
      // starting at exactly this instant, so moving it retroactively invalidates a
      // schedule row that was legal when written, with nothing that revisits it.
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cells')
          .set({ created_at: new Date('2020-01-01T00:00:00Z') })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/created_at is immutable/);
    });

    it('refuses a CLOSED state with no closure date', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db.updateTable('cells').set({ state: 'CLOSED' }).where('id', '=', cell.id).execute(),
      ).rejects.toThrow(/cells_closed_iff_closed_at/);
    });

    it('refuses a closure reason on a Cell that is still running', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cells')
          .set({ closure_reason: 'MEMBERS_DISPERSED' })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/cells_closure_reason_iff_closed/);
    });

    it('requires a note where the closure reason is OTHER', async () => {
      const cell = await createCell(db, { leader });

      await expect(closeCell(db, cell.id, { reason: 'OTHER' })).rejects.toThrow(
        /cells_other_requires_note/,
      );

      await expect(
        closeCell(db, cell.id, { reason: 'OTHER', note: 'the venue was sold' }),
      ).resolves.toBeUndefined();
    });

    it('never reverses a closure', async () => {
      // Section 10, Reopening, settled on 2026-08-28: a Cell closed by mistake is
      // corrected by creating a new Cell, and the mistaken closure stands in the
      // record. That is a rule an UPDATE can break.
      const cell = await createCell(db, { leader });
      await closeCell(db, cell.id, { reason: 'CREATED_IN_ERROR' });

      await expect(
        db
          .updateTable('cells')
          .set({ state: 'ACTIVE', closed_at: null, closure_reason: null })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/a closure is never reversed/);
    });

    it('never rewrites a closure that stands', async () => {
      const cell = await createCell(db, { leader });
      await closeCell(db, cell.id, { reason: 'CREATED_IN_ERROR' });

      await expect(
        db
          .updateTable('cells')
          .set({ closure_reason: 'MEMBERS_DISPERSED' })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/a closure is never reversed/);

      await expect(
        db
          .updateTable('cells')
          .set({ closed_at: new Date('2030-01-01T00:00:00Z') })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/a closure is never reversed/);
    });

    it('leaves the closed Cell intact after a refused reversal', async () => {
      // A trigger that raises and still lets the row change would pass every case
      // above while protecting nothing.
      const cell = await createCell(db, { leader });
      await closeCell(db, cell.id, { reason: 'CREATED_IN_ERROR' });

      await expect(
        db.updateTable('cells').set({ state: 'ACTIVE' }).where('id', '=', cell.id).execute(),
      ).rejects.toThrow();

      const row = await db
        .selectFrom('cells')
        .select(['state', 'closure_reason'])
        .where('id', '=', cell.id)
        .executeTakeFirstOrThrow();

      expect(row.state).toBe('CLOSED');
      expect(row.closure_reason).toBe('CREATED_IN_ERROR');
    });

    it('refuses a Cell created already CLOSED', async () => {
      // Every other rule lets this through: the leadership floor wants zero open
      // assignments for a CLOSED Cell and a fresh row has none, and the
      // configuration floor returns early for anything not ACTIVE. The result is a
      // Cell with no category and no schedule row at any point in its history, so
      // "historical reports must use the category valid at the time being reported"
      // has no answer for it. Section 10 has no path that mints a Cell already
      // closed.
      await expect(
        sql`
          INSERT INTO cells (state, closed_at, closure_reason)
          VALUES ('CLOSED', now(), 'CREATED_IN_ERROR')
        `.execute(db),
      ).rejects.toThrow(/cannot be created as CLOSED/);
    });

    it('refuses a malformed Cell ID', async () => {
      // The format check is otherwise unfalsifiable: every case takes the generated
      // default, which satisfies it by construction.
      await expect(sql`INSERT INTO cells (cell_id) VALUES ('CELL-12')`.execute(db)).rejects.toThrow(
        /cells_cell_id_format/,
      );
    });

    it('refuses a closure note with no reason', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cells')
          .set({ closure_note: 'a stray remark' })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/cells_note_only_with_reason/);
    });

    it('refuses a DELETE, naming the closure reason that exists for it', async () => {
      const cell = await createCell(db, { leader });

      await expect(db.deleteFrom('cells').where('id', '=', cell.id).execute()).rejects.toThrow(
        /never deleted/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // An ACTIVE Cell has exactly one leadership assignment (section 11)
  // -------------------------------------------------------------------------

  describe('an ACTIVE Cell has exactly one leadership assignment', () => {
    it('refuses an ACTIVE Cell created with no leader', async () => {
      // The *at least one* half, which no unique index can express: it is a
      // statement about a row that is absent.
      await expect(
        sql`
          WITH new_cell AS (
            INSERT INTO cells DEFAULT VALUES RETURNING id, created_at
          ), category AS (
            INSERT INTO cell_categories (cell_id, category, started_at)
            SELECT id, 'YOUTH'::cell_category, created_at FROM new_cell
          )
          INSERT INTO cell_schedules (cell_id, day_of_week, time_of_day, started_at)
          SELECT id, 6::smallint, '19:00'::time, created_at FROM new_cell
        `.execute(db),
      ).rejects.toThrow(/has 0 open leadership assignment/);
    });

    it('refuses a second open leadership on one Cell', async () => {
      // The *at most one* half, held by a unique index rather than by the trigger
      // -- which is what makes it hold under concurrent writes too.
      const cell = await createCell(db, { leader });
      const other = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });

      await expect(
        db
          .insertInto('cell_leaderships')
          .values({ person_id: other.id, cell_id: cell.id, started_at: await dbNow(db) })
          .execute(),
      ).rejects.toThrow(/cell_leaderships_one_open_per_cell/);
    });

    it('refuses ending the only leadership of an ACTIVE Cell', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cell_leaderships')
          .set({ ended_at: await dbNow(db) })
          .where('cell_id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/has 0 open leadership assignment/);
    });

    it('accepts a handover: one closes and one opens in the same transaction', async () => {
      // Deferred is what makes this possible at all. The Cell is momentarily
      // leaderless between the two writes, and a check firing per statement would
      // reject whichever ran first -- making the operation section 10 requires
      // unperformable.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const at = await dbNow(db);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();

        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
          .execute();
      });

      const open = await db
        .selectFrom('cell_leaderships')
        .select('person_id')
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ person_id: incoming.id }]);
    });

    it('refuses closing a Cell while its leadership stays open', async () => {
      // Written against the table rather than through `closeCell`, because that
      // helper ends the leadership -- which is the whole of what this case is
      // checking cannot be skipped.
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cells')
          .set({
            state: 'CLOSED',
            closed_at: await dbNow(db),
            closure_reason: 'LEADER_STEPPED_DOWN',
          })
          .where('id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/is CLOSED and has 1 open leadership assignment/);
    });

    it('refuses a leadership assignment that outlives its Cell', async () => {
      // Counting open rows alone admitted this: a leadership ended four hundred days
      // after its Cell closed satisfies "zero open", and by section 11 makes that
      // person a current Cell Leader of a closed Cell for the whole period.
      // `cells_record_is_final` freezes `closed_at` on the ground that it is the
      // date these ended on, which was asserted in a comment and enforced nowhere.
      const cell = await createCell(db, { leader });
      const at = await dbNow(db);
      const later = new Date(at.getTime() + 400 * 24 * 60 * 60 * 1000);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cells')
            .set({ state: 'CLOSED', closed_at: at, closure_reason: 'MEMBERS_DISPERSED' })
            .where('id', '=', cell.id)
            .execute();
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: later })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
        }),
      ).rejects.toThrow(/ending after its closure date/);
    });

    it('accepts a closure that ends the leadership on the same date', async () => {
      const cell = await createCell(db, { leader });

      await closeCell(db, cell.id, { reason: 'MEMBERS_DISPERSED' });

      const cellRow = await db
        .selectFrom('cells')
        .select(['state', 'closed_at'])
        .where('id', '=', cell.id)
        .executeTakeFirstOrThrow();
      const leadership = await db
        .selectFrom('cell_leaderships')
        .select('ended_at')
        .where('cell_id', '=', cell.id)
        .executeTakeFirstOrThrow();

      expect(cellRow.state).toBe('CLOSED');
      expect(leadership.ended_at).toEqual(cellRow.closed_at);
    });
  });

  // -------------------------------------------------------------------------
  // An ACTIVE Cell is configured (section 10, Creating a Cell)
  // -------------------------------------------------------------------------

  describe('an ACTIVE Cell carries a category and a schedule', () => {
    it('refuses an ACTIVE Cell with no schedule row', async () => {
      // docs/ROADMAP.md names this omission as the single risk of Stage 3: a Cell
      // created without a schedule row has no derivable set of scheduled meetings
      // and therefore no coverage figure for its first month.
      await expect(
        sql`
          WITH new_cell AS (
            INSERT INTO cells DEFAULT VALUES RETURNING id, created_at
          ), category AS (
            INSERT INTO cell_categories (cell_id, category, started_at)
            SELECT id, 'YOUTH'::cell_category, created_at FROM new_cell
          )
          INSERT INTO cell_leaderships (person_id, cell_id, started_at)
          SELECT ${leader.id}::uuid, id, created_at FROM new_cell
        `.execute(db),
      ).rejects.toThrow(/no open schedule row/);
    });

    it('refuses an ACTIVE Cell with no category row', async () => {
      await expect(
        sql`
          WITH new_cell AS (
            INSERT INTO cells DEFAULT VALUES RETURNING id, created_at
          ), schedule AS (
            INSERT INTO cell_schedules (cell_id, day_of_week, time_of_day, started_at)
            SELECT id, 6::smallint, '19:00'::time, created_at FROM new_cell
          )
          INSERT INTO cell_leaderships (person_id, cell_id, started_at)
          SELECT ${leader.id}::uuid, id, created_at FROM new_cell
        `.execute(db),
      ).rejects.toThrow(/no open category row/);
    });

    it('refuses closing the only schedule row without opening another', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .updateTable('cell_schedules')
          .set({ ended_at: firstOfNextMonthInManila() })
          .where('cell_id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/no open schedule row/);
    });

    it('accepts a schedule change: one closes and one opens at the same instant', async () => {
      const cell = await createCell(db, { leader });
      const effective = firstOfNextMonthInManila();

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_schedules')
          .set({ ended_at: effective })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();

        await trx
          .insertInto('cell_schedules')
          .values({
            cell_id: cell.id,
            day_of_week: 7,
            time_of_day: '18:00',
            started_at: effective,
          })
          .execute();
      });

      const open = await db
        .selectFrom('cell_schedules')
        .select('day_of_week')
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ day_of_week: 7 }]);
    });

    it('leaves the closed schedule row in place, so a past month reads the old day', async () => {
      // The whole reason this table is effective-dated (section 10, Schedule
      // changes): moving a Cell from Saturday to Sunday must not rewrite the
      // coverage figure for every earlier month.
      const cell = await createCell(db, { leader, dayOfWeek: 6 });
      const effective = firstOfNextMonthInManila();

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_schedules')
          .set({ ended_at: effective })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_schedules')
          .values({
            cell_id: cell.id,
            day_of_week: 7,
            time_of_day: '18:00',
            started_at: effective,
          })
          .execute();
      });

      const rows = await db
        .selectFrom('cell_schedules')
        .select(['day_of_week', 'ended_at'])
        .where('cell_id', '=', cell.id)
        .orderBy('started_at')
        .execute();

      expect(rows).toHaveLength(2);
      expect(rows[0].day_of_week).toBe(6);
      expect(rows[0].ended_at).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // A schedule row starts on a first of month in Asia/Manila, or at created_at
  // -------------------------------------------------------------------------

  describe('when a schedule row may start (section 10, Schedule changes)', () => {
    it('accepts the Cell created_at, which is a Cell created part-way through a month', async () => {
      // Asserted through the fixture, which is the only writer that can produce
      // this: equality with a column on another table is exact.
      await expect(createCell(db, { leader })).resolves.toBeDefined();
    });

    it('accepts Manila midnight on the first of a month', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        replaceSchedule(db, cell.id, firstOfNextMonthInManila()),
      ).resolves.toBeUndefined();
    });

    it('refuses a date part-way through a month', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        replaceSchedule(db, cell.id, new Date('2030-03-15T00:00:00+08:00')),
      ).rejects.toThrow(/neither the first of a month in Asia\/Manila/);
    });

    it('refuses UTC midnight on the first, which is 08:00 in Manila', async () => {
      // The case that pins the zone rather than the calendar. A trigger evaluating
      // `date_trunc('month', ...)` in UTC accepts this and refuses every legitimate
      // row -- and the defect hides in exactly the rows the rule is not about.
      const cell = await createCell(db, { leader });

      await expect(replaceSchedule(db, cell.id, new Date('2030-03-01T00:00:00Z'))).rejects.toThrow(
        /neither the first of a month in Asia\/Manila/,
      );
    });

    it('accepts the instant Manila calls the first, which is 16:00 UTC on the last day before', async () => {
      // The same instant as the case above, written the other way round: this is
      // what a legitimate row actually looks like in the column.
      const cell = await createCell(db, { leader });

      await expect(
        replaceSchedule(db, cell.id, startOfManilaDay('2030-03-01')),
      ).resolves.toBeUndefined();
    });

    it('gives the same answers whatever time zone the session is in', async () => {
      // **The two cases above do not pin the zone on their own, and finding that out
      // is why this exists.** A trigger written as a bare `date_trunc('month', ...)`
      // resolves in the *session's* TimeZone -- so on a server set to any UTC+8 zone
      // it agrees with the Asia/Manila form on every date, and both cases pass. The
      // development machine this was written on runs `Asia/Kuala_Lumpur`; CI's
      // PostgreSQL runs UTC. A pair of cases that says "correct" on one and
      // "correct" on the other for opposite reasons is worse than a weak pair.
      //
      // This forces the disagreement into the open. Under `SET LOCAL TIME ZONE
      // 'UTC'` the two implementations give opposite verdicts on both instants, so a
      // bare `date_trunc` fails here on whatever machine the suite runs.
      //
      // `SET LOCAL` rather than `SET`: it reverts at the end of the transaction, so
      // nothing leaks onto the next occupant of a pooled connection.
      const cell = await createCell(db, { leader });

      await expect(
        db.transaction().execute(async (trx) => {
          await sql`SET LOCAL TIME ZONE 'UTC'`.execute(trx);
          await trx
            .updateTable('cell_schedules')
            .set({ ended_at: startOfManilaDay('2030-03-01') })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_schedules')
            .values({
              cell_id: cell.id,
              day_of_week: 7,
              time_of_day: '18:00',
              started_at: startOfManilaDay('2030-03-01'),
            })
            .execute();
        }),
      ).resolves.toBeUndefined();

      const later = await createCell(db, { leader });

      await expect(
        db.transaction().execute(async (trx) => {
          await sql`SET LOCAL TIME ZONE 'UTC'`.execute(trx);
          await trx
            .updateTable('cell_schedules')
            .set({ ended_at: new Date('2030-03-01T00:00:00Z') })
            .where('cell_id', '=', later.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_schedules')
            .values({
              cell_id: later.id,
              day_of_week: 7,
              time_of_day: '18:00',
              started_at: new Date('2030-03-01T00:00:00Z'),
            })
            .execute();
        }),
      ).rejects.toThrow(/neither the first of a month in Asia\/Manila/);
    });

    it('refuses a day number outside the ISO range', async () => {
      const cell = await createCell(db, { leader });

      for (const day of [0, 8]) {
        await expect(replaceSchedule(db, cell.id, firstOfNextMonthInManila(), day)).rejects.toThrow(
          /cell_schedules_day_of_week_iso/,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // cell_memberships (section 10, Managing Cell membership)
  // -------------------------------------------------------------------------

  describe('cell_memberships', () => {
    it('refuses a second open membership for one person', async () => {
      const cellA = await createCell(db, { leader });
      const cellB = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await addMember(db, cellA.id, member.id);

      await expect(addMember(db, cellB.id, member.id)).rejects.toThrow(/cell_memberships_one_open/);
    });

    it('moves a member between Cells in one transaction, leaving one open row', async () => {
      const cellA = await createCell(db, { leader });
      const cellB = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await addMember(db, cellA.id, member.id);
      const at = await dbNow(db);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_memberships')
          .set({ ended_at: at })
          .where('person_id', '=', member.id)
          .where('ended_at', 'is', null)
          .execute();
        await addMember(trx, cellB.id, member.id, at);
      });

      const open = await db
        .selectFrom('cell_memberships')
        .select('cell_id')
        .where('person_id', '=', member.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ cell_id: cellB.id }]);
    });

    it('permits zero memberships, which section 10 says is legitimate', async () => {
      const person = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });

      const open = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('person_id', '=', person.id)
        .execute();

      expect(open).toEqual([]);
    });

    it('refuses a member whose Network is not the Cell leader own', async () => {
      // The homogeneous-network rule reaching Cell membership (section 10,
      // section 4), enforced where the pastoral edge's equivalent is: in the
      // database, so it holds however the row is written.
      const cell = await createCell(db, { leader });
      const outsider = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });

      await expect(addMember(db, cell.id, outsider.id)).rejects.toThrow(/crosses Networks/);
    });

    it('reads the Cell leader as of the membership own start', async () => {
      // Pins the instant the *leader lookup* uses: at EPOCH the Cell did not exist,
      // so there is no leader to compare against. It says nothing about the instant
      // the Network comparison uses, which is the case below -- the two were one
      // case before, and its title claimed the second while its body pinned only the
      // first.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });

      await expect(addMember(db, cell.id, member.id, EPOCH)).rejects.toThrow(/had no leader as of/);
    });

    it('compares Networks as of the membership own start, not as of now', async () => {
      // A membership must have been legal when it was opened; validating against
      // `now()` would reject a correction that was true at the time.
      //
      // **No case pinned this before, because no fixture gave anybody a Network that
      // changed** -- so `network_as_of(person, started_at)` could be rewritten to
      // `network_as_of(person, now())` with the whole suite green. The member below
      // joins while both they and the leader are MENS, moves to WOMENS afterwards,
      // and the membership row is then touched so the deferred trigger fires again.
      // Comparing at the membership's own start finds MENS on both sides and passes.
      //
      // The Network change itself is accepted, and that is section 10's second
      // direction -- a change that strands a membership -- which this trigger does
      // not cover and which the migration says belongs to `networks`.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      const joined = await dbNow(db);
      await addMember(db, cell.id, member.id, joined);

      // **One millisecond, not one second.** `now()` is a few milliseconds after
      // `joined`, so dating the change a second ahead puts it in the future: the
      // member is still MENS when the trigger runs, and the case passes without ever
      // exercising a Network that changed. That is how the first version of this
      // was written, and mutating the comparison instant to `now()` left it green.
      const moved = new Date(joined.getTime() + 1);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('network_assignments')
          .set({ ended_at: moved })
          .where('person_id', '=', member.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('network_assignments')
          .values({ person_id: member.id, network: 'WOMENS', started_at: moved })
          .execute();
      });

      await expect(
        db
          .updateTable('cell_memberships')
          .set({ reason: 'touched, so the deferred trigger runs again' })
          .where('person_id', '=', member.id)
          .execute(),
      ).resolves.toBeDefined();
    });

    it('refuses a handover that would strand the Cell members in the other Network', async () => {
      // A Cell takes its Network from its leader (section 11), so a leadership write
      // moves every existing membership at once. Section 10 makes approval reject
      // this by name; it is expressible here, so it does not wait for an endpoint.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      const incoming = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });
      await addMember(db, cell.id, member.id);
      const at = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
            .execute();
        }),
      ).rejects.toThrow(/do not share a Network/);
    });

    it('refuses a cross-Network handover even where the Cell has no members', async () => {
      // **This case replaces one that asserted the opposite.** The first version of
      // the trigger compared the incoming leader against the Cell's *members*, so a
      // memberless Cell changed Networks freely -- and a test was written asserting
      // that a cross-Network handover succeeds once the members are moved out, which
      // pinned an operation section 10 forbids outright.
      //
      // Section 10 is unconditional and is about the two leaders: reject "where the
      // incoming leader and the Cell's current leader do not share a Network". A Cell
      // takes its Network from its leader, and no operation this specification
      // defines moves a Cell between Networks.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });
      const at = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
            .execute();
        }),
      ).rejects.toThrow(/do not share a Network/);
    });

    it('refuses a cross-Network handover where the two rows do not abut', async () => {
      // **The mutation neither case above survives.** Both write the close and the
      // open at one shared instant, so both fail against *removing* the rule and pass
      // against the version that had it -- which selected the outgoing assignment
      // with `ended_at >= started_at` and therefore found nothing when the two rows
      // were a microsecond apart, skipping the whole check. The rule failed open.
      //
      // Section 10 records that exact trap two subsections away, about the Cell and
      // its schedule row: an application-computed timestamp beside a `DEFAULT now()`
      // differs by microseconds. This is what an approval endpoint reading the clock
      // twice would produce by accident.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Ana', network: 'WOMENS' });
      const ends = await dbNow(db);
      const begins = new Date(ends.getTime() + 1);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: ends })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: incoming.id, cell_id: cell.id, started_at: begins })
            .execute();
        }),
      ).rejects.toThrow(/not contiguous/);
    });

    it('refuses a gap between one leader and the next, whatever their Networks', async () => {
      // Section 10: the outgoing assignment ends and the incoming one opens "at the
      // same instant". Section 11: a Cell with no leader "must be impossible rather
      // than merely unusual". Counting open rows at COMMIT satisfies neither -- a
      // Cell leaderless for a microsecond passes the count while "who led this Cell
      // at that instant" has no answer, and `assert_membership_same_network` already
      // treats a leaderless instant as an error from the other side.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const ends = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: ends })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({
              person_id: incoming.id,
              cell_id: cell.id,
              started_at: new Date(ends.getTime() + 60_000),
            })
            .execute();
        }),
      ).rejects.toThrow(/not contiguous/);
    });

    it('refuses a leadership that overlaps the one before it', async () => {
      // The mirror shape: an incoming row backdated before the outgoing row's end.
      // The partial unique index catches it only where both rows are open.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const ends = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: ends })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({
              person_id: incoming.id,
              cell_id: cell.id,
              started_at: new Date(ends.getTime() - 1),
            })
            .execute();
        }),
      ).rejects.toThrow(/not contiguous/);
    });

    it('accepts a handover after a correction at the Cell own creation instant', async () => {
      // **The case that pins the predecessor tie-break**, which nothing did.
      // `ORDER BY started_at DESC, ended_at DESC NULLS FIRST, id DESC` exists because
      // a section 5 correction closes a row and opens the right one at the same
      // instant, leaving two rows sharing a `started_at`. Dropping `ended_at DESC`
      // left the whole suite green, because no other case ever creates that shape --
      // and run against it, the mutant refused a legitimate handover on some runs and
      // not others, decided by which UUID happened to sort first.
      //
      // So this is written to be deterministic where the mutant is not: it builds the
      // shared-instant pair, then hands the Cell on, and the handover must be
      // accepted every time.
      const cell = await createCell(db, { leader });
      const corrected = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const incoming = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });

      // **The correction is written as one SQL statement, and it has to be.** Reading
      // `created_at` into a JavaScript `Date` truncates it to the millisecond, so the
      // value written back lands *before* the real one and
      // `cell_leaderships_period_ordered` refuses the close. Section 10 prescribes
      // exactly this for the Cell and its schedule row -- "the schedule row and the
      // Cell are written from one expression", because equality with a column on
      // another table is exact -- and a correction to a row anchored at `created_at`
      // is the same problem.
      // **Two statements in one transaction, not one statement with CTEs.** A
      // data-modifying CTE sees the snapshot the statement began with, so the insert
      // would not see the close and would collide with it on
      // `cell_leaderships_one_open_per_cell`.
      await db.transaction().execute(async (trx) => {
        await sql`
          UPDATE cell_leaderships
             SET ended_at = (SELECT created_at FROM cells WHERE id = ${cell.id})
           WHERE cell_id = ${cell.id} AND ended_at IS NULL
        `.execute(trx);
        // **The corrected row takes the lowest possible id, and that is what makes
        // this case deterministic.** Without `ended_at DESC` the ordering falls back
        // to `id DESC`, so which row is picked depends on which UUID happened to sort
        // higher -- and the case then caught the mutant on roughly two runs in three,
        // which is not a pin. Forcing this id below any generated one makes the
        // erroneous row win the fallback every time, so the mutant is refused every
        // time while the real ordering, which reads `ended_at`, is unaffected.
        await sql`
          INSERT INTO cell_leaderships (id, person_id, cell_id, started_at)
          SELECT '00000000-0000-4000-8000-000000000000'::uuid, ${corrected.id}, id, created_at
            FROM cells WHERE id = ${cell.id}
        `.execute(trx);
      });

      const at = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
            .execute();
        }),
      ).resolves.toBeUndefined();
    });

    it('refuses a leadership row created already ended', async () => {
      // No operation section 10 or 11 defines writes one, and such a row reaches
      // neither the contiguity check nor the leader-to-leader check -- so a closed row
      // overlapping the open one committed, and `assert_membership_same_network` then
      // read it as the Cell's leader and refused a legitimate member of the Cell's own
      // Network.
      const cell = await createCell(db, { leader });
      const other = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const at = await dbNow(db);

      await expect(
        db
          .insertInto('cell_leaderships')
          .values({
            person_id: other.id,
            cell_id: cell.id,
            started_at: at,
            ended_at: new Date(at.getTime() + 1000),
          })
          .execute(),
      ).rejects.toThrow(/cannot be created already ended/);
    });

    it('never lets a leadership that has ended be re-ended', async () => {
      // Section 5: a row that has been closed is not overwritten in place. Without
      // it, moving a closed predecessor's end breaks the chain behind a successor
      // that nothing re-validates -- the index still sees one open row and the count
      // still reads one.
      const cell = await createCell(db, { leader });
      const incoming = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const at = await dbNow(db);

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: at })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
          .execute();
      });

      await expect(
        db
          .updateTable('cell_leaderships')
          .set({ ended_at: new Date(at.getTime() + 86_400_000) })
          .where('cell_id', '=', cell.id)
          .where('person_id', '=', leader.id)
          .execute(),
      ).rejects.toThrow(/not overwritten in place/);
    });

    it('accepts a handover within the Cell own Network', async () => {
      // The permitted operation, so the rule above cannot be tightened into refusing
      // every handover and still pass.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      const incoming = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      await addMember(db, cell.id, member.id);
      const at = await dbNow(db);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .insertInto('cell_leaderships')
            .values({ person_id: incoming.id, cell_id: cell.id, started_at: at })
            .execute();
        }),
      ).resolves.toBeUndefined();
    });

    it('refuses closing a Cell while a member is still in it', async () => {
      // Section 10's closure list has three bullets and this is the third: "active
      // memberships end on that date, preserving every membership record in full".
      // The consequence of leaving it unenforced is the one section 10 names --
      // `cell_memberships_one_open` is over the person, so somebody left open in a
      // closed Cell can join no other.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await addMember(db, cell.id, member.id);

      await expect(
        db.transaction().execute(async (trx) => {
          const at = await dbNow(trx);
          await trx
            .updateTable('cells')
            .set({ state: 'CLOSED', closed_at: at, closure_reason: 'MEMBERS_DISPERSED' })
            .where('id', '=', cell.id)
            .execute();
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
        }),
      ).rejects.toThrow(/open membership/);
    });

    it('refuses adding a member to a Cell that is already closed', async () => {
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await closeCell(db, cell.id, { reason: 'MEMBERS_DISPERSED' });

      await expect(addMember(db, cell.id, member.id)).rejects.toThrow(/open membership/);
    });

    it('refuses a membership that outlives its Cell', async () => {
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await addMember(db, cell.id, member.id);
      const at = await dbNow(db);
      const later = new Date(at.getTime() + 400 * 24 * 60 * 60 * 1000);

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cells')
            .set({ state: 'CLOSED', closed_at: at, closure_reason: 'MEMBERS_DISPERSED' })
            .where('id', '=', cell.id)
            .execute();
          await trx
            .updateTable('cell_leaderships')
            .set({ ended_at: at })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
          await trx
            .updateTable('cell_memberships')
            .set({ ended_at: later })
            .where('cell_id', '=', cell.id)
            .where('ended_at', 'is', null)
            .execute();
        }),
      ).rejects.toThrow(/ending after its closure date/);
    });

    it('refuses the second of two concurrent memberships for one person', async () => {
      // A sequential case passes against application-layer checks alone and says
      // nothing about whether the index exists -- the lesson CLAUDE.md records for
      // authorization case 7, and the same index shape section 5 gives pastoral
      // assignment.
      //
      // **The wait is asserted rather than assumed.** Firing the second write and
      // committing the first without checking that the second actually blocked
      // leaves the ordering to chance: if the second statement reaches the server
      // after the first commits, it fails against a committed row, which is the
      // sequential case wearing a concurrent costume.
      const cellA = await createCell(db, { leader });
      const cellB = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      const at = await dbNow(db);

      const [one, two] = [await openClient(), await openClient()];

      try {
        const pid = Number(
          (await two.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await one.query('BEGIN');
        await two.query('BEGIN');

        await one.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [member.id, cellA.id, at],
        );

        const blocked = settled(
          two.query(
            'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
            [member.id, cellB.id, at],
          ),
        );

        await waitForBlocked(db, pid, 'cell_memberships_one_open');
        await one.query('COMMIT');

        expect((await blocked)?.message).toMatch(/cell_memberships_one_open/);
        await two.query('ROLLBACK');
      } finally {
        await one.end();
        await two.end();
      }

      const open = await db
        .selectFrom('cell_memberships')
        .select('cell_id')
        .where('person_id', '=', member.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ cell_id: cellA.id }]);
    });

    it('refuses a DELETE', async () => {
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await addMember(db, cell.id, member.id);

      await expect(
        db.deleteFrom('cell_memberships').where('person_id', '=', member.id).execute(),
      ).rejects.toThrow(/never deleted/);
    });
  });

  // -------------------------------------------------------------------------
  // cell_leadership_requests (section 10, Creating a Cell)
  // -------------------------------------------------------------------------

  describe('cell_leadership_requests', () => {
    let requester: string;
    let approver: string;
    let prospective: TestPerson;

    beforeEach(async () => {
      requester = await createBareAccount(db, 'requester');
      approver = await createBareAccount(db, 'approver');
      prospective = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    });

    it('requires a Cell on a handover', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            kind: 'HANDOVER',
            prospective_leader_id: prospective.id,
            requested_by: requester,
          })
          .execute(),
      ).rejects.toThrow(/handover_names_a_cell/);
    });

    it('requires category, day and time on a new Cell', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            kind: 'NEW_CELL',
            prospective_leader_id: prospective.id,
            requested_by: requester,
          })
          .execute(),
      ).rejects.toThrow(/new_cell_configuration/);
    });

    it('refuses a handover that carries a category, day and time', async () => {
      // Nothing else about the Cell changes on a handover: it keeps its category
      // history and its schedule history, neither of which is a fact about who
      // leads it. A handover promising otherwise is refused rather than ignored.
      const cell = await createCell(db, { leader });

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            kind: 'HANDOVER',
            prospective_leader_id: prospective.id,
            requested_by: requester,
            cell_id: cell.id,
            category: 'YOUTH',
            day_of_week: 6,
            time_of_day: '19:00',
          })
          .execute(),
      ).rejects.toThrow(/new_cell_configuration/);
    });

    it('refuses half a configuration', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            kind: 'HANDOVER',
            prospective_leader_id: prospective.id,
            requested_by: requester,
            cell_id: cell.id,
            day_of_week: 6,
            time_of_day: '19:00',
          })
          .execute(),
      ).rejects.toThrow(/configuration_is_whole/);
    });

    it('never lets the requester approve their own request', async () => {
      // Section 10's enforceable control, and it is explicit that this is what
      // must be checked on every approval -- not that the two capabilities never
      // meet in one actor, which an Admin-issued grant can undo.
      //
      // **A self-*decline* is deliberately not pinned either way.** Section 10
      // states the prohibition about approval and says nothing about declining, and
      // an earlier version of this schema extended it by fiat -- which left a
      // single-Admin deployment unable to dispose of its own request at all, since
      // Admin alone approves. A case asserting either direction would pin a rule
      // nobody has made. It is escalated in CLAUDE.md instead.
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'APPROVED',
            decided_by: requester,
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/approver_is_not_requester/);
    });

    it('refuses an approved new-Cell request that names no Cell', async () => {
      // "For NEW_CELL, null until approval sets it" (section 10). An approval that
      // minted nothing is an approved request with no Cell.
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'APPROVED',
            decided_by: approver,
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/new_cell_names_its_cell_at_approval/);
    });

    it('refuses a pending new-Cell request that already names one', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({ ...newCellRequest(prospective.id, requester), cell_id: cell.id })
          .execute(),
      ).rejects.toThrow(/new_cell_has_no_cell_before_approval/);
    });

    it('refuses a decided request with no decision date, and a pending one that has one', async () => {
      // Both halves are written against `decided_at` alone, with `decided_by`
      // consistent, because the neighbouring `decided_by_iff_decided` is checked
      // first otherwise and this constraint would have nothing that could fail on
      // it.
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'APPROVED',
            decided_by: approver,
          })
          .execute(),
      ).rejects.toThrow(/decided_at_iff_decided/);

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({ ...newCellRequest(prospective.id, requester), decided_at: new Date() })
          .execute(),
      ).rejects.toThrow(/decided_at_iff_decided/);
    });

    it('refuses a note with no decline reason', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({ ...newCellRequest(prospective.id, requester), note: 'a stray remark' })
          .execute(),
      ).rejects.toThrow(/note_only_with_reason/);
    });

    it('never lets a decision be withdrawn or rewritten', async () => {
      // Section 10: declined requests "are retained -- they are part of the record of
      // how a leader was developed". Refusing a DELETE and permitting an UPDATE that
      // nulls the decision columns closes one route to the same act and leaves the
      // other open, which is what the first version of this schema did.
      const inserted = await db
        .insertInto('cell_leadership_requests')
        .values({
          ...newCellRequest(prospective.id, requester),
          state: 'DECLINED',
          decline_reason: 'TIMING_DEFERRED',
          decided_by: approver,
          decided_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .updateTable('cell_leadership_requests')
          .set({
            state: 'PENDING',
            decline_reason: null,
            decided_by: null,
            decided_at: null,
          })
          .where('id', '=', inserted.id)
          .execute(),
      ).rejects.toThrow(/already decided/);

      const row = await db
        .selectFrom('cell_leadership_requests')
        .select(['state', 'decline_reason', 'decided_by'])
        .where('id', '=', inserted.id)
        .executeTakeFirstOrThrow();

      expect(row.state).toBe('DECLINED');
      expect(row.decline_reason).toBe('TIMING_DEFERRED');
      expect(row.decided_by).toBe(approver);
    });

    it('never lets a request kind, subject or author be rewritten', async () => {
      // Editing these turns one person's request into another's while keeping the
      // original's audit trail. Refused while PENDING as well as after, which is the
      // half a decided-only check would miss.
      //
      // **Deliberately not the category, day and time**, which are what a NEW_CELL
      // request asks *for*: section 10 puts no rule on revising them before a
      // decision, and freezing them would forbid correcting a mistyped time without
      // declining and resubmitting. The case below pins that they stay editable, so
      // the trigger cannot be widened to match a message that once claimed more than
      // it covered.
      const other = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
      const inserted = await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .updateTable('cell_leadership_requests')
          .set({ prospective_leader_id: other.id })
          .where('id', '=', inserted.id)
          .execute(),
      ).rejects.toThrow(/are immutable/);

      await expect(
        db
          .updateTable('cell_leadership_requests')
          .set({ requested_by: approver })
          .where('id', '=', inserted.id)
          .execute(),
      ).rejects.toThrow(/are immutable/);
    });

    it('lets a pending request have its day and time corrected', async () => {
      const inserted = await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .updateTable('cell_leadership_requests')
          .set({ day_of_week: 7, time_of_day: '18:30' })
          .where('id', '=', inserted.id)
          .execute(),
      ).resolves.toBeDefined();
    });

    it('records a decision on a pending request, which is what writes those columns', async () => {
      // The permitted transition, asserted so the trigger above cannot be tightened
      // into refusing the one UPDATE the workflow actually performs.
      const inserted = await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .updateTable('cell_leadership_requests')
          .set({
            state: 'DECLINED',
            decline_reason: 'LEADER_DEVELOPMENT_CONTINUING',
            decided_by: approver,
            decided_at: new Date(),
          })
          .where('id', '=', inserted.id)
          .execute(),
      ).resolves.toBeDefined();
    });

    it('refuses a decided request with no decider, and a pending one that has one', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'APPROVED',
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/decided_by_iff_decided/);

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({ ...newCellRequest(prospective.id, requester), decided_by: approver })
          .execute(),
      ).rejects.toThrow(/decided_by_iff_decided/);
    });

    it('requires a reason on a decline and forbids one anywhere else', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'DECLINED',
            decided_by: approver,
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/reason_iff_declined/);

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            decline_reason: 'TIMING_DEFERRED',
          })
          .execute(),
      ).rejects.toThrow(/reason_iff_declined/);
    });

    it('requires a note where the decline reason is OTHER', async () => {
      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values({
            ...newCellRequest(prospective.id, requester),
            state: 'DECLINED',
            decline_reason: 'OTHER',
            decided_by: approver,
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/other_requires_note/);
    });

    it('permits one pending new-Cell request per prospective leader and no second', async () => {
      await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .execute();

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values(newCellRequest(prospective.id, requester))
          .execute(),
      ).rejects.toThrow(/one_pending_new_cell/);
    });

    it('permits a second new-Cell request once the first is decided', async () => {
      // A leader may legitimately lead many Cells. The index is partial over
      // PENDING for that reason, and declined requests are retained.
      await db
        .insertInto('cell_leadership_requests')
        .values({
          ...newCellRequest(prospective.id, requester),
          state: 'DECLINED',
          decline_reason: 'TIMING_DEFERRED',
          decided_by: approver,
          decided_at: new Date(),
        })
        .execute();

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values(newCellRequest(prospective.id, requester))
          .execute(),
      ).resolves.toBeDefined();
    });

    it('permits one pending handover per Cell and no second', async () => {
      const cell = await createCell(db, { leader });
      const other = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });

      await db
        .insertInto('cell_leadership_requests')
        .values(handoverRequest(prospective.id, requester, cell.id))
        .execute();

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values(handoverRequest(other.id, requester, cell.id))
          .execute(),
      ).rejects.toThrow(/one_pending_handover/);
    });

    it('permits a pending new Cell and a pending handover for the same person', async () => {
      // Neither uniqueness rule is widened to cover both kinds, and this is the
      // case that would break if one were: two different questions about two
      // different Cells, both legitimate. `DUPLICATE_REQUEST` exists so a person
      // adjudicates a case like this rather than an index refusing it.
      const cell = await createCell(db, { leader });

      await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .execute();

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values(handoverRequest(prospective.id, requester, cell.id))
          .execute(),
      ).resolves.toBeDefined();
    });

    it('permits pending handovers of two different Cells at once', async () => {
      const cellA = await createCell(db, { leader });
      const cellB = await createCell(db, { leader });

      await db
        .insertInto('cell_leadership_requests')
        .values(handoverRequest(prospective.id, requester, cellA.id))
        .execute();

      await expect(
        db
          .insertInto('cell_leadership_requests')
          .values(handoverRequest(prospective.id, requester, cellB.id))
          .execute(),
      ).resolves.toBeDefined();
    });

    it('refuses a DELETE, because a declined request is part of the record', async () => {
      await db
        .insertInto('cell_leadership_requests')
        .values(newCellRequest(prospective.id, requester))
        .execute();

      await expect(db.deleteFrom('cell_leadership_requests').execute()).rejects.toThrow(
        /never deleted/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // The constraints nothing else reaches
  // -------------------------------------------------------------------------

  describe('the constraints the workflows do not exercise', () => {
    it('refuses a second open category row for one Cell', async () => {
      const cell = await createCell(db, { leader });

      await expect(
        db
          .insertInto('cell_categories')
          .values({ cell_id: cell.id, category: 'COUPLE', started_at: await dbNow(db) })
          .execute(),
      ).rejects.toThrow(/cell_categories_one_open/);
    });

    it.each([
      ['cell_categories', 'cell_categories_period_ordered'],
      ['cell_schedules', 'cell_schedules_period_ordered'],
      ['cell_leaderships', 'cell_leaderships_period_ordered'],
    ])('refuses a %s row ending before it started', async (table, constraintName) => {
      // Nothing else writes an inverted period, so each of these checks could be
      // deleted with the rest of the suite green. The check is a row-level CHECK and
      // fires at the statement, ahead of the deferred triggers that would otherwise
      // object to the same write for a different reason.
      const cell = await createCell(db, { leader });
      const before = new Date(Date.now() - 60 * 60 * 1000);

      await expect(
        db
          .updateTable(table as 'cell_categories')
          .set({ ended_at: before })
          .where('cell_id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(new RegExp(constraintName));
    });

    it('refuses a cell_memberships row ending before it started', async () => {
      // Apart from the others because `createCell` opens no membership, so the
      // shared case updated nothing and passed while asserting a rejection. Left as
      // its own case rather than folded back in, because a parameterised case that
      // silently matches no rows is the shape worth not repeating.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      await addMember(db, cell.id, member.id);

      await expect(
        db
          .updateTable('cell_memberships')
          .set({ ended_at: new Date(Date.now() - 60 * 60 * 1000) })
          .where('cell_id', '=', cell.id)
          .execute(),
      ).rejects.toThrow(/cell_memberships_period_ordered/);
    });

    it('refuses a member added to a Cell being closed concurrently', async () => {
      // **The case that was missing, and the rule it covers was broken without it.**
      // The leadership floor is a counting trigger and is safe anyway, because the
      // two writes that could break it contend on one row. That argument was reused
      // for memberships, where `cell_memberships_one_open` is over `person_id` and
      // the two writes touch no row in common -- so both deferred checks saw a state
      // the other had not committed, and both transactions succeeded, leaving a
      // member open in a closed Cell.
      //
      // Both concurrency cases beside this one exercise index-backed rules, which
      // were the two that were already safe. This one exercises the rule that was
      // not.
      const cell = await createCell(db, { leader });
      const member = await createPerson(db, { firstName: 'Juan', network: 'MENS' });
      const at = await dbNow(db);

      const [closer, adder] = [await openClient(), await openClient()];

      try {
        const pid = Number(
          (await adder.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await closer.query('BEGIN');
        await adder.query('BEGIN');

        await closer.query(
          "UPDATE cells SET state = 'CLOSED', closed_at = $1, closure_reason = 'MEMBERS_DISPERSED' WHERE id = $2",
          [at, cell.id],
        );
        await closer.query(
          'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
          [at, cell.id],
        );

        // The insert itself does not contend -- it is the deferred check's `FOR SHARE`
        // on the `cells` row that does, at COMMIT.
        await adder.query(
          'INSERT INTO cell_memberships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [member.id, cell.id, at],
        );

        const blocked = settled(adder.query('COMMIT'));
        await waitForBlocked(db, pid, "the Cell row's share lock");
        await closer.query('COMMIT');

        expect((await blocked)?.message).toMatch(/open membership/);
      } finally {
        await closer.end();
        await adder.end();
      }

      const open = await db
        .selectFrom('cell_memberships')
        .select('id')
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([]);
    });

    it('refuses the loser of two concurrent handovers of one Cell', async () => {
      // **The case the whole exactly-one argument rests on.** The floor is a
      // counting trigger and is only defensible because the cap is a unique index,
      // and an index is what holds under concurrency. Every other leadership case
      // here is sequential, and a sequential case passes against no index at all.
      //
      // Two transactions each perform a handover from the committed state. The
      // second blocks on the row lock the first holds over the outgoing assignment;
      // when the first commits, the second's close matches nothing -- the row is
      // already ended -- and its insert then collides with the replacement the first
      // opened.
      //
      // **`waitForBlocked` is what makes that true rather than likely, and the first
      // version of this case did not have it.** Without the wait, the loser's UPDATE
      // can reach the server after the winner commits; it then matches the *new*
      // open row rather than blocking on the old one, updates it, and the case fails
      // on an assertion about `rowCount` having nothing to do with the index. That
      // was found by mutating an unrelated trigger and watching this case go red:
      // the real trigger was slowing the winner down just enough to hide the race.
      const cell = await createCell(db, { leader });
      const first = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
      const second = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
      const at = await dbNow(db);

      const [a, b] = [await openClient(), await openClient()];

      try {
        const pid = Number(
          (await b.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        );

        await a.query('BEGIN');
        await b.query('BEGIN');

        await a.query(
          'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
          [at, cell.id],
        );
        await a.query(
          'INSERT INTO cell_leaderships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
          [first.id, cell.id, at],
        );

        const blocked = b.query(
          'UPDATE cell_leaderships SET ended_at = $1 WHERE cell_id = $2 AND ended_at IS NULL',
          [at, cell.id],
        );

        await waitForBlocked(db, pid, "the outgoing assignment's row lock");
        await a.query('COMMIT');

        // The loser's close matched nothing, which is the fact that makes its insert
        // a second open assignment rather than a replacement.
        expect((await blocked).rowCount).toBe(0);

        const refused = settled(
          b.query(
            'INSERT INTO cell_leaderships (person_id, cell_id, started_at) VALUES ($1, $2, $3)',
            [second.id, cell.id, at],
          ),
        );

        expect((await refused)?.message).toMatch(/cell_leaderships_one_open_per_cell/);
        await b.query('ROLLBACK');
      } finally {
        await a.end();
        await b.end();
      }

      const open = await db
        .selectFrom('cell_leaderships')
        .select('person_id')
        .where('cell_id', '=', cell.id)
        .where('ended_at', 'is', null)
        .execute();

      expect(open).toEqual([{ person_id: first.id }]);
    });
  });

  // -------------------------------------------------------------------------
  // History is never deleted (section 5)
  // -------------------------------------------------------------------------

  describe('the effective-dated Cell tables are never deleted', () => {
    it.each(['cell_categories', 'cell_schedules', 'cell_leaderships'] as const)(
      '%s',
      async (table) => {
        const cell = await createCell(db, { leader });

        await expect(db.deleteFrom(table).where('cell_id', '=', cell.id).execute()).rejects.toThrow(
          /never deleted/,
        );
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `Transaction<Database>` extends `Kysely<Database>`, so both callers fit. */
type Db = Kysely<Database>;

/**
 * Waits until the given backend is genuinely blocked, so a concurrency case asserts
 * the wait rather than assuming it.
 *
 * The same shape as `invariants.spec.ts`, and adopted for the same reason rather
 * than by resemblance: without it, whether the second transaction blocks depends on
 * how long the first happens to take, which is a property of the triggers that
 * happen to be installed rather than of the constraint under test.
 *
 * It watches one named PID. Filtering on the query text instead is satisfied by any
 * backend blocked on any lock mentioning the table, which rests on `--runInBand`
 * leaving one candidate rather than on what the case claims to check.
 */
async function waitForBlocked(db: Db, pid: number, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await sql<{ count: string }>`
      SELECT count(*) AS count
        FROM pg_stat_activity
       WHERE pid = ${pid}
         AND state = 'active'
         AND wait_event_type = 'Lock'
    `.execute(db);

    if (Number(waiting.rows[0].count) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`backend ${pid} never blocked on ${what}; the case proves nothing`);
}

/**
 * Resolves to the rejection rather than throwing it, so a pending rejection cannot
 * go unhandled if a later statement in the case throws first -- which takes down the
 * run with a failure naming neither test.
 */
async function settled(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (error: Error) => error,
  );
}

/**
 * A connection of its own, for the cases that need two transactions in flight at
 * once. Kysely's pool would serve them from the same place and a `db.transaction()`
 * pair can simply run in sequence, which is the shape that passes against no
 * constraint at all.
 */
async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Closes a Cell the way section 10 says a closure happens: as one transaction that
 * sets the state and ends the leadership assignment and the active memberships on
 * the same effective date.
 *
 * **The leadership half is not a convenience.** `assert_cell_leadership_matches_state`
 * refuses a CLOSED Cell that still has an open assignment, so a helper that only
 * wrote `cells` would make every case below fail on that trigger rather than on
 * whatever it was about -- which is how the first version of this file was written,
 * and it is the failure a helper is supposed to prevent rather than cause.
 */
async function closeCell(
  db: Db,
  cellId: string,
  options: {
    reason:
      | 'MERGED_INTO_ANOTHER_CELL'
      | 'LEADER_STEPPED_DOWN'
      | 'MEMBERS_DISPERSED'
      | 'CREATED_IN_ERROR'
      | 'OTHER';
    note?: string;
    at?: Date;
  },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const at = options.at ?? (await dbNow(trx));

    await trx
      .updateTable('cells')
      .set({
        state: 'CLOSED',
        closed_at: at,
        closure_reason: options.reason,
        closure_note: options.note ?? null,
      })
      .where('id', '=', cellId)
      .execute();

    await trx
      .updateTable('cell_leaderships')
      .set({ ended_at: at })
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();

    await trx
      .updateTable('cell_memberships')
      .set({ ended_at: at })
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();
  });
}

/**
 * `now()` from the server, for any instant that has to be at or after a Cell's
 * `created_at`.
 *
 * **`new Date()` is not good enough and the difference bit.** JavaScript truncates
 * to the millisecond and `cells.created_at DEFAULT now()` keeps microseconds, so a
 * `new Date()` taken immediately after a Cell is created lands *before* its
 * `created_at` about half the time -- and the case then fails on
 * `cell_leaderships_period_ordered`, or on this file's own "the Cell had no leader
 * as of" branch, intermittently and for a reason having nothing to do with what it
 * was checking. Reading the clock the timestamps came from removes the race rather
 * than narrowing it.
 */
async function dbNow(db: Db): Promise<Date> {
  const result = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);

  return result.rows[0].now;
}

/**
 * Closes the Cell's open schedule row and opens a replacement at `startedAt`, in
 * one transaction.
 *
 * **One transaction because two constraints meet here**, and testing the start
 * rule needs both satisfied: `cell_schedules_one_open` forbids a second open row,
 * and `cells_are_configured` forbids leaving none. So a case about *when* a row
 * may start cannot be written as a bare INSERT, and one written that way would
 * fail on the wrong constraint and pass for the wrong reason.
 */
async function replaceSchedule(
  db: Db,
  cellId: string,
  startedAt: Date,
  dayOfWeek = 7,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('cell_schedules')
      .set({ ended_at: startedAt })
      .where('cell_id', '=', cellId)
      .where('ended_at', 'is', null)
      .execute();

    await trx
      .insertInto('cell_schedules')
      .values({
        cell_id: cellId,
        day_of_week: dayOfWeek,
        time_of_day: '18:00',
        started_at: startedAt,
      })
      .execute();
  });
}

async function addMember(
  db: Db,
  cellId: string,
  personId: string,
  startedAt?: Date,
): Promise<void> {
  await db
    .insertInto('cell_memberships')
    .values({
      person_id: personId,
      cell_id: cellId,
      started_at: startedAt ?? (await dbNow(db)),
    })
    .execute();
}

/**
 * An account with no role and no capability, which is all these cases need:
 * `requested_by` and `decided_by` are foreign keys, and what they may do is
 * decided in the guard and the domain layer rather than here.
 */
async function createBareAccount(db: Db, label: string): Promise<string> {
  const person = await createPerson(db, { firstName: label, network: 'MENS' });
  const email = `${label}.${randomUUID()}@example.invalid`;

  const row = await db
    .insertInto('accounts')
    .values({ person_id: person.id, email, email_normalized: email })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

function newCellRequest(prospectiveLeaderId: string, requestedBy: string) {
  return {
    kind: 'NEW_CELL' as const,
    prospective_leader_id: prospectiveLeaderId,
    requested_by: requestedBy,
    category: 'YOUTH' as const,
    day_of_week: 6,
    time_of_day: '19:00',
  };
}

function handoverRequest(prospectiveLeaderId: string, requestedBy: string, cellId: string) {
  return {
    kind: 'HANDOVER' as const,
    prospective_leader_id: prospectiveLeaderId,
    requested_by: requestedBy,
    cell_id: cellId,
  };
}

/**
 * Manila midnight on the first of next month, as an instant.
 *
 * Next month rather than a fixed date, because `cells.created_at` is `now()` and a
 * schedule row must not start before the Cell exists --
 * `cell_schedules_period_ordered` would refuse the close of the row it replaces.
 *
 * **Through `startOfManilaDay` rather than by adding eight hours.** The first
 * version of this file did the arithmetic inline, which `src/common/time/manila.ts`
 * warns against in its opening paragraph: section 20 names the zone rather than the
 * offset, and a hard-coded `+08:00` is a silent defect on the day that stops being
 * true. A test asserting a zone rule must not carry a second, worse copy of it.
 */
function firstOfNextMonthInManila(): Date {
  const wall = manilaDayOf(new Date());
  const [year, month] = wall.split('-').map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  return startOfManilaDay(
    `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}-01`,
  );
}
