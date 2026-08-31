import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { createCell, createPerson, type TestCell, type TestPerson } from '../setup/fixtures';

import type { Database } from '../../src/database/schema';

/**
 * The five tables migration 0011 creates, exercised against the database.
 *
 * The same reasoning `cells.spec.ts` gives: a rule stated in prose and left to an
 * application that does not exist yet is the failure this repository keeps
 * repeating, so every constraint in 0011 is checked here by writing through it
 * rather than by reading the migration. There is no attendance service yet, and
 * these are the refusals that survive a service-layer check being forgotten — and
 * that a `psql` session is subject to.
 *
 * **One of these caught a live defect on the first run**, which is why the probing
 * came before the service rather than after it: `assert_no_attendance_when_not_held`
 * branched on `TG_TABLE_NAME` inside a `CASE` over `NEW`, and PL/pgSQL resolves
 * every field reference in an expression whatever branch it would take — so the
 * trigger failed with `record "new" has no field "cell_meeting_id"` on every insert
 * into `cell_meetings`. A schema test that only read the catalogue would have
 * reported the trigger present and correct.
 */
describe('the attendance tables (SKILL.md sections 9, 12, 13 and 14)', () => {
  let db: Kysely<Database>;
  let leader: TestPerson;
  let cell: TestCell;

  /** A Saturday, in the week beginning Monday 31 August 2026, reporting in September. */
  const SCHEDULED = '2026-09-05';
  const WEEK_STARTING = '2026-08-31';
  const REPORTING_MONTH = '2026-09-01';

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    leader = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    cell = await createCell(db, { leader });
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** A meeting row with the derived columns correct, so a case overrides only what it tests. */
  function meeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      cell_id: cell.id,
      scheduled_date: SCHEDULED,
      scheduled_time: '19:00',
      week_starting: WEEK_STARTING,
      reporting_month: REPORTING_MONTH,
      status: 'HELD',
      responsible_leader_id: leader.id,
      ...overrides,
    };
  }

  const insertMeeting = (overrides: Record<string, unknown> = {}): Promise<unknown> =>
    db
      .insertInto('cell_meetings')
      .values(meeting(overrides) as never)
      .returning('id')
      .executeTakeFirstOrThrow();

  describe('dcc_events (section 9, DCC calendar)', () => {
    it('takes a Sunday and refuses any other day', async () => {
      // Section 9: "exactly one applicable DCC event per Sunday, church-wide". A
      // calendar that will take a Tuesday is one a generation bug can fill with
      // days nobody meets on, and every month's N moves with it.
      await expect(
        db.insertInto('dcc_events').values({ event_date: '2026-08-30' }).execute(),
      ).resolves.toBeDefined();

      // 31 August 2026 is the Monday after it.
      await expect(
        db.insertInto('dcc_events').values({ event_date: '2026-08-31' }).execute(),
      ).rejects.toThrow(/dcc_events_is_a_sunday/);
    });

    it('refuses the same Sunday twice, which is what makes generation idempotent', async () => {
      // Section 9 leans the generation command's idempotence on this index rather
      // than on the command checking first: two runs racing, or one run repeated,
      // must not double a month's N. Stated as a property of the table so it holds
      // for a `psql` session too.
      await db.insertInto('dcc_events').values({ event_date: '2026-08-30' }).execute();

      await expect(
        db.insertInto('dcc_events').values({ event_date: '2026-08-30' }).execute(),
      ).rejects.toThrow(/dcc_events_event_date_key/);
    });

    it('refuses a removal missing its actor or its reason', async () => {
      // Section 9 keeps a removed Sunday as a row precisely so the month is
      // explained by a record. A removal with no reason is a decision nobody can
      // read back, which defeats the point of keeping the row.
      await expect(
        db
          .insertInto('dcc_events')
          .values({ event_date: '2026-08-30', removed_at: new Date() } as never)
          .execute(),
      ).rejects.toThrow(/dcc_events_removal_is_whole/);
    });

    it('is never deleted, because a removed Sunday explains the month', async () => {
      await db.insertInto('dcc_events').values({ event_date: '2026-08-30' }).execute();

      await expect(
        sql`DELETE FROM dcc_events WHERE event_date = '2026-08-30'`.execute(db),
      ).rejects.toThrow(/never deleted/);
    });
  });

  describe('cell_meetings (section 13)', () => {
    it('derives week_starting from the scheduled date, and refuses one that disagrees', async () => {
      // Section 20 fixes the week as beginning on Monday, and section 13 stores
      // `week_starting` rather than deriving it at read time. Stored and unchecked,
      // a client could place a meeting in a week its own date does not fall in, and
      // every weekly figure downstream would follow the column rather than the day.
      await expect(insertMeeting()).resolves.toBeDefined();

      await expect(
        insertMeeting({ scheduled_date: '2026-09-12', week_starting: '2026-09-01' }),
      ).rejects.toThrow(/cell_meetings_week_starting_derived/);
    });

    it('derives reporting_month from the scheduled date, so a reschedule cannot move it', async () => {
      // Section 13: "a January 31 Cell meeting rescheduled to February 2 remains
      // part of January's Cell meeting report". The column is what makes that true,
      // and deriving it from `scheduled_date` is what stops a reschedule touching it.
      await expect(
        insertMeeting({
          scheduled_date: '2026-09-12',
          week_starting: '2026-09-07',
          reporting_month: '2026-08-01',
        }),
      ).rejects.toThrow(/cell_meetings_reporting_month_derived/);
    });

    it('keeps its reporting month when rescheduled into the next one', async () => {
      // The case section 13 states in those words, written out: scheduled 26
      // September, actually held 3 October, reporting in September.
      const row = await db
        .insertInto('cell_meetings')
        .values(
          meeting({
            scheduled_date: '2026-09-26',
            week_starting: '2026-09-21',
            status: 'RESCHEDULED',
            actual_date: '2026-10-03',
            actual_time: '19:00',
          }) as never,
        )
        .returning(['reporting_month', 'actual_date'])
        .executeTakeFirstOrThrow();

      expect(row.reporting_month).toBe('2026-09-01');
      expect(row.actual_date).toBe('2026-10-03');
    });

    it('refuses a second meeting on one scheduled date, which is the identity', async () => {
      // The ruling of 2026-08-31: `(cell_id, scheduled_date)`, chosen over the week
      // because a week straddling a month boundary can hold two scheduled meetings
      // under two schedules. Two rows for one slot would double the Cell's N.
      await insertMeeting();

      await expect(insertMeeting()).rejects.toThrow(/cell_meetings_one_per_scheduled_date/);
    });

    it('pairs NOT_HELD with a reason, and OTHER with a note', async () => {
      // Section 13: the reason is required, and OTHER "requires a note". The reverse
      // half matters as much — a reason on a meeting that took place is a judgement
      // recorded about a meeting that happened.
      await expect(insertMeeting({ status: 'NOT_HELD' })).rejects.toThrow(
        /cell_meetings_not_held_reason_iff_not_held/,
      );

      await expect(insertMeeting({ status: 'NOT_HELD', not_held_reason: 'OTHER' })).rejects.toThrow(
        /cell_meetings_other_requires_note/,
      );

      await expect(
        insertMeeting({
          status: 'NOT_HELD',
          not_held_reason: 'OTHER',
          not_held_note: 'the venue flooded',
        }),
      ).resolves.toBeDefined();
    });

    it('pairs an actual date with RESCHEDULED and with nothing else', async () => {
      // A HELD meeting took place on its scheduled date and a NOT_HELD one did not
      // take place at all, so an actual date on either is a second answer to a
      // question the status already settles.
      await expect(
        insertMeeting({ actual_date: '2026-09-06', actual_time: '19:00' }),
      ).rejects.toThrow(/cell_meetings_actual_date_iff_rescheduled/);

      await expect(insertMeeting({ status: 'RESCHEDULED' })).rejects.toThrow(
        /cell_meetings_actual_date_iff_rescheduled/,
      );
    });
  });

  describe('cell_attendance (sections 13 and 14)', () => {
    async function heldMeeting(): Promise<string> {
      const row = await db
        .insertInto('cell_meetings')
        .values(meeting() as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      return row.id;
    }

    it('refuses a successor that does not begin where its predecessor ended', async () => {
      // **The mirror of the `dcc_attendance` case, and it is not redundant.**
      // `assert_attendance_chain_contiguous` branches on `TG_TABLE_NAME` to choose which
      // table to look the successor up in, and a mis-branch here fails *silently*: the
      // query would find no row, `successor_recorded_at` would be null, and the function
      // returns without raising. Migration 0011's precedent — the `NOT_HELD` trigger
      // that referenced a field of the wrong record — failed loudly on every insert. This
      // one would not, so the Cell branch needs a case that can go red.
      const meetingId = await heldMeeting();
      const account = await anAccount();
      const successorId = randomUUID();
      const closedAt = new Date('2026-08-31T10:00:00+08:00');

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('cell_attendance')
            .values({
              cell_meeting_id: meetingId,
              person_id: leader.id,
              present: true,
              recorded_by: account,
              recorded_at: new Date('2026-08-31T09:00:00+08:00'),
              superseded_at: closedAt,
              superseded_by: successorId,
            })
            .execute();

          await trx
            .insertInto('cell_attendance')
            .values({
              id: successorId,
              cell_meeting_id: meetingId,
              person_id: leader.id,
              present: false,
              recorded_by: account,
              version: 2,
              // One millisecond early, which is the magnitude the driver-truncation
              // defect produced on the DCC side.
              recorded_at: new Date(closedAt.getTime() - 1),
            })
            .execute();
        }),
      ).rejects.toThrow(/chain_contiguous|successor must begin where it ended/);
    });

    it('refuses two live rows for one person at one meeting', async () => {
      // Section 13 states the consequence rather than the mechanism: "two live rows
      // for one person at one meeting inflate their monthly bucket and break the
      // reconciliation in Section 20". The index is partial, so a superseded row
      // does not count against it — which the next case is about.
      const meetingId = await heldMeeting();
      const account = await anAccount();
      const row = {
        cell_meeting_id: meetingId,
        person_id: leader.id,
        present: true,
        recorded_by: account,
      };

      await db.insertInto('cell_attendance').values(row).execute();

      await expect(
        db
          .insertInto('cell_attendance')
          .values({ ...row, present: false } as never)
          .execute(),
      ).rejects.toThrow(/cell_attendance_one_live/);
    });

    it('forces the order a correction is written in, and the replacement id comes first', async () => {
      // **The partial index decides how a correction has to be written**, and the
      // naive order does not work. Section 13 says the prior row is marked
      // superseded and a new row written; it does not say in which order, and only
      // one order is available.
      //
      // Inserting the replacement first is refused, because for that instant two
      // live rows exist for one person at one meeting — which is exactly what the
      // index is for. Superseding first is refused differently:
      // `cell_attendance_supersession_is_whole` requires `superseded_by`, and the
      // row it must point at does not exist yet.
      //
      // So the service mints the replacement's id before either write, supersedes
      // the predecessor onto it, and then inserts. Written here because a service
      // that discovers this by trial will reach for a deferred constraint, and a
      // partial unique index cannot be one in PostgreSQL.
      const meetingId = await heldMeeting();
      const account = await anAccount();
      const base = { cell_meeting_id: meetingId, person_id: leader.id, recorded_by: account };

      const first = await db
        .insertInto('cell_attendance')
        .values({ ...base, present: true } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      // The order that looks natural, and is refused.
      await expect(
        db
          .insertInto('cell_attendance')
          .values({ ...base, present: false, version: 2 } as never)
          .execute(),
      ).rejects.toThrow(/cell_attendance_one_live/);

      // The order that works: the id first, then the supersession, then the row.
      const replacementId = randomUUID();

      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_attendance')
          // `clock_timestamp()`, not a host `Date`. `recorded_at` fell to the column
          // default — the database's `now()`, the transaction's start — so a host stamp
          // here takes the two ends of one row's live period from two clocks, and
          // `dcc_attendance_period_ordered`'s Cell counterpart refuses the inversion.
          // The constraint caught this fixture the day it was added, which is the whole
          // argument for having it (migration 0012).
          .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: replacementId })
          .where('id', '=', first.id)
          .execute();

        await trx
          .insertInto('cell_attendance')
          .values({
            ...base,
            id: replacementId,
            present: false,
            version: 2,
            // Contiguous with the row it replaces (migration 0013). The service reads
            // this from the predecessor in SQL; a fixture that left the column default
            // would take the transaction's start and place the successor before its
            // predecessor ended, which is the defect that migration exists for.
            recorded_at: sql<Date>`(SELECT superseded_at FROM cell_attendance WHERE id = ${first.id})`,
          })
          .execute();
      });

      const live = await db
        .selectFrom('cell_attendance')
        .select(['id', 'present', 'version'])
        .where('cell_meeting_id', '=', meetingId)
        .where('superseded_at', 'is', null)
        .execute();

      expect(live).toEqual([{ id: replacementId, present: false, version: 2 }]);
    });

    it('is never deleted', async () => {
      const meetingId = await heldMeeting();
      await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: meetingId,
          person_id: leader.id,
          present: true,
          recorded_by: await anAccount(),
        })
        .execute();

      await expect(
        sql`DELETE FROM cell_attendance WHERE cell_meeting_id = ${meetingId}::uuid`.execute(db),
      ).rejects.toThrow(/never deleted/);
    });
  });

  describe('a NOT_HELD meeting carries no attendance (section 13)', () => {
    it('refuses declaring NOT_HELD while attendance stands', async () => {
      // Section 13: "NOT_HELD ... No attendance is recorded." Enforced from the
      // meeting's side as well as the row's, because declaring a meeting NOT_HELD
      // over live attendance and writing attendance against a NOT_HELD meeting are
      // the same corruption reached from two directions.
      const row = await db
        .insertInto('cell_meetings')
        .values(meeting() as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: row.id,
          person_id: leader.id,
          present: true,
          recorded_by: await anAccount(),
        })
        .execute();

      await expect(
        db
          .updateTable('cell_meetings')
          .set({ status: 'NOT_HELD', not_held_reason: 'LEADER_UNAVAILABLE' })
          .where('id', '=', row.id)
          .execute(),
      ).rejects.toThrow(/carries no attendance/);
    });

    it('permits superseding the attendance and declaring NOT_HELD in one transaction', async () => {
      // **The reason the trigger is deferred**, and the case that would fail if it
      // were not. Section 13 requires exactly this path: "A RESCHEDULED meeting that
      // ultimately does not take place may be changed to NOT_HELD, preserving both
      // records." An immediate trigger refuses the intermediate state and there is
      // no order of statements that avoids it.
      const account = await anAccount();
      const row = await db
        .insertInto('cell_meetings')
        .values(meeting() as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      const attendance = await db
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: row.id,
          person_id: leader.id,
          present: true,
          recorded_by: account,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .updateTable('cell_attendance')
            // **Closed with nothing in its place, which the row names itself to say.**
            // Section 13 requires this path — a RESCHEDULED meeting later declared
            // NOT_HELD keeps both records, and a NOT_HELD meeting carries no live
            // attendance — so the attendance is closed and nothing replaces it. But
            // `cell_attendance_supersession_is_whole` requires a `superseded_by`
            // wherever `superseded_at` is set, so a self-reference is the only shape
            // available. Migration 0013 exempts it for that reason, and `CLAUDE.md`
            // records the question it leaves open.
            .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: attendance.id })
            .where('id', '=', attendance.id)
            .execute();

          await trx
            .updateTable('cell_meetings')
            .set({ status: 'NOT_HELD', not_held_reason: 'LEADER_UNAVAILABLE' })
            .where('id', '=', row.id)
            .execute();
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('dcc_attendance (sections 9 and 14)', () => {
    it('refuses two live rows for one person at one event', async () => {
      // Section 9 states it and gives the same reason section 13 does: two live rows
      // inflate that person's monthly bucket and break section 20's reconciliation.
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-08-30' })
        .returning('id')
        .executeTakeFirstOrThrow();

      const account = await anAccount();
      const row = {
        dcc_event_id: event.id,
        person_id: leader.id,
        present: true,
        recorded_by: account,
      };

      await db.insertInto('dcc_attendance').values(row).execute();

      await expect(
        db
          .insertInto('dcc_attendance')
          .values({ ...row, present: false } as never)
          .execute(),
      ).rejects.toThrow(/dcc_attendance_one_live/);
    });

    it('refuses a live period that ends before it begins', async () => {
      // Migration 0012. Migration 0011 created both attendance tables without the
      // `period_ordered` check every other effective-dated table in this schema has,
      // and the correction path was found stamping `superseded_at` from the host clock
      // while `recorded_at` fell to the column default — the database's. One row's
      // period, two clocks, and an inversion whenever the elapsed time was shorter
      // than the difference.
      //
      // The service was fixed in the same change; this is the half that cannot be got
      // wrong again (CLAUDE.md, Definition of Done).
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-08-30' })
        .returning('id')
        .executeTakeFirstOrThrow();

      const account = await anAccount();
      const successor = randomUUID();

      await expect(
        db
          .insertInto('dcc_attendance')
          .values({
            dcc_event_id: event.id,
            person_id: leader.id,
            present: true,
            recorded_by: account,
            recorded_at: new Date('2026-08-31T10:00:00+08:00'),
            superseded_at: new Date('2026-08-31T09:59:59+08:00'),
            superseded_by: successor,
          } as never)
          .execute(),
      ).rejects.toThrow(/dcc_attendance_period_ordered/);
    });

    it('refuses a successor that does not begin where its predecessor ended', async () => {
      // Migration 0013. The invariant shipped broken twice in two commits before this
      // existed — first the successor's `recorded_at` defaulting to the transaction's
      // start, then the closing instant truncated from microseconds to milliseconds on
      // its way back through the driver — and nothing could fail on it either time.
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-08-30' })
        .returning('id')
        .executeTakeFirstOrThrow();

      const account = await anAccount();
      const successorId = randomUUID();
      const closedAt = new Date('2026-08-31T10:00:00+08:00');

      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('dcc_attendance')
            .values({
              dcc_event_id: event.id,
              person_id: leader.id,
              present: true,
              recorded_by: account,
              recorded_at: new Date('2026-08-31T09:00:00+08:00'),
              superseded_at: closedAt,
              superseded_by: successorId,
            })
            .execute();

          await trx
            .insertInto('dcc_attendance')
            .values({
              id: successorId,
              dcc_event_id: event.id,
              person_id: leader.id,
              present: false,
              recorded_by: account,
              version: 2,
              // One millisecond early — the magnitude the truncation defect produced,
              // and the one a comparison between two driver-rendered values could not
              // see.
              recorded_at: new Date(closedAt.getTime() - 1),
            })
            .execute();
        }),
      ).rejects.toThrow(/chain_contiguous|successor must begin where it ended/);
    });

    it('permits a zero-length live period, which is a row entered in error', async () => {
      // `>=` rather than `>`, which is the schema-wide convention. **The case it admits
      // is not reachable through the application**, and this pins the constraint's
      // boundary rather than a path: a correction supersedes at `clock_timestamp()`
      // against a `recorded_at` already written, and one submission may not name a
      // person twice, so nothing produces a zero-length period. Migration 0012 states
      // why the operator is still the looser one.
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-08-30' })
        .returning('id')
        .executeTakeFirstOrThrow();

      const at = new Date('2026-08-31T10:00:00+08:00');
      const account = await anAccount();
      const successor = randomUUID();

      // In the order a correction is written — the predecessor closed, its replacement
      // inserted, both in one transaction, which `superseded_by` is deferred to permit.
      // The instants are set by hand, which the service never does: this is the
      // constraint's boundary, not a reproduction of a path.
      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .insertInto('dcc_attendance')
            .values({
              dcc_event_id: event.id,
              person_id: leader.id,
              present: true,
              recorded_by: account,
              recorded_at: at,
              superseded_at: at,
              superseded_by: successor,
            })
            .execute();

          await trx
            .insertInto('dcc_attendance')
            .values({
              id: successor,
              dcc_event_id: event.id,
              person_id: leader.id,
              present: false,
              recorded_by: account,
              version: 2,
              // The predecessor's zero-length period ends at `at`, so its successor
              // begins there too (migration 0013).
              recorded_at: at,
            })
            .execute();
        }),
      ).resolves.toBeUndefined();
    });

    it('permits a null responsible leader, which is a Network root', async () => {
      // Section 9: "nullable only for a Network root", who has no pastoral leader
      // and whose attendance Admin records. Nothing in the column can tell a root
      // from a person whose leader was not resolved, so the service refuses the
      // second case and the database permits the first.
      const event = await db
        .insertInto('dcc_events')
        .values({ event_date: '2026-08-30' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .insertInto('dcc_attendance')
          .values({
            dcc_event_id: event.id,
            person_id: leader.id,
            present: true,
            responsible_leader_id: null,
            recorded_by: await anAccount(),
          } as never)
          .execute(),
      ).resolves.toBeDefined();
    });
  });

  describe('dcc_calendar_start (sections 7 and 9)', () => {
    it('is seeded null, so the first generation run is what sets it', async () => {
      // The ruling of 2026-08-31. Seeded rather than absent, because
      // `settings_key_is_known` is a closed list and a key with no row would need an
      // INSERT path where the other two keys have only an UPDATE.
      const row = await db
        .selectFrom('settings')
        .select(['value', 'updated_by'])
        .where('key', '=', 'dcc_calendar_start')
        .executeTakeFirstOrThrow();

      expect(row.value).toBeNull();
      expect(row.updated_by).toBeNull();
    });

    it('is a key the closed list admits, where an invented one is not', async () => {
      await expect(
        sql`INSERT INTO settings (key, value) VALUES ('dcc_calendar_end', 'null'::jsonb)`.execute(
          db,
        ),
      ).rejects.toThrow(/settings_key_is_known/);
    });
  });

  /**
   * An account to attribute a write to. `recorded_by` is `NOT NULL` and references
   * `accounts`, so every attendance case needs one; none of them cares which.
   */
  async function anAccount(): Promise<string> {
    const existing = await db.selectFrom('accounts').select('id').executeTakeFirst();
    if (existing) return existing.id;

    const created = await db
      .insertInto('accounts')
      .values({
        person_id: leader.id,
        email: 'recorder@example.test',
        email_normalized: 'recorder@example.test',
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();

    return created.id;
  }
});
