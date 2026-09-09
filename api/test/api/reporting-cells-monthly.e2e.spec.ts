import request from 'supertest';

import { sql } from 'kysely';

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
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * `GET /api/v1/reports/cells/monthly` — the Cell figures, and the first route whose scope
 * selector is a **Cell** (SKILL.md sections 7, 12, 20 and 22; decision 0220).
 *
 * **Authorization is tested here rather than only against the service**, because the API is
 * the sole authority for it (`CLAUDE.md`, Definition of Done).
 *
 * **Decision 0220 is what most of this file is about.** Section 7 answered twice and not
 * identically what a `CELL` selector resolves through, and the ruling settled it as the
 * Cell's leader in force at the period's final millisecond, falling back to the Cell's last
 * leader where nobody held it then. Three cases pin it and each fails under a different
 * wrong reading:
 *
 * - `closed part-way through the month` fails if the **fallback** is dropped. It is the case
 *   the ruling turns on, and it is **not empty**: the Cell held meetings before it closed.
 * - `a month the outgoing leader held` fails if the resolution is **undated** — the leader
 *   above the outgoing one would lose a month their own subtree ran.
 * - `a month the incoming leader held` fails if the instant is the period's **start** rather
 *   than its end (decision 0218). The handover is mid-July, so the two instants find
 *   different leaders; each was run as a mutation and each fails exactly one of these.
 *
 * *The handover was at the first of July when this file was written, which made the third
 * case pass under every reading -- it asserted a refusal that all three readings agree on.
 * The mutation run is what showed it, and moving the handover into the month is what fixed
 * it. A companion assertion is worth keeping; one described as a discriminator is not.*
 *
 * Fixture names and email addresses are invented (`CLAUDE.md`, Secrets).
 */
describe('GET /api/v1/reports/cells/monthly (sections 7, 12, 20 and 22)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let stranger: TestPerson;
  let member: TestPerson;

  let manuelAccount: TestAccount;
  let markAccount: TestAccount;
  let strangerAccount: TestAccount;
  let adminAccount: TestAccount;

  let cell: string;

  /**
   * Fixed and in the past. A period that has not begun is unreportable (decision 0216), and
   * a clock-relative month would drift across a boundary as the suite ages — which is how
   * the DCC route's own suite came to ask about a future month for four review passes.
   */
  const JUNE = '2020-06-01';
  const JULY = '2020-07-01';
  const JUNE_6 = '2020-06-06';
  const JULY_18 = '2020-07-18';

  /** Mid-July, so the period's first and last instants find different leaders. */
  const HANDOVER = new Date('2020-07-15T00:00:00+08:00');
  const BEFORE = new Date('2020-05-01T00:00:00+08:00');

  const get = (query: string, account: TestAccount) =>
    request(app.getHttpServer())
      .get(`/api/v1/reports/cells/monthly?${query}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** One recorded meeting, with the derived columns computed by the database. */
  const meeting = async (cellId: string, scheduledDate: string, leaderId: string) => {
    const rows = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, responsible_leader_id
      )
      VALUES (
        ${cellId}::uuid, ${scheduledDate}::date, '19:00'::time,
        ${scheduledDate}::date - ((EXTRACT(ISODOW FROM ${scheduledDate}::date)::integer) - 1),
        date_trunc('month', ${scheduledDate}::date)::date,
        'HELD'::cell_meeting_status, ${leaderId}::uuid
      )
      RETURNING id
    `.execute(db);

    return rows.rows[0].id;
  };

  const attend = async (meetingId: string, personId: string, recordedBy: string) => {
    await db
      .insertInto('cell_attendance')
      .values({
        cell_meeting_id: meetingId,
        person_id: personId,
        present: true,
        recorded_by: recordedBy,
      })
      .execute();
  };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alvarez',
      network: 'MENS',
    });
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    // A sibling branch of Manuel's: inside Raymond's subtree, outside Manuel's.
    stranger = await createPerson(db, {
      firstName: 'Onofre',
      lastName: 'Delgado',
      network: 'MENS',
    });
    member = await createPerson(db, { firstName: 'Anacleto', lastName: 'Espino', network: 'MENS' });

    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, stranger.id, raymond.id);
    await assignTo(db, member.id, mark.id);

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
    strangerAccount = await createAccount(app, db, { person: stranger, roles: ['LEADER'] });
    adminAccount = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });

    cell = (await createCell(db, { leader: mark, createdAt: BEFORE })).id;

    await db
      .insertInto('cell_memberships')
      .values({ cell_id: cell, person_id: member.id, started_at: BEFORE })
      .execute();

    const june = await meeting(cell, JUNE_6, mark.id);
    await attend(june, member.id, adminAccount.id);
  });

  describe('the figures', () => {
    it('returns the buckets at Cell scope', async () => {
      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        period: JUNE,
        open: false,
        n: 1,
        unique_people: 1,
        classification: { vip: 1, second_timer: 0, third_timer: 0, fourth_timer: 0, regular: 0 },
        buckets: [{ times: 1, people: 1, completed: true }],
      });
    });

    it('returns no buckets at an aggregate scope (section 12)', async () => {
      const response = await get(`period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.unique_people).toBe(1);
      // Bucket views exist at Cell scope only, so the fields are absent rather than empty.
      expect(response.body).not.toHaveProperty('buckets');
      expect(response.body).not.toHaveProperty('n');
    });
  });

  describe('what a CELL selector resolves through (decision 0220)', () => {
    it('is read by the leader whose subtree contains the Cell leader', async () => {
      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, manuelAccount);

      expect(response.status).toBe(200);
    });

    it('is read by the Cell leader themselves', async () => {
      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, markAccount);

      expect(response.status).toBe(200);
    });

    it('is refused to a leader in another branch', async () => {
      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, strangerAccount);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    it('is still read by its leader for the month it closed part-way through', async () => {
      // **The case the ruling turns on.** Closing on the 20th ends the leadership, so the
      // instant June resolves at -- its final millisecond -- finds nobody. The month is not
      // empty: the meeting on the 6th and its attendance are still there, and section 12
      // says a Cell "closed part-way through a month has fewer" scheduled meetings "and
      // that is not an anomaly". Without the fallback this month is readable by a Whole
      // Church grant alone and refused to the leader who recorded every row of it.
      await closeCellDirectly(db, cell, {
        reason: 'LEADER_STEPPED_DOWN',
        at: new Date('2020-06-20T12:00:00+08:00'),
      });

      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, markAccount);

      expect(response.status).toBe(200);
      expect(response.body.n).toBe(1);
      expect(response.body.unique_people).toBe(1);
    });

    it('gives a month the outgoing leader held to the outgoing leader', async () => {
      // Mark hands the Cell to Onofre on 15 July. June resolves through Mark, who led it
      // throughout -- so Manuel, above Mark, may read June. An undated resolution would
      // resolve June through Onofre and refuse Manuel a month his own subtree ran.
      await handOver(HANDOVER);

      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, manuelAccount);

      expect(response.status).toBe(200);
    });

    it('gives a month the incoming leader held to the incoming leader alone', async () => {
      await handOver(HANDOVER);

      const july = await meeting(cell, JULY_18, stranger.id);
      await attend(july, member.id, adminAccount.id);

      // **The handover is inside July, which is what makes this case decide something.**
      // July's final millisecond finds Onofre and July's first finds Mark, so this is the
      // month the two candidate instants disagree about -- and decision 0218 fixes it as
      // the final millisecond, open period or closed. Reading at the period's start would
      // hand July to Manuel, above Mark, and refuse it to the leader who actually held the
      // Cell for the second half of it.
      const toStranger = await get(`period=${JULY}&scope=CELL&cell_id=${cell}`, strangerAccount);
      const toManuel = await get(`period=${JULY}&scope=CELL&cell_id=${cell}`, manuelAccount);

      expect(toStranger.status).toBe(200);
      expect(toManuel.status).toBe(403);
    });

    it('refuses a Cell that does not exist as it refuses one out of scope', async () => {
      const absent = '00000000-0000-4000-8000-000000000000';

      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${absent}`, manuelAccount);

      // A Cell nothing can place resolves through nobody, so an unknown Cell and an
      // out-of-scope one answer identically. The guard's own comment sets out why that is
      // the idiom rather than a `NOT_FOUND`.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SCOPE_DENIED');
    });

    /**
     * **The other half of the case above, and it answers the opposite way.**
     *
     * `scopeCovers` returns true at Whole Church *before* the target is read, so a Whole
     * Church holder is never refused a selector -- an absent Cell included -- and receives
     * a report of zeroes. Decision 0220 and section 7 both asserted the refusal
     * unqualified for one commit, and the case above is the half where it holds, because
     * it uses a subtree grant.
     *
     * Pinned rather than fixed. It is the open question about a selector naming somebody
     * who does not exist (`CLAUDE.md`) arriving at a second target kind, and answering it
     * by changing this route would settle it by implementation. Nothing is disclosed: the
     * payload is zeroes whether or not the Cell exists.
     */
    it('answers a Whole Church holder zeroes for a Cell that does not exist', async () => {
      const absent = '00000000-0000-4000-8000-000000000000';

      const response = await get(`period=${JUNE}&scope=CELL&cell_id=${absent}`, adminAccount);

      expect(response.status).toBe(200);
      expect(response.body.unique_people).toBe(0);
      expect(response.body.n).toBe(0);
      expect(response.body.buckets).toEqual([]);
    });
  });

  describe('what the route refuses', () => {
    it('refuses a NETWORK scope at the guard, naming the field the client sent', async () => {
      const response = await get(`period=${JUNE}&scope=NETWORK&network=MENS`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      // This route declares no `networkFrom`, which is how it says it does not serve the
      // scope -- so the guard refuses it before resolving anything, and names `scope`
      // rather than a field the client did not send. The DCC route's own suite pins the
      // mirror of this for `CELL`.
      expect(response.body.error.details.field).toBe('query.scope');
    });

    it('refuses a cell_id sent under another scope', async () => {
      const response = await get(`period=${JUNE}&scope=WHOLE_CHURCH&cell_id=${cell}`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('cell_id');
    });

    it('refuses a CELL scope with no cell_id', async () => {
      const response = await get(`period=${JUNE}&scope=CELL`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('query.cell_id');
    });

    it('refuses a period that has not begun (decision 0216)', async () => {
      const response = await get(`period=2999-01-01&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(422);
      expect(response.body.error.details.field).toBe('period');
    });
  });

  /**
   * The month's coverage line (SKILL.md sections 12, 13 and 20; decisions 0187, 0202,
   * 0221 and 0225).
   *
   * **The Cell meets on Saturdays** — `createCell`'s default — so June 2020 schedules
   * four meetings, on the 6th, 13th, 20th and 27th. Every count below is read against
   * those four, and the 20th being a Saturday is what makes the handover cases work:
   * one lands on a scheduled date and one does not.
   */
  describe("the month's coverage is recorded over scheduled (section 12)", () => {
    /** Close one pastoral row and open the next at the same instant, as a move does. */
    const reassign = async (personId: string, leaderId: string, at: Date) => {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .execute();

        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: personId, leader_id: leaderId, started_at: at })
          .execute();
      });
    };

    it('counts the meetings recorded against the meetings scheduled', async () => {
      const response = await get(`period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      // Four Saturdays derived from the schedule; one of them carries a row.
      expect(response.body.coverage).toEqual({ recorded: 1, scheduled: 4 });
      // Section 13: two figures, never a ratio.
      expect(JSON.stringify(response.body)).not.toContain('percent');
    });

    it('carries the same line at CELL scope as the aggregate over that one Cell', async () => {
      const scoped = await get(`period=${JUNE}&scope=CELL&cell_id=${cell}`, adminAccount);
      const church = await get(`period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(scoped.status).toBe(200);
      // The church holds one Cell, so the two must agree. They are computed by the same
      // pair of reads and differ only in the narrowing, which is what this pins.
      expect(scoped.body.coverage).toEqual({ recorded: 1, scheduled: 4 });
      expect(church.body.coverage).toEqual(scoped.body.coverage);
    });

    it('leaves a Cell that scheduled nothing contributing zero to both terms', async () => {
      // A Cell closed before the month has no schedule row in force in it, so it derives
      // no scheduled meetings at all — decision 0225's case, reachable without any
      // backdating.
      const closed = (await createCell(db, { leader: stranger, createdAt: BEFORE })).id;
      await closeCellDirectly(db, closed, {
        reason: 'MEMBERS_DISPERSED',
        at: new Date('2020-05-20T00:00:00+08:00'),
      });

      const response = await get(`period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(response.status).toBe(200);
      // Unchanged by the closed Cell's presence. Decision 0225 keeps it in the
      // denominator and it contributes zero to both terms, so the arithmetic costs
      // nothing — which is that ruling's own argument for why it is the cheap answer as
      // well as the right one. The membership claim is not separately observable in a
      // two-figure aggregate, and that is the point rather than a gap in this case.
      expect(response.body.coverage).toEqual({ recorded: 1, scheduled: 4 });
    });

    it('splits a handover month between the two leaders, per scheduled date', async () => {
      // The Monday between the 13th and the 20th: the 6th and 13th stay with Mark, the
      // 20th and 27th pass to Onofre, who sits in Raymond's subtree and not Manuel's.
      await handOver(new Date('2020-06-15T00:00:00+08:00'));

      const manuelsOwn = await get(
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );
      const church = await get(`period=${JUNE}&scope=WHOLE_CHURCH`, adminAccount);

      expect(manuelsOwn.status).toBe(200);
      // Section 20 attributes each scheduled meeting to the leader who led the Cell on
      // that date, so a per-Cell attribution could not express this at all.
      expect(manuelsOwn.body.coverage).toEqual({ recorded: 1, scheduled: 2 });
      // The church keeps all four: nothing is lost by the split, which is the additivity
      // the two figures have to preserve.
      expect(church.body.coverage).toEqual({ recorded: 1, scheduled: 4 });
    });

    it('leaves a meeting scheduled on the handover day with the outgoing leader', async () => {
      // The 20th is itself a Saturday, so the date comparison matches both leadership
      // rows and the ordering decides. Decision 0187 takes the outgoing leader, because
      // that is the only answer that does not depend on when the handover was recorded.
      await handOver(new Date('2020-06-20T00:00:00+08:00'));

      const manuelsOwn = await get(
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      expect(manuelsOwn.status).toBe(200);
      // The 6th, 13th and 20th, with only the 27th passing to Onofre. Under the opposite
      // ordering the scheduled count reads 2, and the meeting on the handover day would
      // move between two leaders' figures depending on when the handover was filed.
      expect(manuelsOwn.body.coverage).toEqual({ recorded: 1, scheduled: 3 });
    });

    it('walks the subtree at each scheduled date rather than at the end of the period', async () => {
      // Mark moves out of Manuel's subtree mid-month. The Cell is his throughout, so
      // every scheduled date attributes to Mark; what changes is whether Mark stood in
      // Manuel's subtree on that date.
      await reassign(mark.id, raymond.id, new Date('2020-06-15T00:00:00+08:00'));

      const manuelsOwn = await get(
        `period=${JUNE}&scope=LEADER&leader_id=${manuel.id}`,
        manuelAccount,
      );

      expect(manuelsOwn.status).toBe(200);
      // The 6th and the 13th. Section 20 places a coverage party at coverage's own
      // instant, and decision 0221 deliberately left that alone when it settled the
      // neighbouring key — so this is `subtreeAsOf` per date. Under the *period* walk the
      // same figures list Mark under Raymond for the whole month and this reads
      // `0 of 0`, which is the mutation that proves the case discriminates.
      expect(manuelsOwn.body.coverage).toEqual({ recorded: 1, scheduled: 2 });
    });
  });

  /**
   * Mark's leadership ends and Onofre's begins at one instant, which is the only shape
   * migration 0009 admits: the chain is contiguous, so a gap or an overlap is refused.
   */
  const handOver = async (at: Date) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cell)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ cell_id: cell, person_id: stranger.id, started_at: at })
        .execute();
    });
  };
});
