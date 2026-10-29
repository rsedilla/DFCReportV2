import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';
import { mergedCte, type MergedPairs } from '../common/merged-identity';

/** A calendar month as its first and last day, `YYYY-MM-DD`. */
export interface MonthDays {
  first: string;
  last: string;
}

/**
 * The attendance half of People's *Absent 3+ Months* list (SKILL.md section 19, decision
 * 0397), rooted in the four tables this module owns.
 *
 * A mark is each record's **current line**: a correction counts and what it replaced does
 * not. A Cell meeting's day is the day it met, its actual date where it was moved. A Sunday
 * removed from the calendar carries no mark.
 */
@Injectable()
export class AbsenceService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * Everyone who, in each of `months`, has at least one Absent mark at a Cell meeting or a
   * DCC Sunday, and who in none of them has a Present mark or leads a Cell that met: a
   * meeting held, or moved to a day in the range, names its leader, and leading a Cell that
   * met counts as being there.
   *
   * **A merged pair is one person** (decision 0408, point 11): each mark, and each meeting's
   * leader, resolves to the record kept, so a Present on either record wins.
   */
  async absentEveryMonth(months: readonly MonthDays[], merges: MergedPairs): Promise<string[]> {
    if (months.length === 0) {
      return [];
    }

    const first = months[0].first;
    const last = months[months.length - 1].last;
    const everyMonth = sql.join(
      months.map(
        (month) =>
          sql`bool_or(NOT marks.present AND marks.day BETWEEN ${month.first}::date AND ${month.last}::date)`,
      ),
      sql` AND `,
    );

    const result = await sql<{ person_id: string }>`
      WITH ${mergedCte(merges)},
      marks AS (
        SELECT coalesce(mg.kept_id, a.person_id) AS person_id,
               coalesce(m.actual_date, m.scheduled_date) AS day, a.present
        FROM cell_attendance a
        JOIN cell_meetings m ON m.id = a.cell_meeting_id
        LEFT JOIN merged mg ON mg.absorbed_id = a.person_id
        WHERE a.superseded_at IS NULL
          AND coalesce(m.actual_date, m.scheduled_date) BETWEEN ${first}::date AND ${last}::date
        UNION ALL
        SELECT coalesce(mg.kept_id, a.person_id), e.event_date AS day, a.present
        FROM dcc_attendance a
        JOIN dcc_events e ON e.id = a.dcc_event_id
        LEFT JOIN merged mg ON mg.absorbed_id = a.person_id
        WHERE a.superseded_at IS NULL
          AND e.removed_at IS NULL
          AND e.event_date BETWEEN ${first}::date AND ${last}::date
      ),
      led AS (
        SELECT DISTINCT coalesce(ml.kept_id, m.responsible_leader_id) AS person_id
        FROM cell_meetings m
        LEFT JOIN merged ml ON ml.absorbed_id = m.responsible_leader_id
        WHERE m.status IN ('HELD', 'RESCHEDULED')
          AND coalesce(m.actual_date, m.scheduled_date) BETWEEN ${first}::date AND ${last}::date
      )
      SELECT marks.person_id::text AS person_id
      FROM marks
      WHERE NOT EXISTS (SELECT 1 FROM led WHERE led.person_id = marks.person_id)
      GROUP BY marks.person_id
      HAVING NOT bool_or(marks.present) AND ${everyMonth}
    `.execute(this.db);

    return result.rows.map((row) => row.person_id);
  }

  /**
   * For each person, the day of their latest Present mark at a Cell meeting, or of the
   * latest meeting that met of a Cell they led, and the day of their latest Present mark on
   * a DCC Sunday. Absent from a map where there is none. **Across every record of each
   * person** (decision 0408): a record merged into one counts as it.
   */
  async lastSeen(
    personIds: readonly string[],
    merges: MergedPairs,
  ): Promise<{ cell: Map<string, string>; dcc: Map<string, string> }> {
    if (personIds.length === 0) {
      return { cell: new Map(), dcc: new Map() };
    }

    const ids = [...personIds];
    const [cell, dcc] = await Promise.all([
      sql<{ person_id: string; day: string }>`
        WITH ${mergedCte(merges)},
        records AS (
          SELECT id AS person_id, id AS record_id FROM unnest(${ids}::uuid[]) AS ids (id)
          UNION ALL
          SELECT kept_id, absorbed_id FROM merged WHERE kept_id = ANY(${ids}::uuid[])
        )
        SELECT person_id::text AS person_id, max(day)::text AS day
        FROM (
          SELECT r.person_id, coalesce(m.actual_date, m.scheduled_date) AS day
          FROM records r
          JOIN cell_attendance a ON a.person_id = r.record_id
          JOIN cell_meetings m ON m.id = a.cell_meeting_id
          WHERE a.superseded_at IS NULL AND a.present
          UNION ALL
          SELECT r.person_id, coalesce(m.actual_date, m.scheduled_date)
          FROM records r
          JOIN cell_meetings m ON m.responsible_leader_id = r.record_id
          WHERE m.status IN ('HELD', 'RESCHEDULED')
            -- A meeting moved to a day not yet come has not met.
            AND coalesce(m.actual_date, m.scheduled_date) <= (now() AT TIME ZONE 'Asia/Manila')::date
        ) seen
        GROUP BY person_id
      `.execute(this.db),
      sql<{ person_id: string; day: string }>`
        WITH ${mergedCte(merges)},
        records AS (
          SELECT id AS person_id, id AS record_id FROM unnest(${ids}::uuid[]) AS ids (id)
          UNION ALL
          SELECT kept_id, absorbed_id FROM merged WHERE kept_id = ANY(${ids}::uuid[])
        )
        SELECT r.person_id::text AS person_id, max(e.event_date)::text AS day
        FROM records r
        JOIN dcc_attendance a ON a.person_id = r.record_id
        JOIN dcc_events e ON e.id = a.dcc_event_id
        WHERE a.superseded_at IS NULL
          AND a.present
          AND e.removed_at IS NULL
        GROUP BY r.person_id
      `.execute(this.db),
    ]);

    return {
      cell: new Map(cell.rows.map((row) => [row.person_id, row.day])),
      dcc: new Map(dcc.rows.map((row) => [row.person_id, row.day])),
    };
  }
}
