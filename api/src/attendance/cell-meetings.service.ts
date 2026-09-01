import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';

import { NotFoundError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

import { reportingMonthOf } from './submission-window';

import { CellsReadService } from '../cells/cells.read.service';

/**
 * A Cell's meetings for one reporting month (SKILL.md sections 12, 13 and 20).
 *
 * **The scheduled meetings are derived and the recorded ones are stored, and the
 * listing is the join of the two.** Section 13: "A row is written by the first
 * submission. There is none before it" -- so a month's meetings are not a table
 * scan. The scheduled set comes from `cell_schedules` run against the calendar,
 * and each entry carries the `cell_meetings` row that reports it, or null where
 * the leader has not reported yet.
 *
 * That null is the "meeting awaiting a record" of sections 13 and 19, and it is
 * deliberately not a status: section 13 keeps the statuses at exactly three, and
 * "not yet reported" is an absence of data rather than a fact about the meeting.
 *
 * It is also what makes the coverage line of section 12 mean something. The
 * recorded count is a count of rows and the scheduled count is derived from the
 * schedule, so `4 of 5 meetings recorded` compares two figures arrived at two
 * different ways -- which is the property that would be lost if a row were
 * generated ahead for every scheduled date.
 *
 * **This module reads `cells`' tables through `CellsReadService` and never
 * directly** (section 2). `attendance` owns `cell_meetings`, `cell_attendance` and
 * `cell_meeting_changes`; `cells` owns `cell_schedules`, `cell_leaderships` and
 * `cell_memberships`.
 *
 * *No port, and the first draft of decision 0181 said there would be one.* A port
 * is what section 2 reserves for a dependency that **would be a cycle**, as
 * `networks -> cells` is. Nothing imports `AttendanceModule` except `AppModule`,
 * `CellsModule` imports no attendance, and `CellsModule` already exports
 * `CellsReadService` -- so this is section 2's ordinary cross-module route, an
 * import and a service call, and declaring a port here would buy an indirection, a
 * binding module and a fail-closed branch for nothing.
 */
@Injectable()
export class CellMeetingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly cells: CellsReadService,
  ) {}

  /**
   * The meetings of one Cell in one reporting month, scheduled and recorded.
   *
   * **Not paginated, and that is a property of the month rather than a choice.**
   * Section 12: a Cell running for a whole month has 4 or 5 scheduled meetings, and
   * a partial month has fewer. Section 22 asks a *collection* to page because its
   * size is a function of the data; this one's size is a function of the calendar,
   * and the bound is arithmetic rather than a limit anybody sets. A cursor here
   * would be a parameter no client could ever need to use.
   */
  async meetingsIn(cellId: string, month: string): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(month);

    // Existence first, and through the owning module. A Cell the actor cannot see is
    // already refused by the capability guard, which resolves `cell.take_attendance`
    // against this Cell (section 7) -- so reaching here means the Cell is in scope and
    // a null is a Cell that does not exist.
    const cell = await this.cells.cellById(this.db, cellId);
    if (cell === null) {
      throw new NotFoundError('No such Cell.', { cell_id: cellId });
    }

    const scheduled = await this.scheduledDatesIn(cellId, reportingMonth);
    const recorded = await this.recordedIn(cellId, reportingMonth);

    const meetings = scheduled.map((entry) => {
      const row = recorded.get(entry.scheduledDate) ?? null;

      return {
        scheduled_date: entry.scheduledDate,
        scheduled_time: entry.scheduledTime,
        week_starting: entry.weekStarting,
        reporting_month: reportingMonth,
        // Null is "awaiting a record" (sections 13 and 19), never a fourth status.
        meeting: row,
      };
    });

    return {
      cell_id: cell.cellId,
      reporting_month: reportingMonth,
      // Section 12's coverage line, as two figures arrived at two ways. `Coverage =
      // Total Meetings / Scheduled`, reported as `recorded out of scheduled` rather
      // than as a percentage, because section 13 forbids a derived score.
      scheduled_count: meetings.length,
      recorded_count: meetings.filter((entry) => entry.meeting !== null).length,
      meetings,
    };
  }

  /**
   * The dates this Cell was scheduled to meet in a month, with the time in force.
   *
   * **Every boundary here is a Manila calendar date, and the arithmetic is the
   * database's.** Section 20 names the zone for every period boundary; section 10
   * stores `day_of_week` as an ISO day number "because every use of it is arithmetic
   * against a calendar", and this is that use -- `EXTRACT(ISODOW ...)` against the
   * generated series, which is the comparison section 10 names.
   *
   * **A schedule row governs a date when it is in force on that date, compared as
   * dates rather than as instants.** Section 10 makes a change take effect at the
   * start of a month, so within a month the comparison decides nothing at all: the
   * cases it does decide are the partial months section 12 names, where the row opens
   * at approval or ends at a closure part-way through.
   *
   * At the closing edge that is section 13's rule rather than a convenience: a
   * closure ends the schedule row *on* the closure date, and a meeting dated that day
   * "reads the Cell as it stood that day", so an instant comparison would drop a
   * meeting the Cell actually held. Comparing dates gives that meeting its schedule.
   *
   * At the opening edge the same comparison admits a meeting on the approval date
   * itself, which section 10 does not address -- a Cell approved on a Saturday
   * afternoon whose schedule is Saturday gets a scheduled meeting that day. That is
   * recorded as a question rather than defended: it is the reading that loses no
   * meeting a leader believes they held, which is the direction section 13 takes at
   * the other edge, and the opposite reading would refuse a record for a meeting that
   * happened.
   */
  private async scheduledDatesIn(
    cellId: string,
    reportingMonth: string,
  ): Promise<{ scheduledDate: string; scheduledTime: string; weekStarting: string }[]> {
    const result = await sql<{
      scheduled_date: string;
      scheduled_time: string;
      week_starting: string;
    }>`
      SELECT to_char(day, 'YYYY-MM-DD')                        AS scheduled_date,
             to_char(schedule.time_of_day, 'HH24:MI')          AS scheduled_time,
             -- Section 20: a calendar week begins on Monday. date_trunc('week') is
             -- ISO and therefore Monday-based, which is the same authority
             -- day_of_week is stored under.
             to_char(date_trunc('week', day), 'YYYY-MM-DD')    AS week_starting
        FROM generate_series(
               ${reportingMonth}::date,
               (${reportingMonth}::date + interval '1 month' - interval '1 day')::date,
               interval '1 day'
             ) AS day
        JOIN cell_schedules AS schedule
          ON schedule.cell_id = ${cellId}::uuid
         AND (schedule.started_at AT TIME ZONE 'Asia/Manila')::date <= day
         AND (schedule.ended_at IS NULL
              OR (schedule.ended_at AT TIME ZONE 'Asia/Manila')::date >= day)
       WHERE EXTRACT(ISODOW FROM day) = schedule.day_of_week
       ORDER BY day
    `.execute(this.db);

    return result.rows.map((row) => ({
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time,
      weekStarting: row.week_starting,
    }));
  }

  /**
   * The meetings actually recorded for this Cell in a month, by scheduled date.
   *
   * Keyed on `scheduled_date` because that is the meeting's identity (section 13):
   * "A reschedule moves `actual_date` and leaves `scheduled_date` alone, so the
   * identity survives it." Keying on the actual date would lose a rescheduled
   * meeting out of the month it reports in.
   *
   * Selected by `reporting_month`, which is the column section 13 makes authoritative:
   * it is fixed at creation and a reschedule never moves it, so a January meeting held
   * on 2 February still belongs to January.
   *
   * **It is not behaviourally distinguishable from a correct range over
   * `scheduled_date`, and a first version of this paragraph claimed it was.** Migration
   * 0011 derives `reporting_month` from `scheduled_date` and refuses a row where the two
   * disagree, so the divergence a reschedule creates is between `reporting_month` and
   * `actual_date` -- never between it and `scheduled_date`. A mutation swapping this for
   * a `scheduled_date` range passed every case, and that is the schema holding the two
   * in step rather than a gap in the cases.
   *
   * The stored column is still the right one to read: it is what the specification
   * names, and a reader asking which month a row reports in should find the query
   * asking the same question. What it is not is a behaviour a test can pin.
   */
  private async recordedIn(
    cellId: string,
    reportingMonth: string,
  ): Promise<Map<string, Record<string, unknown>>> {
    const rows = await this.db
      .selectFrom('cell_meetings')
      .select([
        'id',
        'status',
        'scheduled_date',
        'scheduled_time',
        'actual_date',
        'actual_time',
        'not_held_reason',
        'not_held_note',
        'facilitated_by',
        'responsible_leader_id',
        'submitted_by',
        'submitted_at',
        'version',
      ])
      .where('cell_id', '=', cellId)
      .where('reporting_month', '=', reportingMonth)
      .execute();

    return new Map(
      rows.map((row) => [
        // `scheduled_date` is a `date` column and node-postgres renders it as a
        // string in this schema's connection settings (`DateStyle=ISO,MDY`, pinned by
        // the pool). Rendered here rather than trusted, so the key matches the
        // `to_char` above whatever the driver does.
        String(row.scheduled_date),
        {
          id: row.id,
          status: row.status,
          scheduled_date: String(row.scheduled_date),
          scheduled_time: String(row.scheduled_time).slice(0, 5),
          actual_date: row.actual_date === null ? null : String(row.actual_date),
          actual_time: row.actual_time === null ? null : String(row.actual_time).slice(0, 5),
          not_held_reason: row.not_held_reason,
          not_held_note: row.not_held_note,
          facilitated_by: row.facilitated_by,
          responsible_leader_id: row.responsible_leader_id,
          submitted_by: row.submitted_by,
          submitted_at: row.submitted_at,
          version: row.version,
        },
      ]),
    );
  }
}
