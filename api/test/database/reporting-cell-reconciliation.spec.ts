import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { sql } from 'kysely';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { CellFiguresService } from '../../src/attendance/cell-figures.service';
import { DccCoverageService } from '../../src/attendance/dcc-coverage.service';
import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { PeopleReadService } from '../../src/people/people.read.service';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { ReportingService } from '../../src/reporting/reporting.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestPerson } from '../setup/fixtures';

/**
 * SKILL.md section 20's reconciliation for the **Cell** domain, which with the DCC file
 * beside it is the whole of Stage 5's exit criterion.
 *
 * ```text
 * VIP + 2nd + 3rd + 4th + Regular         = Total Unique People    (every scope)
 * Once + Twice + ... + Completed          = Total Unique People    (Cell scope only)
 * ```
 *
 * **The second identity is checked per Cell and the first at every scope**, which is
 * section 20 stating what section 12 decides: classification carries no denominator so it
 * aggregates, and `N` belongs to a Cell so the buckets do not.
 *
 * **The attribution key is the thing to get wrong here, and it is not the DCC one.**
 * Section 20: Cell unique people and classification "attribute by the meeting's
 * responsible leader, frozen as of the meeting date". So a leader-scoped Cell report
 * selects the *meetings* run by their subtree and then counts whoever attended those
 * meetings -- whatever each attendee's own pastoral placement is. The fixture below is
 * built so that the two keys give different answers rather than agreeing by accident:
 * `carl` attends a Cell inside `manuel`'s subtree while sitting pastorally outside it, and
 * `gina` does the exact reverse. A query written with the DCC key gets both wrong, in
 * opposite directions, and every total still looks plausible.
 *
 * **Each element of the fixture is a way a query can quietly over- or under-count**, and
 * none of them is decoration: a `NOT_HELD` meeting and an unreported one that must stay out
 * of `N`; a person marked absent; a record superseded by a correction; attendance in an
 * earlier month that must reach classification and not the buckets; attendance in a *later*
 * month that must reach neither; and attendance at a **different Cell** that must reach
 * classification, because section 12 makes the journey a Cell-ministry history rather than
 * a per-Cell one.
 *
 * **Where these rows diverge from what the application would write, and why that is
 * tolerated here.** The sentence above is about what each element *measures*; it is not a
 * claim that every row is reachable, and the previous branch's defect was exactly a fixture
 * building a state the application cannot produce. Stated rather than left to be found:
 *
 * - `submitted_by` and `submitted_at` are null, where `CellMeetingsService` sets both on
 *   every insert; `facilitated_by` is null, where the service defaults it to the
 *   responsible leader.
 * - One meeting is written straight to `RESCHEDULED` with `version = 1` and no
 *   `cell_meeting_changes` row. Section 13 reaches that status only through a transition,
 *   and `LEGAL_TRANSITIONS` refuses it as a first submission.
 *
 * **None of the four columns is read by the query under test**, which selects on `status`,
 * `reporting_month`, `cell_id` and `responsible_leader_id` alone -- so no figure here
 * depends on the divergence, and writing these rows through the service would add a
 * submission path to a test about arithmetic. What would *not* be tolerable is a divergence
 * in a column the query reads, and there is none.
 *
 * The rows are otherwise states the application can produce: every attendee holds a
 * membership started before the month (decision 0031), every meeting date is a Saturday
 * matching its Cell's schedule, and `week_starting` and `reporting_month` are computed by
 * the database rather than asserted here.
 *
 * Fixture names are invented (`CLAUDE.md`, Secrets).
 */
describe('section 20 reconciliation, Cell monthly (Stage 5 Done-when)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let reporting: ReportingService;

  /** `cell_attendance.recorded_by` references an account; who recorded a figure changes none of it. */
  let recorder: string;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let outsider: TestPerson;

  let ana: TestPerson;
  let ben: TestPerson;
  let carl: TestPerson;
  let dina: TestPerson;
  let fay: TestPerson;
  let gina: TestPerson;
  let hugo: TestPerson;

  let cellA: string;
  let cellB: string;
  let cellC: string;

  /**
   * Fixed and in the past, for the reason the DCC reconciliation file gives: dates that run
   * forward do not drift across a month boundary as the suite ages, and a period that has
   * not begun is unreportable (decision 0216). October 2020 has five Saturdays, which is
   * what makes an unreported meeting expressible alongside four recorded ones.
   */
  const MONTH = '2020-10-01';
  const OCT_3 = '2020-10-03';
  const OCT_10 = '2020-10-10';
  const OCT_17 = '2020-10-17';
  const OCT_18 = '2020-10-18';
  const OCT_24 = '2020-10-24';
  const SEP_26 = '2020-09-26';
  const NOV_7 = '2020-11-07';

  /** The Cells and every membership predate the reported month. */
  const BEFORE = new Date('2020-09-01T00:00:00+08:00');

  /** The two instants a corrected record spans, written to both ends (migration 0013). */
  const FIRST_RECORDED_AT = new Date('2020-10-03T21:00:00+08:00');
  const CORRECTED_AT = new Date('2020-10-04T21:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();

    // The providers rather than `ReportingModule`, for the reason the DCC reconciliation
    // file gives: importing the module pulls most of the application graph, which this file
    // has no use for. `module-graph.spec.ts` is what asserts the real module resolves.
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [
        CellFiguresService,
        DccFiguresService,
        DccCoverageService,
        AuthorizationService,
        PeopleReadService,
        HierarchyService,
        NetworksService,
        ReportingService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    reporting = app.get(ReportingService);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const accountFor = async (personId: string) => {
    const row = await db
      .insertInto('accounts')
      .values({
        person_id: personId,
        email: 'recorder@example.invalid',
        email_normalized: 'recorder@example.invalid',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  /**
   * One meeting, with `week_starting` and `reporting_month` computed by the database.
   *
   * Both are `CHECK`-derived from `scheduled_date` (migration 0011), so computing them here
   * would be a second derivation that can disagree with the schema's -- and the schema's is
   * the one a report groups by.
   */
  const meeting = async (
    cellId: string,
    scheduledDate: string,
    status: 'HELD' | 'RESCHEDULED' | 'NOT_HELD',
    leaderId: string,
    options: { actualDate?: string } = {},
  ) => {
    const rows = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, actual_date, actual_time, not_held_reason, responsible_leader_id
      )
      VALUES (
        ${cellId}::uuid,
        ${scheduledDate}::date,
        '19:00'::time,
        ${scheduledDate}::date - ((EXTRACT(ISODOW FROM ${scheduledDate}::date)::integer) - 1),
        date_trunc('month', ${scheduledDate}::date)::date,
        ${status}::cell_meeting_status,
        ${options.actualDate ?? null}::date,
        ${options.actualDate === undefined ? null : '19:00'}::time,
        ${status === 'NOT_HELD' ? 'LEADER_UNAVAILABLE' : null}::cell_meeting_not_held_reason,
        ${leaderId}::uuid
      )
      RETURNING id
    `.execute(db);

    return rows.rows[0].id;
  };

  const attend = async (meetingId: string, personId: string, present = true) => {
    await db
      .insertInto('cell_attendance')
      .values({
        cell_meeting_id: meetingId,
        person_id: personId,
        present,
        recorded_by: recorder,
      })
      .execute();
  };

  /**
   * A record corrected from present to absent: a superseded row and the live one that
   * replaced it.
   *
   * It is here because it is exactly how a query that forgets `superseded_at IS NULL`
   * over-counts, and it over-counts in **both** views at once -- so the reconciliation
   * identity still holds and cannot catch it. The successor's `recorded_at` is the
   * predecessor's `superseded_at`, which migration 0013 requires and which two clock reads
   * cannot satisfy.
   */
  const attendThenCorrectedToAbsent = async (meetingId: string, personId: string) => {
    await db.transaction().execute(async (trx) => {
      const successorId = randomUUID();

      const first = await trx
        .insertInto('cell_attendance')
        .values({
          cell_meeting_id: meetingId,
          person_id: personId,
          present: true,
          recorded_by: recorder,
          recorded_at: FIRST_RECORDED_AT,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('cell_attendance')
        .set({ superseded_at: CORRECTED_AT, superseded_by: successorId })
        .where('id', '=', first.id)
        .execute();

      await trx
        .insertInto('cell_attendance')
        .values({
          id: successorId,
          cell_meeting_id: meetingId,
          person_id: personId,
          present: false,
          recorded_by: recorder,
          recorded_at: CORRECTED_AT,
          correction_reason: 'Invented for this case (CLAUDE.md, Secrets).',
        })
        .execute();
    });
  };

  const join = async (cellId: string, personId: string) => {
    await db
      .insertInto('cell_memberships')
      .values({ cell_id: cellId, person_id: personId, started_at: BEFORE })
      .execute();
  };

  beforeEach(async () => {
    await truncateAll(db);

    // One Network throughout: section 10 requires a Cell's members and its leader to share
    // one, so a fixture that crossed Networks would be refused by the schema rather than
    // testing anything about reporting.
    raymond = await createPerson(db, {
      firstName: 'Raymond',
      lastName: 'Alvarez',
      network: 'MENS',
    });
    manuel = await createPerson(db, { firstName: 'Manuel', lastName: 'Bautista', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', lastName: 'Castillo', network: 'MENS' });
    outsider = await createPerson(db, {
      firstName: 'Onofre',
      lastName: 'Delgado',
      network: 'MENS',
    });

    ana = await createPerson(db, { firstName: 'Anacleto', lastName: 'Espino', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Bernardo', lastName: 'Fajardo', network: 'MENS' });
    carl = await createPerson(db, { firstName: 'Carlito', lastName: 'Gutierrez', network: 'MENS' });
    dina = await createPerson(db, { firstName: 'Dionisio', lastName: 'Hilario', network: 'MENS' });
    fay = await createPerson(db, { firstName: 'Faustino', lastName: 'Ibarra', network: 'MENS' });
    gina = await createPerson(db, { firstName: 'Gaudencio', lastName: 'Jimenez', network: 'MENS' });
    hugo = await createPerson(db, { firstName: 'Hilarion', lastName: 'Katigbak', network: 'MENS' });

    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    // A sibling branch: `outsider` is inside Raymond's subtree and outside Manuel's, which
    // is what lets one scope contain a Cell that another does not.
    await assignTo(db, outsider.id, raymond.id);

    await assignTo(db, ana.id, mark.id);
    await assignTo(db, ben.id, mark.id);
    // **The attribution key's witness.** `carl` attends Mark's Cell and is pastorally under
    // `outsider`, so he is inside Manuel's Cell report and outside Manuel's subtree.
    await assignTo(db, carl.id, outsider.id);
    await assignTo(db, dina.id, mark.id);
    await assignTo(db, fay.id, mark.id);
    // The reverse witnesses: pastorally under Mark, attending a Cell Manuel's subtree does
    // not run.
    //
    // **There are two of them, and one would not have been enough.** With a single reverse
    // witness the wrong key removes Carl and adds Gina, so Manuel's total is three under
    // both readings and every assertion below survives the mutation that models the wrong
    // key -- a test that pins nothing while looking as though it does. A second makes the
    // counts differ, and the report carries no identities for an assertion to reach past
    // them.
    await assignTo(db, gina.id, mark.id);
    await assignTo(db, hugo.id, mark.id);

    recorder = await accountFor(raymond.id);

    cellA = (await createCell(db, { leader: mark, createdAt: BEFORE })).id;
    cellB = (await createCell(db, { leader: outsider, createdAt: BEFORE })).id;
    cellC = (await createCell(db, { leader: mark, createdAt: BEFORE })).id;

    for (const person of [ana, ben, carl, dina, fay]) {
      await join(cellA, person.id);
    }
    await join(cellB, gina.id);
    await join(cellB, hugo.id);

    // Cell A's October: two HELD, one RESCHEDULED, one NOT_HELD, and the fifth Saturday
    // never reported at all. N is therefore 3 -- the two excluded meetings are excluded for
    // different reasons, and section 12 states both.
    const octA1 = await meeting(cellA, OCT_3, 'HELD', mark.id);
    const octA2 = await meeting(cellA, OCT_10, 'HELD', mark.id);
    const octA3 = await meeting(cellA, OCT_17, 'RESCHEDULED', mark.id, { actualDate: OCT_18 });
    await meeting(cellA, OCT_24, 'NOT_HELD', mark.id);

    // September and November at Cell A, for the classification truncation: the first counts
    // towards a lifetime figure evaluated at October's end and the second does not.
    const sepA = await meeting(cellA, SEP_26, 'HELD', mark.id);
    const novA = await meeting(cellA, NOV_7, 'HELD', mark.id);

    // Cell B is Onofre's, and its October meeting is what Manuel's scope must not reach.
    const octB = await meeting(cellB, OCT_3, 'HELD', outsider.id);
    const sepB = await meeting(cellB, SEP_26, 'HELD', outsider.id);

    // Cell C records nothing in October but the meeting that did not happen: N = 0.
    await meeting(cellC, OCT_3, 'NOT_HELD', mark.id);

    // Ana: three of three in October, one in September, one in November.
    await attend(octA1, ana.id);
    await attend(octA2, ana.id);
    await attend(octA3, ana.id);
    await attend(sepA, ana.id);
    await attend(novA, ana.id);

    // Ben: once, and never before. A VIP on October's report for ever.
    await attend(octA1, ben.id);

    // Carl: twice in October at Cell A, and once in September at **Cell B**. His lifetime is
    // three, which is only true if classification is a Cell-ministry history.
    await attend(octA1, carl.id);
    await attend(octA2, carl.id);
    await attend(sepB, carl.id);

    // Dina: present at the meeting and marked absent. A recorded fact about her, not an
    // attendance.
    await attend(octA1, dina.id, false);

    // Fay: recorded present and corrected to absent. Live rows say she was not there.
    await attendThenCorrectedToAbsent(octA2, fay.id);

    // Gina: Cell B in September and October, and pastorally under Mark. Two attendances
    // makes her a 2nd Timer, which is the bucket nobody at Cell A occupies -- so the
    // aggregate classification below is a genuine spread rather than Cell A's plus one.
    await attend(sepB, gina.id);
    await attend(octB, gina.id);

    // Hugo: Cell B in October only, and pastorally under Mark. The second reverse witness.
    await attend(octB, hugo.id);
  });

  describe('Cell scope', () => {
    it('sums both views to the same unique-people total', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellA }, MONTH);

      if (!('buckets' in report)) {
        throw new Error('a CELL scope must return the arm carrying n and the buckets');
      }

      const { classification, buckets, unique_people } = report;

      expect(unique_people).toBe(3);
      expect(
        classification.vip +
          classification.second_timer +
          classification.third_timer +
          classification.fourth_timer +
          classification.regular,
      ).toBe(unique_people);
      expect(buckets.reduce((total, one) => total + one.people, 0)).toBe(unique_people);
    });

    it('counts N as the meetings recorded, excluding NOT_HELD and the unreported one', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellA }, MONTH);

      if (!('buckets' in report)) {
        throw new Error('a CELL scope must return the arm carrying n and the buckets');
      }

      // Five Saturdays: two HELD, one RESCHEDULED, one NOT_HELD, one never reported.
      expect(report.n).toBe(3);
      expect(report.buckets.map((one) => one.times)).toEqual([1, 2, 3]);
      expect(report.buckets.map((one) => one.completed)).toEqual([false, false, true]);
    });

    it('places each attendee in the bucket their October attendance earns', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellA }, MONTH);

      if (!('buckets' in report)) {
        throw new Error('a CELL scope must return the arm carrying n and the buckets');
      }

      // Ben once, Carl twice, Ana all three. Dina and Fay are in no bucket because they are
      // in no population.
      expect(report.buckets.map((one) => one.people)).toEqual([1, 1, 1]);
    });

    it('classifies from the whole Cell-ministry history, truncated at the month end', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellA }, MONTH);

      // Ana: three in October and one in September is four -- her November attendance is
      // after the period and must not reach this. Carl: two in October and one at **Cell B**
      // in September is three, which a per-Cell journey would score as two. Ben: one.
      expect(report.classification).toEqual({
        vip: 1,
        second_timer: 0,
        third_timer: 1,
        fourth_timer: 1,
        regular: 0,
      });
    });

    it('emits no buckets where the Cell recorded no meetings', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellC }, MONTH);

      if (!('buckets' in report)) {
        throw new Error('a CELL scope must return the arm carrying n and the buckets');
      }

      // Section 12: with no meetings there is nothing to complete, and a bucket every
      // person satisfies is not a bucket. So no `Completed (0/0)` row.
      expect(report.n).toBe(0);
      expect(report.unique_people).toBe(0);
      expect(report.buckets).toEqual([]);
    });

    it('reports a closed month as closed', async () => {
      const report = await reporting.cellMonthly({ kind: 'CELL', cell_id: cellA }, MONTH);

      expect(report.open).toBe(false);
      expect(report.period).toBe(MONTH);
    });
  });

  describe('aggregate scopes', () => {
    it('sums classification to the unique-people total at Whole Church', async () => {
      const report = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);
      const { classification, unique_people } = report;

      // Ana, Ben and Carl from Cell A, and Gina and Hugo from Cell B.
      expect(unique_people).toBe(5);
      expect(
        classification.vip +
          classification.second_timer +
          classification.third_timer +
          classification.fourth_timer +
          classification.regular,
      ).toBe(unique_people);
    });

    it('carries no buckets, at any scope but a Cell', async () => {
      const church = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);
      const leader = await reporting.cellMonthly({ kind: 'LEADER', person_id: manuel.id }, MONTH);

      // Section 12: bucket views exist at Cell scope only, because `N` belongs to a Cell.
      // The absence is structural rather than an empty array, so nothing can be summed.
      expect(church).not.toHaveProperty('buckets');
      expect(church).not.toHaveProperty('n');
      expect(leader).not.toHaveProperty('buckets');
      expect(leader).not.toHaveProperty('n');
    });

    it("attributes by the meeting's responsible leader and not by the attendee", async () => {
      const report = await reporting.cellMonthly({ kind: 'LEADER', person_id: manuel.id }, MONTH);

      // The meetings Manuel's subtree ran are Cell A's and Cell C's, and not Cell B's.
      //
      // **Carl is in and Gina and Hugo are out, which is the opposite of where the DCC key
      // puts all three** (section 20). Carl sits pastorally under Onofre, outside the
      // subtree, and attends Mark's Cell. Gina and Hugo sit pastorally under Mark, inside
      // it, and attend Onofre's. A query written with the person key answers four here
      // rather than three, and four is as plausible a number as three.
      expect(report.unique_people).toBe(3);
    });

    it('reaches every Cell of a subtree that runs more than one', async () => {
      const report = await reporting.cellMonthly({ kind: 'LEADER', person_id: raymond.id }, MONTH);

      // Raymond is above both branches, so his figure is the Whole Church one.
      expect(report.unique_people).toBe(5);
    });

    it('reports zero for a leader whose subtree runs no Cell', async () => {
      const report = await reporting.cellMonthly({ kind: 'LEADER', person_id: ana.id }, MONTH);

      // Ana leads nobody. An empty population is a real answer and not the same question as
      // Whole Church, which is what the figures service's own comment turns on.
      expect(report.unique_people).toBe(0);
      expect(report.classification).toEqual({
        vip: 0,
        second_timer: 0,
        third_timer: 0,
        fourth_timer: 0,
        regular: 0,
      });
    });

    it('classifies an aggregate population from each person one Cell-ministry history', async () => {
      const report = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

      // Ana 4, Carl 3, Gina 2 (Cell B in September and October), Ben 1, Hugo 1. Nobody is
      // counted twice for attending more than one meeting, which is Principle 10.
      expect(report.classification).toEqual({
        vip: 2,
        second_timer: 1,
        third_timer: 1,
        fourth_timer: 1,
        regular: 0,
      });
    });
  });
});
