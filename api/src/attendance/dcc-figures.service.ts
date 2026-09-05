import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';
import { Inject } from '@nestjs/common';

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
   * N — the applicable DCC events a month holds (section 9).
   *
   * **A count of calendar rows, never a count of Sundays.** Section 9 fixes it that way in
   * terms: "a month with five Sundays where one carried no service has N = 4". A removed
   * Sunday keeps its row and is excluded here, which is what makes a report able to explain
   * the difference rather than merely show a smaller number.
   *
   * The month is matched in Asia/Manila (section 20). `event_date` is a `date` rather than
   * an instant, so the comparison is on the date itself and no zone conversion arises —
   * the column already holds the Manila day the calendar named.
   */
  async applicableEvents(month: string): Promise<number> {
    const row = await sql<{ n: string }>`
      SELECT count(*)::text AS n
        FROM dcc_events
       WHERE to_char(event_date, 'YYYY-MM') = ${month}
         AND removed_at IS NULL
    `.execute(this.db);

    return Number(row.rows[0]?.n ?? '0');
  }

  /**
   * Every person who attended at least once in the month, with the two counts a report
   * buckets them by.
   *
   * **The population is attendees, which is section 12's rule and section 20's identity.**
   * Somebody marked absent is not in it — that is a recorded fact about them and not an
   * attendance — and neither is somebody whose only record falls on a removed Sunday,
   * because that Sunday is not an applicable event.
   *
   * **Only live rows count.** A correction supersedes rather than overwrites (section 9),
   * so `superseded_at IS NULL` is what stops one corrected record counting twice. Without
   * it the unique-people total still reconciles — both views over-count together — which
   * is exactly the failure a reconciliation test cannot catch, and is why the fixture
   * carries a superseded row.
   *
   * **`lifetimeThroughMonth` is truncated at the month's end rather than taken as of now**
   * (sections 9 and 12): a person who was a VIP in October and attended again in November
   * is a VIP on October's report forever. Any other reading moves a closed month's figures,
   * which section 20 forbids.
   */
  async monthlyFigures(month: string): Promise<DccPersonFigures[]> {
    const rows = await sql<{
      person_id: string;
      times_in_month: string;
      lifetime_through_month: string;
    }>`
      WITH live AS (
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
      )
      SELECT m.person_id,
             count(*) FILTER (
               WHERE to_char(l.event_date, 'YYYY-MM') = ${month}
             )::text AS times_in_month,
             count(*) FILTER (
               WHERE to_char(l.event_date, 'YYYY-MM') <= ${month}
             )::text AS lifetime_through_month
        FROM attended_this_month m
        JOIN live l ON l.person_id = m.person_id
       GROUP BY m.person_id
    `.execute(this.db);

    return rows.rows.map((row) => ({
      personId: row.person_id,
      timesInMonth: Number(row.times_in_month),
      lifetimeThroughMonth: Number(row.lifetime_through_month),
    }));
  }
}
