import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { ValidationFailedError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';
import { isCalendarDate } from '../common/time/manila';
import { windowClosesAt } from '../common/time/submission-window';

/**
 * One person's DCC attendance, reduced to the two numbers a monthly report needs.
 *
 * `timesInMonth` drives the monthly-attendance bucket; `lifetimeThroughMonth` drives
 * classification, and is a lifetime count truncated at the end of the reporting month
 * rather than a count of the month (SKILL.md sections 9 and 12).
 */
export interface DccPersonFigures {
  personId: string;
  timesInMonth: number;
  lifetimeThroughMonth: number;
}

/**
 * Everything a DCC monthly report is composed from, taken in one read.
 *
 * **One statement rather than several, and that is a correctness requirement rather than
 * a tidiness one.** Section 20 asserts that both views cover the same population; the
 * bucket identity depends on no person having attended more applicable events than the
 * month holds. Read `n` and the population in two statements and they are two snapshots —
 * the pool hands out two connections, and at READ COMMITTED (section 24) each statement
 * takes its own snapshot even inside one transaction. A Sunday removed between them yields
 * a person whose `timesInMonth` exceeds `n`, who then falls outside every emitted bucket,
 * and section 20's identity fails on live data. Section 20 names the calendar on its
 * invalidation list for the same underlying reason — a calendar change moves every bucket
 * without touching an attendance row — though that clause is about a *stored* figure going
 * stale rather than about a torn read inside a live one. *An earlier version said "for
 * exactly this reason", which claimed section 20 addressed a case it does not.*
 */
/**
 * How a caller narrows and where it reads from.
 *
 * **`executor` exists so a report can be one snapshot** (decision 0210). `reporting` opens a
 * `READ ONLY REPEATABLE READ` transaction and passes it here, so the tree walk that chose
 * the population and the figures counted over it cannot describe two states of the database.
 * Omitted, this reads on the pool, which is right for a caller taking one figure and wrong
 * for a report composing several.
 *
 * **`personIds` narrows the population and nothing else.** N, the removed Sundays and the
 * open flag are properties of the month rather than of the people, so a leader-scoped report
 * measures its own people against the same N a whole-church one does — which is what makes
 * a bucket mean the same thing at every scope, and what lets the drill-down sum.
 */
export interface DccMonthFiguresOptions {
  executor?: Db;
  personIds?: readonly string[];
}

export interface DccMonthFigures {
  /** N — the applicable events the month holds (section 9). */
  n: number;
  /**
   * The removed Sundays of the month, as Manila dates.
   *
   * Section 9 requires a removal to be "visible on any report covering that month, so that
   * a month showing four events where the calendar shows five is explained rather than
   * merely odd". `n` alone cannot explain itself.
   */
  removed: string[];
  /** Whether the month is still open for submission (sections 13 and 17). */
  open: boolean;
  people: DccPersonFigures[];
}

/**
 * The DCC figures a report is composed from, computed over `attendance`'s own tables.
 *
 * **Here rather than in `reporting`, and that is decision 0206 rather than a preference.**
 * Section 2 permits one cross-module read — a join rooted in a table the reading module
 * owns — and `reporting` owns `report_snapshots` and `notifications` and nothing else. So
 * it may not root a query in `dcc_attendance` or `dcc_events`, and a whole-church monthly
 * report cannot be a join. The owning module computes its own aggregates and `reporting`
 * composes them.
 *
 * The cost is stated rather than hidden: some logic a reader would call reporting lives
 * here. That is the price of section 2's ownership rule, and the alternative puts SQL over
 * a table in a module that cannot be trusted to know its invariants.
 */
@Injectable()
export class DccFiguresService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * Every figure a DCC monthly report needs, from one snapshot.
   *
   * **N is a count of calendar rows, never a count of Sundays** (section 9): "a month with
   * five Sundays where one carried no service has N = 4". It counts rows the calendar
   * holds whether or not their day has passed, which is section 9's rule rather than an
   * oversight — an applicable event is a row, and the exclusions it draws are removal and
   * a row the calendar has not reached. That is readable only alongside `open`, which is
   * why section 17 requires it and why both are returned together.
   *
   * **The population is attendees** (section 12, section 20). Somebody marked absent is not
   * in it — that is a recorded fact about them rather than an attendance — and neither is
   * somebody whose only record falls on a removed Sunday.
   *
   * **Only live rows count.** A correction supersedes rather than overwrites (section 9),
   * so `superseded_at IS NULL` is what stops one corrected record counting twice. Without
   * it the unique-people total still reconciles — both views over-count together — which is
   * exactly the failure a reconciliation test cannot catch on its own.
   *
   * **`lifetimeThroughMonth` is truncated at the month's end rather than taken as of now**
   * (sections 9 and 12): a person who was a VIP in October and attended again in November
   * is a VIP on October's report forever. Any other reading moves a closed month's figures,
   * which section 20 forbids.
   *
   * **What it does not do: resolve a merged identity.** Section 3 requires a merged pair to
   * count as one person "when reports are generated", for every period including past ones,
   * and that resolution belongs to `people` (section 2). Nothing writes `merged_into_id`
   * yet — Person Merge is unbuilt — so no report can be wrong today; this is named because
   * the exclusions above read as a complete list and are not one.
   */
  async monthFigures(
    reportingMonth: string,
    options: DccMonthFiguresOptions = {},
  ): Promise<DccMonthFigures> {
    assertReportingMonth(reportingMonth);

    // `null` means every attendee, which is what Whole Church asks for. An empty array is a
    // different question with a different answer — a leader whose subtree holds nobody — and
    // `= ANY('{}')` is false for every row, so it answers it correctly without a branch.
    const population = options.personIds === undefined ? null : [...options.personIds];

    // The `YYYY-MM` prefix the calendar is matched on. Derived from the repository's
    // reporting-month format rather than taken as a second parameter, so there is one
    // spelling of a month in the system.
    const month = reportingMonth.slice(0, 7);

    const rows = await sql<{
      n: string;
      removed: string[] | null;
      open: boolean;
      person_id: string | null;
      times_in_month: string | null;
      lifetime_through_month: string | null;
    }>`
      WITH calendar AS (
        SELECT id, event_date, removed_at
          FROM dcc_events
         WHERE to_char(event_date, 'YYYY-MM') = ${month}
      ),
      live AS (
        SELECT a.person_id, e.event_date
          FROM dcc_attendance a
          JOIN dcc_events e ON e.id = a.dcc_event_id
         WHERE a.present = true
           AND a.superseded_at IS NULL
           AND e.removed_at IS NULL
      ),
      attended_this_month AS (
        SELECT DISTINCT person_id
          FROM live
         WHERE to_char(event_date, 'YYYY-MM') = ${month}
           AND (
             ${population}::uuid[] IS NULL
             OR person_id = ANY (${population}::uuid[])
           )
      ),
      figures AS (
        SELECT m.person_id,
               count(*) FILTER (
                 WHERE to_char(l.event_date, 'YYYY-MM') = ${month}
               ) AS times_in_month,
               count(*) FILTER (
                 WHERE to_char(l.event_date, 'YYYY-MM') <= ${month}
               ) AS lifetime_through_month
          FROM attended_this_month m
          JOIN live l ON l.person_id = m.person_id
         GROUP BY m.person_id
      ),
      month_meta AS (
        SELECT count(*) FILTER (WHERE removed_at IS NULL)::text AS n,
               array_remove(
                 array_agg(to_char(event_date, 'YYYY-MM-DD')
                   ORDER BY event_date) FILTER (WHERE removed_at IS NOT NULL),
                 NULL
               ) AS removed,
               (now() < ${windowClosesAt(reportingMonth)}) AS open
          FROM calendar
      )
      SELECT month_meta.n,
             month_meta.removed,
             month_meta.open,
             figures.person_id,
             figures.times_in_month::text AS times_in_month,
             figures.lifetime_through_month::text AS lifetime_through_month
        FROM month_meta
        LEFT JOIN figures ON true
    `.execute(options.executor ?? this.db);

    // `month_meta` aggregates without `GROUP BY`, so it is exactly one row and the left
    // join guarantees at least one row back even where nobody attended. Reading the month's
    // own figures off `[0]` is therefore safe rather than optimistic.
    const first = rows.rows[0];

    return {
      n: Number(first?.n ?? '0'),
      removed: first?.removed ?? [],
      open: first?.open ?? false,
      people: rows.rows
        .filter((row) => row.person_id !== null)
        .map((row) => ({
          personId: row.person_id as string,
          timesInMonth: Number(row.times_in_month),
          lifetimeThroughMonth: Number(row.lifetime_through_month),
        })),
    };
  }
}

/**
 * A reporting month is the first of a month, which is this repository's existing spelling
 * of one (`submission-window.ts`). Anything else is refused rather than answered.
 *
 * **The month comparison in the query is a string comparison and its correctness rests on
 * the shape.** `to_char` zero-pads, so a `YYYY-MM` prefix sorts lexicographically exactly
 * as it sorts chronologically — but only against a well-formed argument. A month written
 * `2027-1` matches nothing and sorts *before* `2027-10`, so a malformed value would yield a
 * plausible, understated report rather than an error. That is the shape decision 0185
 * refuses for a date-only field and decision 0200 for a format validator, and an
 * understated report is worse than a refused one because nobody can see it is wrong.
 *
 * **It composes `isCalendarDate` rather than writing a fifth regex**, which is section 22's
 * one-predicate rule: "One rather than several, because the alternative is what this system
 * actually had: three conventions for a single rule." A hand-written
 * `\d{4}-(0[1-9]|1[0-2])-01` admitted `0026-01-01`, which `isCalendarDate` refuses and
 * documents why — `Date.UTC(26, ...)` applies the legacy two-digit-year mapping, so that
 * month's window would have been computed from 1926. No wrong answer was producible, since
 * every such year is past and `open` is false either way; it is the class of divergence the
 * rule exists to stop.
 *
 * **The refusal names the field**, which section 22 requires because it is what a client
 * needs in order to fix it, and which every other `ValidationFailedError` in this
 * application does.
 *
 * `ValidationFailedError` rather than a plain `Error`: `reportingMonthOf` records why, in
 * this same domain. The exception filter renders an unrecognised `Error` as
 * `INTERNAL_ERROR`, so a refusal thrown as one turns a client's bad month into a 500.
 *
 * **Exported, because this is no longer the first thing to touch the value.** Leader scope
 * derives a period's bounds before any figure is read, and deriving them from an unvalidated
 * month produced a refusal naming `date` and quoting a month the caller never sent — decision
 * 0185's shape, one call earlier. Whoever touches a reporting month first calls this.
 */
export function assertReportingMonth(reportingMonth: string): void {
  if (!isCalendarDate(reportingMonth) || !reportingMonth.endsWith('-01')) {
    throw new ValidationFailedError('A reporting month is the first of a month, as YYYY-MM-01.', {
      field: 'period',
      value: reportingMonth,
    });
  }
}
