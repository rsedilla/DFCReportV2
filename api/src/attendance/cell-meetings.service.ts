import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';

import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
} from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

import { isMonthOpen, reportingMonthOf } from '../common/time/submission-window';

import { AuditService } from '../audit/audit.service';
import { type Actor } from '../auth/authorization/authorization.service';
import { CellsReadService } from '../cells/cells.read.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

import type { SubmitCellMeetingDto } from './dto/cell-meeting-submit.dto';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

type SubmitCellMeeting = SubmitCellMeetingDto;

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
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
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
   * Who there is to record for one meeting (SKILL.md sections 12, 13 and 22).
   *
   * `meetingId` is the meeting's **scheduled date**, which section 13 makes its
   * identity: "A reschedule moves `actual_date` and leaves `scheduled_date` alone, so
   * the identity survives it." The date is derivable from the Cell's schedule before
   * any row exists, which is what a client listing meetings awaiting a record needs,
   * and it means a retry names the same meeting.
   *
   * **The roster comes from the date the meeting took place**, which section 12 states
   * and section 13 repeats: `actual_date` where the meeting was rescheduled, and the
   * scheduled date otherwise. Membership can change between the two, and the roster
   * should be the people who could actually have been there. The meeting still reports
   * in its original month; only the roster follows the actual date.
   *
   * The responsible leader is read at that **same** instant, which section 13 requires
   * in terms: "the leader and the people are read at one instant rather than two".
   *
   * **A meeting the schedule does not derive is not a meeting.** Section 13 identifies
   * a meeting by `(cell_id, scheduled_date)` and derives the scheduled set from the
   * Cell's own schedule, so a date the Cell was not scheduled to meet on names nothing
   * — and answering a roster for it would invent a meeting the coverage denominator
   * does not count.
   *
   * **A meeting the Cell had no leader on is refused rather than defaulted**, which
   * section 13 states: "a meeting with no responsible leader is a record nothing rolls
   * up".
   *
   * **Scope is resolved per record by the guard, not here.** Section 7 places a Cell
   * meeting through whoever led the Cell on the meeting's date once the Cell is closed
   * and the month's window is open, and `CELL_SCOPE_PORT.leaderForMeetingScope` does
   * that. *An earlier version of this paragraph described that as an unclosed gap "settled
   * with the closed-Cell slice" — this is that slice, and the paragraph outlived the
   * gap by one commit.*
   *
   * What is **not** settled, and is open in `CLAUDE.md`: on an ACTIVE Cell the guard
   * resolves through the current leader, which section 13 states as the rule for a
   * *write* while giving a read "the leader as of the period being viewed". This route
   * is a read, so a leader who handed on an active Cell is refused the roster of a
   * meeting section 13 appears to place in their scope. Section 7 bundles this read
   * with the write it serves and section 13 splits them; nothing says which wins.
   */
  async rosterFor(cellId: string, meetingId: string): Promise<Record<string, unknown>> {
    const cell = await this.cells.cellById(this.db, cellId);
    if (cell === null) {
      throw new NotFoundError('No such Cell.', { cell_id: cellId });
    }

    const scheduled = await this.scheduledDatesIn(cellId, reportingMonthOf(meetingId));
    const entry = scheduled.find((candidate) => candidate.scheduledDate === meetingId);
    if (entry === undefined) {
      throw new NotFoundError('This Cell was not scheduled to meet on that date.', {
        cell_id: cellId,
        meeting_id: meetingId,
      });
    }

    const recorded =
      (await this.recordedIn(cellId, reportingMonthOf(meetingId))).get(meetingId) ?? null;

    // Section 12: the roster follows the actual date where the meeting moved.
    const rosterDate =
      recorded !== null && typeof recorded.actual_date === 'string'
        ? recorded.actual_date
        : meetingId;

    const responsibleLeaderId =
      recorded === null
        ? await this.cells.leaderOnDateWithin(this.db, cellId, rosterDate)
        : (recorded.responsible_leader_id as string);

    if (responsibleLeaderId === null) {
      throw new InvariantViolationError(
        'This Cell had no leader on that date, so a meeting cannot be recorded for it ' +
          '(SKILL.md section 13).',
        { cell_id: cellId, meeting_id: meetingId },
      );
    }

    const members = await this.cells.membersAsOfWithin(this.db, cellId, rosterDate);

    return {
      cell_id: cell.cellId,
      meeting_id: meetingId,
      scheduled_date: entry.scheduledDate,
      scheduled_time: entry.scheduledTime,
      week_starting: entry.weekStarting,
      reporting_month: reportingMonthOf(meetingId),
      // The date the roster was read at, stated rather than left to be inferred: it is
      // the actual date for a rescheduled meeting and the scheduled one otherwise, and
      // a client showing "who was there" needs to know which.
      roster_date: rosterDate,
      responsible_leader_id: responsibleLeaderId,
      meeting: recorded,
      members: members.map((member) => ({
        person_id: member.personId,
        member_id: member.memberId,
        first_name: member.firstName,
        last_name: member.lastName,
      })),
    };
  }

  /**
   * Record a meeting for the first time (SKILL.md sections 12, 13, 14 and 22).
   *
   * **What one submission is, and therefore what a version means.** Section 14: "A Cell
   * submission carries the meeting's version. One submission is one leader's account of
   * one meeting, so the meeting is the unit." That is the opposite of the DCC half one
   * domain over, which compares per `(dcc_event_id, person_id)` because a DCC event is
   * church-wide and two leaders recording different people must never conflict. The
   * shape of `DccAttendanceService` is therefore **not** the shape to copy here, and
   * this is written from section 14 rather than from it (decision 0100).
   *
   * A first submission carries no version, because there is nothing to have read. Two
   * clients can believe that at once — a leader on a phone and an upline recording on
   * behalf — and the loser meets the unique index over `(cell_id, scheduled_date)`
   * rather than a stale version, which is the same shape section 14 describes for a
   * person's first DCC record.
   *
   * **The responsible leader is frozen here and nothing moves it afterwards** (section
   * 13). It is resolved from `cell_leaderships` at the meeting's own date, so a meeting
   * submitted after a handover belongs to whoever led the Cell when it happened, and a
   * later edit does not re-resolve it — which would move a recorded meeting between
   * leaders' totals inside a period that may have closed.
   *
   * `facilitated_by` defaults to that leader rather than to the submitter, for the same
   * reason: "A meeting submitted after a handover would otherwise default its
   * facilitator to somebody who was not in the room."
   */
  async submit(
    cellId: string,
    meetingId: string,
    body: SubmitCellMeeting,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(meetingId);

    return this.db.transaction().execute(async (trx) => {
      const cell = await this.cells.cellById(trx, cellId);
      if (cell === null) {
        throw new NotFoundError('No such Cell.', { cell_id: cellId });
      }

      // The meeting must be one the Cell's schedule derives. Checked before anything
      // about the body, because a date naming no meeting is not a bad submission — it
      // is a request about something that does not exist.
      const scheduled = await this.scheduledDatesIn(cellId, reportingMonth, trx);
      const entry = scheduled.find((candidate) => candidate.scheduledDate === meetingId);
      if (entry === undefined) {
        throw new NotFoundError('This Cell was not scheduled to meet on that date.', {
          cell_id: cellId,
          meeting_id: meetingId,
        });
      }

      // **The window, on the database's clock** (sections 13 and 20). Only Admin may
      // amend a closed month, under `records.backdate_effective_date`, and that flag is
      // the closed-month amendment of decision 0182 — which arrives with the slice that
      // covers both domains, so a closed month refuses here for everybody today.
      if (!(await isMonthOpen(trx, reportingMonth))) {
        throw new ApiError(
          ApiErrorCode.PERIOD_CLOSED,
          'This month is closed. Only an Admin may amend it, with a reason (SKILL.md ' +
            'sections 13 and 20).',
          { cell_id: cellId, meeting_id: meetingId, reporting_month: reportingMonth },
        );
      }

      const existing = await trx
        .selectFrom('cell_meetings')
        .select(['id', 'version'])
        .where('cell_id', '=', cellId)
        .where('scheduled_date', '=', meetingId)
        .executeTakeFirst();

      // A second submission is a correction, which changes an existing record and is
      // the operation section 13's change history covers. Refused here rather than
      // silently overwriting, which section 14 forbids in terms.
      if (existing !== undefined) {
        throw new InvariantViolationError(
          'This meeting already has a record. Correcting one is a separate operation ' +
            '(SKILL.md sections 13 and 14).',
          { cell_id: cellId, meeting_id: meetingId, current_version: existing.version },
        );
      }

      const responsibleLeaderId = await this.cells.leaderOnDateWithin(trx, cellId, meetingId);
      if (responsibleLeaderId === null) {
        throw new InvariantViolationError(
          'This Cell had no leader on that date, so a meeting cannot be recorded for it ' +
            '(SKILL.md section 13).',
          { cell_id: cellId, meeting_id: meetingId },
        );
      }

      const members = await this.cells.membersAsOfWithin(trx, cellId, meetingId);
      const attendance = assertAttendanceMatchesRoster(body, members, {
        cellId,
        meetingId,
      });

      const meeting = await trx
        .insertInto('cell_meetings')
        .values({
          cell_id: cellId,
          scheduled_date: meetingId,
          scheduled_time: entry.scheduledTime,
          week_starting: entry.weekStarting,
          reporting_month: reportingMonth,
          status: body.status,
          not_held_reason: body.status === 'NOT_HELD' ? body.not_held_reason : null,
          not_held_note: body.status === 'NOT_HELD' ? (body.not_held_note ?? null) : null,
          // Section 13: nullable, and defaults to the meeting's responsible leader.
          facilitated_by: body.facilitated_by ?? responsibleLeaderId,
          responsible_leader_id: responsibleLeaderId,
          submitted_by: actor.accountId,
          submitted_at: sql`clock_timestamp()`,
        } as never)
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();

      if (attendance.length > 0) {
        await trx
          .insertInto('cell_attendance')
          .values(
            attendance.map((line) => ({
              cell_meeting_id: meeting.id,
              person_id: line.person_id,
              present: line.present,
              recorded_by: actor.accountId,
            })),
          )
          .execute();
      }

      // **An ordinary submission writes no audit entry, and one made on behalf does.**
      // Section 21 lists "Attendance submission on behalf" and "Attendance corrections"
      // and lists no ordinary first submission -- the reasoning `dcc_attendance`'s pair
      // records one domain over: a leader's submission for their own meeting *is* the
      // record, and `cell_meetings` and `cell_attendance` are append-only and carry
      // their actor. An entry would restate a row that already says who wrote it.
      //
      // *A first version wrote one unconditionally, under an invented action name.
      // `tsc` refused the name, which is the only reason the rule was re-read.*
      //
      // On behalf is decided by the **Person**, not the account: section 14 separates
      // conducting from reporting and makes the submitter the person who entered the
      // record, and the responsible leader is a Person. It targets the Cell, on the
      // reasoning that settled the leadership trio (section 21, 2026-08-31): section 7
      // resolves an entry's scope through its target, and a Cell meeting resolves
      // through the Cell.
      if (actor.personId !== responsibleLeaderId) {
        await this.audit.writeWithin(trx, {
          actorId: actor.accountId,
          action: 'cell_attendance.submitted_on_behalf',
          targetType: 'cell',
          targetId: cellId,
          after: {
            meeting_id: meetingId,
            status: body.status,
            responsible_leader_id: responsibleLeaderId,
            recorded: attendance.length,
            present: attendance.filter((line) => line.present).length,
          },
        });
      }

      const response = {
        cell_id: cell.cellId,
        meeting_id: meetingId,
        status: body.status,
        reporting_month: reportingMonth,
        responsible_leader_id: responsibleLeaderId,
        facilitated_by: body.facilitated_by ?? responsibleLeaderId,
        version: meeting.version,
        recorded: attendance.length,
        present: attendance.filter((line) => line.present).length,
      };

      // Last statement in the transaction, and inside it (CLAUDE.md, *Write endpoints*).
      // It takes the key's row lock, so a concurrent retry waits on that lock rather
      // than being answered `REQUEST_IN_FLIGHT`; and a lost claim throws here, uncaught,
      // which rolls the write back. What is recorded is what is returned.
      await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

      return response;
    });
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
    executor: Db | Transaction<Database> = this.db,
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
    `.execute(executor);

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

/**
 * The attendance a submission must carry, checked against the roster it names.
 *
 * **A `HELD` meeting carries a line for every member, present or not** (SKILL.md
 * section 13). "If the leader was present and the meeting was available, the meeting is
 * `HELD` with zero attendance. It counts in the denominator, and every member is
 * recorded as not having attended."
 *
 * Absent rows and rows marked absent are different facts, and section 20's
 * reconciliation needs the second: classification buckets and monthly-attendance
 * buckets must each sum to the same unique-people total, and a roster with holes in it
 * cannot do that. Accepting a partial list would make the denominator depend on how
 * much of the roster a client happened to send -- a defect invisible until a month is
 * reported and impossible to correct once it closes.
 *
 * **A `NOT_HELD` meeting carries none** -- "No attendance is recorded", because the
 * meeting did not take place and there is nobody to have been absent from it. The
 * schema refuses it too (`assert_no_attendance_when_not_held`, migration 0011); this
 * refusal exists so the caller is told which rule they broke rather than meeting a
 * trigger message.
 *
 * **A person named twice is refused rather than de-duplicated**, on section 9's
 * reasoning for the same shape one domain over: two lines for one person are two claims
 * about one record, and taking the last silently discards a claim somebody made.
 *
 * **A person not on the roster is refused**, because section 12 records attendance for
 * members only and has no visitor state: "A person coming to a Cell for the first time
 * is added as a member by the leader, and then recorded present."
 */
function assertAttendanceMatchesRoster(
  body: SubmitCellMeeting,
  members: { personId: string }[],
  context: { cellId: string; meetingId: string },
): { person_id: string; present: boolean }[] {
  const lines = body.attendance ?? [];

  if (body.status === 'NOT_HELD') {
    if (lines.length > 0) {
      throw new InvariantViolationError(
        'A meeting that did not take place carries no attendance (SKILL.md section 13).',
        context,
      );
    }

    return [];
  }

  const roster = new Set(members.map((member) => member.personId));
  const named = new Set<string>();

  for (const line of lines) {
    if (named.has(line.person_id)) {
      throw new InvariantViolationError('A person is named once (SKILL.md sections 9 and 12).', {
        ...context,
        person_id: line.person_id,
      });
    }
    named.add(line.person_id);

    if (!roster.has(line.person_id)) {
      throw new InvariantViolationError(
        "Cell attendance is recorded only for the Cell's own members on the meeting date " +
          '(SKILL.md section 12).',
        { ...context, person_id: line.person_id },
      );
    }
  }

  const missing = members.filter((member) => !named.has(member.personId));
  if (missing.length > 0) {
    throw new InvariantViolationError(
      'Every member on the meeting date must be recorded, present or not (SKILL.md ' +
        'sections 13 and 20).',
      { ...context, missing_person_ids: missing.map((member) => member.personId) },
    );
  }

  return lines.map((line) => ({ person_id: line.person_id, present: line.present }));
}
