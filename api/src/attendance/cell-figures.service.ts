import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';
import { windowClosesAt } from '../common/time/submission-window';
import { assertReportingMonth } from '../common/time/reporting-period';

import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

/**
 * One person's Cell attendance, reduced to what classification needs.
 *
 * `lifetimeThroughMonth` is a **Cell-ministry** count across every Cell, truncated at the
 * end of the reporting month. Section 12 fixes both halves: classification is "a Cell
 * ministry attendance history rather than resetting a person simply because they attended
 * a different Cell Group", and it is "evaluated as of the end of the reporting month", so
 * a person who was a VIP in October and attended again in November is a VIP on October's
 * report forever.
 */
export interface CellClassificationFigure {
  personId: string;
  lifetimeThroughMonth: number;
}

/** What a Cell-scoped report needs on top of classification: the bucket input. */
export interface CellPersonFigures extends CellClassificationFigure {
  timesInMonth: number;
}

/**
 * Which meetings a figure is computed over, as a union rather than as nullable fields.
 *
 * **The three are genuinely different questions**, and encoding them as "a Cell id or a
 * leader list, at most one set" would put that exclusivity in a comment. Section 20 fixes
 * the key this narrows on: Cell unique people and classification "attribute by the
 * meeting's responsible leader, frozen as of the meeting date" -- so an aggregate scope
 * selects *meetings* by their responsible leader and never selects *people* by their own
 * pastoral placement. That is the DCC key, and using it here would answer a different
 * question with the same shape.
 */
export type CellFiguresPopulation =
  /** One Cell. The only scope at which section 12 permits monthly-attendance buckets. */
  | { kind: 'CELL'; cellId: string }
  /** Every meeting whose frozen responsible leader is one of these people (section 20). */
  | { kind: 'RESPONSIBLE_LEADERS'; personIds: readonly string[] }
  /** Whole Church: every recorded meeting in the month. */
  | { kind: 'EVERY_CELL' };

/**
 * The figures themselves, shaped so that a bucket cannot be computed where section 12
 * forbids one.
 *
 * **Bucket views exist at Cell scope only** (section 12), and that is enforced here by the
 * aggregate result carrying **no `n` and no `timesInMonth`** rather than by a caller
 * remembering the rule. Section 12's reason is not tidiness: `N` belongs to a Cell, so
 * placing two Cells' buckets in one column makes aggregate `Completed` mean "attended
 * everything their own Cell happened to record", which is inflated by exactly the Cells
 * that recorded least. There is nothing to relabel it onto, so the safe shape is one that
 * does not hand a caller the numbers.
 */
export interface CellScopedMonthFigures {
  scope: 'CELL';
  /**
   * N -- the meetings that actually took place and were recorded (section 12):
   * `HELD` + `RESCHEDULED`, for this Cell, in this month.
   *
   * `NOT_HELD` is excluded because nobody can attend a meeting that did not take place,
   * and an **unreported** meeting is excluded because it has no row at all (decision
   * 0162) -- an absence of data rather than a fact about attendance. Scheduled meetings
   * are not the denominator and never appear here; the count a coverage line is read
   * against is a different figure and is not computed yet.
   */
  n: number;
  open: boolean;
  people: CellPersonFigures[];
}

export interface AggregateMonthFigures {
  scope: 'AGGREGATE';
  open: boolean;
  people: CellClassificationFigure[];
}

export type CellMonthFigures = CellScopedMonthFigures | AggregateMonthFigures;

export interface CellMonthFiguresOptions {
  /**
   * Where to read from. Omitted, this reads on the pool -- right for one figure, wrong for
   * a report composing several, which passes its own transaction so that every figure
   * describes one state of the database (decision 0210).
   */
  executor?: Db;
}

/**
 * The Cell figures a report is composed from, computed over `attendance`'s own tables.
 *
 * **Here rather than in `reporting`, for decision 0206's reason** and not as a matter of
 * taste: section 2 permits one cross-module read, a join rooted in a table the reading
 * module owns, and `reporting` owns `report_snapshots` and `notifications` alone. So it
 * may not root a query in `cell_meetings` or `cell_attendance`. The owning module computes
 * its own aggregates and `reporting` composes them, exactly as `DccFiguresService` does
 * for the other domain.
 *
 * **It reads no `cells` table**, which is what keeps this inside the rule rather than at
 * its edge: the Cell a meeting belongs to and the leader it was recorded under are both
 * columns of `cell_meetings`, so no scope this service supports needs a join into a module
 * it does not own.
 */
@Injectable()
export class CellFiguresService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * Every `(Cell, scheduled date)` pair carrying a record in the month — the
   * **numerator** of an aggregate coverage figure (SKILL.md sections 12, 13 and 20).
   *
   * **Keyed on the pair rather than counted per Cell**, because section 20 makes the
   * numerator "those with a record" — *those* being the scheduled meetings the
   * denominator enumerates. So the caller intersects rather than compares two counts,
   * and both terms are attributed by the denominator's own scheduled-date leader. Two
   * independent counts could disagree about which meetings they were counting; an
   * intersection cannot, and it is what makes `recorded` at most `scheduled` by
   * construction rather than by argument.
   *
   * `scheduled_date` is the key because that is a meeting's identity (section 13): a
   * reschedule moves `actual_date` and leaves it alone, so a rescheduled meeting still
   * answers for the day it was scheduled — which is the day the denominator derived.
   *
   * **Every status counts**, on the reading `CellMeetingsService.recordedCountsIn`
   * states: a `NOT_HELD` meeting is a record, because the leader filed it, and section 13
   * makes reporting honestly that a Cell could not meet the whole point of that status.
   * What is not recorded is a scheduled date with no row at all (decision 0162).
   *
   * **Here rather than on `CellMeetingsService`, which owns the write path for this
   * table.** This is a figure, and it needs a database and nothing else; that service
   * needs audit, idempotency, authorization and meeting scope in order to exist, none of
   * which a count of rows has any use for. The first version put it there and made four
   * hand-built test modules pull that whole chain in to compute one integer.
   *
   * Church-wide rather than for a page of Cells: an aggregate report ranges over every
   * Cell its scope reaches, and which those are is decided by the leader on each
   * scheduled date rather than by a list the caller could supply in advance.
   */
  async recordedScheduledDatesIn(
    executor: Db | Transaction<Database>,
    reportingMonth: string,
  ): Promise<Set<string>> {
    const rows = await executor
      .selectFrom('cell_meetings')
      .select(['cell_id', 'scheduled_date'])
      .where('reporting_month', '=', reportingMonth)
      .execute();

    return new Set(rows.map((row) => `${row.cell_id}|${String(row.scheduled_date)}`));
  }

  /**
   * Every figure a Cell monthly report needs, from one statement.
   *
   * **One statement rather than several, for the reason `DccFiguresService` gives.**
   * Section 20 asserts both views cover the same population, and the bucket identity
   * depends on nobody having attended more meetings than `n` counts. Read `n` and the
   * population separately and they are two snapshots -- at section 24's `READ COMMITTED`
   * each statement takes its own even inside a transaction -- and a meeting declared
   * `NOT_HELD` between them yields a person whose `timesInMonth` exceeds `n`, who then
   * falls outside every emitted bucket.
   *
   * **Nobody in the population can exceed `n`.** `cell_attendance_one_live` permits one
   * live row per person per meeting, so a person's count over the month's recorded
   * meetings cannot exceed the number of them -- which is what makes the buckets sum to
   * the population rather than merely tend to.
   *
   * **The population is attendees** (sections 12 and 20). Somebody marked absent is not in
   * it: that is a recorded fact about them rather than an attendance. Nor is somebody
   * whose only record has been superseded -- a correction supersedes rather than
   * overwrites (section 14), and `superseded_at IS NULL` is what stops one corrected
   * record counting twice. Without it both views over-count *together*, which is exactly
   * the failure a reconciliation test cannot catch on its own.
   *
   * **The meeting-status filter on the population is stated rather than load-bearing
   * today**, and that is said plainly rather than left for a reader to discover. A `HELD`
   * meeting later declared `NOT_HELD` has every attendance row closed by that transition,
   * so `superseded_at IS NULL` already excludes them and no live row sits on a `NOT_HELD`
   * meeting. The filter is there because section 12 states the rule about the *meeting*,
   * and because `n` genuinely needs it -- not because it is currently reachable on the
   * population side.
   *
   * **What it does not do: resolve a merged identity.** Section 3 requires a merged pair
   * to count as one person whenever reports are generated, and that resolution belongs to
   * `people` (section 2). Nothing writes `merged_into_id` yet, so no report can be wrong
   * today; it is named because the exclusions above read as a complete list and are not
   * one. The same sentence stands in `DccFiguresService`, and one ruling will move both.
   */
  /**
   * **Overloaded so the caller's scope decides the caller's type**, rather than every
   * caller having to re-check which arm came back. Asking for one Cell yields the arm
   * carrying `n` and `timesInMonth`; asking for anything wider yields the arm that has
   * neither, so section 12's "bucket views exist at Cell scope only" is enforced at each
   * call site by the compiler and not by a narrowing check the caller could skip.
   */
  async monthFigures(
    reportingMonth: string,
    population: Extract<CellFiguresPopulation, { kind: 'CELL' }>,
    options?: CellMonthFiguresOptions,
  ): Promise<CellScopedMonthFigures>;
  async monthFigures(
    reportingMonth: string,
    population: Exclude<CellFiguresPopulation, { kind: 'CELL' }>,
    options?: CellMonthFiguresOptions,
  ): Promise<AggregateMonthFigures>;
  async monthFigures(
    reportingMonth: string,
    population: CellFiguresPopulation,
    options?: CellMonthFiguresOptions,
  ): Promise<CellMonthFigures>;
  async monthFigures(
    reportingMonth: string,
    population: CellFiguresPopulation,
    options: CellMonthFiguresOptions = {},
  ): Promise<CellMonthFigures> {
    assertReportingMonth(reportingMonth);

    // Exactly one of the two narrowings is ever set, which the union above is what
    // guarantees. They are separated here, once, so the SQL takes two parameters that
    // cannot disagree rather than a shape that could.
    //
    // `EVERY_CELL` leaves both null, and that is Whole Church. An empty
    // `RESPONSIBLE_LEADERS` list is a different question with a different answer -- a
    // leader whose subtree holds nobody -- and `= ANY('{}')` is false for every row, so
    // it answers that one correctly without a branch.
    const cellId = population.kind === 'CELL' ? population.cellId : null;
    const leaders = population.kind === 'RESPONSIBLE_LEADERS' ? [...population.personIds] : null;

    const rows = await sql<{
      n: string;
      open: boolean;
      person_id: string | null;
      times_in_month: string | null;
      lifetime_through_month: string | null;
    }>`
      WITH scoped AS (
        SELECT id
          FROM cell_meetings
         WHERE reporting_month = ${reportingMonth}::date
           AND status IN ('HELD', 'RESCHEDULED')
           AND (${cellId}::uuid IS NULL OR cell_id = ${cellId}::uuid)
           AND (
             ${leaders}::uuid[] IS NULL
             OR responsible_leader_id = ANY (${leaders}::uuid[])
           )
      ),
      live AS (
        SELECT a.person_id, a.cell_meeting_id
          FROM cell_attendance a
          JOIN cell_meetings m ON m.id = a.cell_meeting_id
         WHERE a.present = true
           AND a.superseded_at IS NULL
           AND m.status IN ('HELD', 'RESCHEDULED')
           AND m.reporting_month <= ${reportingMonth}::date
      ),
      attended AS (
        SELECT DISTINCT l.person_id
          FROM live l
         WHERE l.cell_meeting_id IN (SELECT id FROM scoped)
      ),
      figures AS (
        SELECT p.person_id,
               count(*) FILTER (
                 WHERE l.cell_meeting_id IN (SELECT id FROM scoped)
               ) AS times_in_month,
               count(*) AS lifetime_through_month
          FROM attended p
          JOIN live l ON l.person_id = p.person_id
         GROUP BY p.person_id
      ),
      month_meta AS (
        SELECT (SELECT count(*) FROM scoped)::text AS n,
               (now() < ${windowClosesAt(reportingMonth)}) AS open
      )
      SELECT month_meta.n,
             month_meta.open,
             figures.person_id,
             figures.times_in_month::text AS times_in_month,
             figures.lifetime_through_month::text AS lifetime_through_month
        FROM month_meta
        LEFT JOIN figures ON true
    `.execute(options.executor ?? this.db);

    // `month_meta` selects two scalar subqueries and no table, so it is exactly one row,
    // and the left join guarantees at least one row back even where nobody attended.
    const first = rows.rows[0];
    const open = first?.open ?? false;

    const people = rows.rows.filter((row) => row.person_id !== null);

    if (population.kind !== 'CELL') {
      return {
        scope: 'AGGREGATE',
        open,
        people: people.map((row) => ({
          personId: row.person_id as string,
          lifetimeThroughMonth: Number(row.lifetime_through_month),
        })),
      };
    }

    return {
      scope: 'CELL',
      n: Number(first?.n ?? '0'),
      open,
      people: people.map((row) => ({
        personId: row.person_id as string,
        timesInMonth: Number(row.times_in_month),
        lifetimeThroughMonth: Number(row.lifetime_through_month),
      })),
    };
  }
}
