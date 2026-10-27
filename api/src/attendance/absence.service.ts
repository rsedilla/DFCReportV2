import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { DATABASE, type Db } from '../database/database.module';

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
   */
  async absentEveryMonth(months: readonly MonthDays[]): Promise<string[]> {
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
      WITH marks AS (
        SELECT a.person_id, coalesce(m.actual_date, m.scheduled_date) AS day, a.present
        FROM cell_attendance a
        JOIN cell_meetings m ON m.id = a.cell_meeting_id
        WHERE a.superseded_at IS NULL
          AND coalesce(m.actual_date, m.scheduled_date) BETWEEN ${first}::date AND ${last}::date
        UNION ALL
        SELECT a.person_id, e.event_date AS day, a.present
        FROM dcc_attendance a
        JOIN dcc_events e ON e.id = a.dcc_event_id
        WHERE a.superseded_at IS NULL
          AND e.removed_at IS NULL
          AND e.event_date BETWEEN ${first}::date AND ${last}::date
      ),
      led AS (
        SELECT DISTINCT m.responsible_leader_id AS person_id
        FROM cell_meetings m
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
   * a DCC Sunday. Absent from a map where there is none.
   */
  async lastSeen(
    personIds: readonly string[],
  ): Promise<{ cell: Map<string, string>; dcc: Map<string, string> }> {
    if (personIds.length === 0) {
      return { cell: new Map(), dcc: new Map() };
    }

    const ids = [...personIds];
    const [cell, dcc] = await Promise.all([
      sql<{ person_id: string; day: string }>`
        SELECT person_id::text AS person_id, max(day)::text AS day
        FROM (
          SELECT a.person_id, coalesce(m.actual_date, m.scheduled_date) AS day
          FROM cell_attendance a
          JOIN cell_meetings m ON m.id = a.cell_meeting_id
          WHERE a.superseded_at IS NULL AND a.present AND a.person_id = ANY(${ids}::uuid[])
          UNION ALL
          SELECT m.responsible_leader_id, coalesce(m.actual_date, m.scheduled_date)
          FROM cell_meetings m
          WHERE m.status IN ('HELD', 'RESCHEDULED')
            AND m.responsible_leader_id = ANY(${ids}::uuid[])
            -- A meeting moved to a day not yet come has not met.
            AND coalesce(m.actual_date, m.scheduled_date) <= (now() AT TIME ZONE 'Asia/Manila')::date
        ) seen
        GROUP BY person_id
      `.execute(this.db),
      sql<{ person_id: string; day: string }>`
        SELECT a.person_id::text AS person_id, max(e.event_date)::text AS day
        FROM dcc_attendance a
        JOIN dcc_events e ON e.id = a.dcc_event_id
        WHERE a.superseded_at IS NULL
          AND a.present
          AND e.removed_at IS NULL
          AND a.person_id = ANY(${ids}::uuid[])
        GROUP BY a.person_id
      `.execute(this.db),
    ]);

    return {
      cell: new Map(cell.rows.map((row) => [row.person_id, row.day])),
      dcc: new Map(dcc.rows.map((row) => [row.person_id, row.day])),
    };
  }
}
