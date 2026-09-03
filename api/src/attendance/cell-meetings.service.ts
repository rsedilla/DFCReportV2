import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

import {
  ApiError,
  ApiErrorCode,
  InvariantViolationError,
  NotFoundError,
  ResourceBusyError,
  ScopeDeniedError,
} from '../common/errors/api-error';
import { VersionConflictError } from '../common/errors/version-conflict';
import { isUniqueViolation, violatedConstraint } from '../common/errors/postgres-errors';
import { DATABASE, type Db } from '../database/database.module';

import { isMonthOpen, reportingMonthOf } from '../common/time/submission-window';

import { AuditService } from '../audit/audit.service';
import {
  AuthorizationService,
  type Actor,
  type ActorAuthority,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { CellsReadService } from '../cells/cells.read.service';
import { CellMeetingsScopeService } from './cell-meetings.scope.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';

import type { SubmitCellMeetingDto } from './dto/cell-meeting-submit.dto';
import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';
import type { Transaction } from 'kysely';

type SubmitCellMeeting = SubmitCellMeetingDto;

/**
 * Thrown inside the correction's transaction to roll it back, and never seen by a client.
 *
 * **A marker rather than the answer**, because the answer needs the *committed* state and
 * this transaction's own uncommitted writes are visible to it (SKILL.md section 22:
 * "The loser re-reads the committed state"). So the throw rolls back, and `submit`'s
 * caller re-reads on the pool and decides between `VERSION_CONFLICT` and `RESOURCE_BUSY`.
 *
 * Not an `ApiError`: nothing should render it. If one ever escapes, the exception filter
 * answers `INTERNAL_ERROR`, which is the honest outcome for a marker that lost its
 * handler.
 */
class LostCorrectionRace extends Error {
  constructor() {
    super('A concurrent correction won the race; re-read the committed state.');
    this.name = 'LostCorrectionRace';
  }
}

/**
 * A meeting's identity: `(cell_id, scheduled_date)` (SKILL.md section 13, migration 0011).
 *
 * Named because a lost *first* submission is told apart from every other uniqueness
 * failure by which index refused it. Section 22 lists exactly two cases carrying a null
 * `submitted_version` and this is one of them; a violation of any other index on this
 * table is not a lost race and must keep failing loudly, since letting one surface on its
 * own answers `INTERNAL_ERROR` on an ordinary race.
 */
const ONE_PER_SCHEDULED_DATE = 'cell_meetings_one_per_scheduled_date';

/**
 * What both of this route's operations answer with.
 *
 * Declared as a shape rather than `Record<string, unknown>` because it is handed to
 * `completeWithin`, whose `body` is `Json | null` — and an *unknown* value is not JSON
 * whatever it happens to hold. Naming the shape is also what makes a replay's promise
 * checkable: section 22 replays what was stored, so what is recorded must be what is
 * returned (CLAUDE.md, *Write endpoints*).
 *
 * **A type alias rather than an interface, and that is not style.** TypeScript gives an
 * implicit index signature to the first and not to the second, so an interface here is
 * not assignable to `Json` and the completion would not compile.
 */
type CellMeetingSubmissionResponse = {
  cell_id: string;
  meeting_id: string;
  status: string;
  reporting_month: string;
  responsible_leader_id: string;
  facilitated_by: string;
  version: number;
  recorded: number;
  present: number;
  /** Absent on a first submission, which corrects nothing. */
  corrected?: number;
};

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
    private readonly authorization: AuthorizationService,
    private readonly meetingScope: CellMeetingsScopeService,
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
   * **On an ACTIVE Cell that resolves through the current leader, and that is the rule
   * rather than an artifact of one method serving two routes** (decision 0186). The
   * capability decides which of section 7's two resolutions applies, not the HTTP
   * method: section 7 names three capabilities that resolve as of the period being
   * viewed and this is not one of them, so the route resolves as the submission it
   * prepares. A leader who handed on an active Cell
   * is therefore refused this roster, and loses no record by it — the current leader
   * files the meeting and section 13 freezes its responsible leader to whoever led the
   * Cell on the day. What they are refused is a view of a past period, which belongs to
   * a viewing capability and has no route yet.
   *
   * *That paragraph recorded this as an open contradiction between sections 7 and 13
   * for four days. It was one, and section 13's sentence is what has changed: it split
   * by method, and now splits by capability.*
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
    try {
      return await this.submitWithin(cellId, meetingId, body, actor, claim);
    } catch (error) {
      // **The lost correction race, answered after the rollback** (section 22, *Write
      // conflicts*). The transaction is gone, so what is read here is the committed
      // state — which is the property section 22's rule turns on, and which a re-read
      // inside the doomed transaction did not have.
      //
      // **The lost *first* submission arrives here as a unique violation instead**, and
      // is the same race one step earlier. Section 22 names it as one of exactly two
      // cases carrying a null `submitted_version`: "Two first submissions of one meeting
      // race, and the loser meets the uniqueness of `(cell_id, scheduled_date)`." Both
      // writers hold no version, because there was nothing to have read.
      //
      // **Narrowed on the index by name**, exactly as `DccAttendanceService` narrows on
      // `dcc_attendance_one_live`. Section 22: a uniqueness violation "left to surface on
      // its own" is an `INTERNAL_ERROR` on an ordinary race, and that is what naming
      // these cases exists to prevent — so a violation of any *other* index is not a lost
      // race and keeps failing loudly.
      const lostFirstSubmission =
        isUniqueViolation(error) && violatedConstraint(error) === ONE_PER_SCHEDULED_DATE;

      if (!lostFirstSubmission && !(error instanceof LostCorrectionRace)) {
        throw error;
      }

      // One answer for both, because section 22 states the two outcomes over every lost
      // race rather than over the correction path: the loser re-reads the committed state
      // and answers on what it finds. A first submission whose roster the winner already
      // recorded is `RESOURCE_BUSY`; one that differs is a `VERSION_CONFLICT` carrying
      // `submitted_version: null` and the stored row as `current`, which is what
      // `lostRaceAnswer` builds from `body.version ?? null`.
      throw await this.lostRaceAnswer(cellId, meetingId, body, actor);
    }
  }

  private async submitWithin(
    cellId: string,
    meetingId: string,
    body: SubmitCellMeeting,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const reportingMonth = reportingMonthOf(meetingId);

    // **On the pool, before the transaction opens** (section 24), which is what every
    // other write service here does: `authorityFor` reads `account_roles` and
    // `capability_grants`, and a transaction holding a connection while asking the pool
    // for another is the liveness hazard section 24 names. The `coversWith` call it
    // feeds takes the transaction, which is why the two are separate methods.
    //
    // Read on every submission rather than only on a correction, because deferring it
    // would move the pool read inside the transaction on exactly the path that needs it.
    const authority = await this.authorization.authorityFor(actor.accountId);

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
        .select([
          'id',
          'version',
          'status',
          'responsible_leader_id',
          'facilitated_by',
          'submitted_by',
          'submitted_at',
        ])
        .where('cell_id', '=', cellId)
        .where('scheduled_date', '=', meetingId)
        .executeTakeFirst();

      // **A second submission is a correction, and it is the same route** (sections 13,
      // 14 and 22). Section 22's route list carries one meeting write; section 13 argues
      // about the Admin amendment that "a second route would have to stay behaviourally
      // identical to this one forever", and the argument covers this as squarely. The
      // two are told apart by `version`, and section 7's capability split is honoured in
      // `correctWithin` rather than on the decorator, because a route declares one
      // capability. `DccAttendanceService` takes the same shape for the same reason.
      if (existing !== undefined) {
        const response = await this.correctWithin(trx, {
          cellId,
          cellHandle: cell.cellId,
          meetingId,
          reportingMonth,
          existing,
          body,
          actor,
          authority,
        });

        // The same last statement the first-submission path ends with, and the same
        // reasons (CLAUDE.md, *Write endpoints*). 201 on both outcomes, matching
        // `POST /dcc/events/{id}/submit`, which likewise creates or corrects and
        // declares no `@HttpCode`: Nest fixes a route's status statically, so an
        // outcome-dependent one would need the response object, and section 22 fixes no
        // status per outcome.
        await this.idempotency.completeWithin(trx, { ...claim, status: 201, body: response });

        return response;
      }

      // A version sent for a meeting with no record. Section 22 is explicit that a
      // refusal with no second value to show is not a `VERSION_CONFLICT`, whatever went
      // stale — there is nothing to put in `current`. Unlike the DCC counterpart this
      // *is* reachable from a state a client could have read, because nothing yet
      // deletes a `cell_meetings` row but nothing has ever written one for this meeting:
      // the client read a roster whose `meeting` was null and sent a version anyway.
      if (body.version !== undefined) {
        throw new InvariantViolationError(
          'You sent a version for a meeting that has no record yet. Re-read the roster.',
          { cell_id: cellId, meeting_id: meetingId, submitted_version: body.version },
        );
      }

      // **A first submission cannot say `RESCHEDULED`** (section 13, decision 0188). A
      // reschedule changes a record that exists — it is what `cell_meeting_changes`
      // records, and a change row needs a `from_status` and a `from_date`. Section 7
      // also depends on it: `actual_date` is chosen by an actor, and the frozen
      // responsible leader is actor-independent only because the instant it is frozen
      // from is the scheduled date. Refused here rather than in the DTO, which cannot
      // know whether a record exists.
      if (body.status === 'RESCHEDULED') {
        throw new InvariantViolationError(
          'A meeting is recorded before it is rescheduled: report what happened, then move ' +
            'it (SKILL.md section 13).',
          { cell_id: cellId, meeting_id: meetingId },
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

      await this.assertMayActForAnother(trx, {
        cellId,
        meetingId,
        actor,
        authority,
      });

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
   * Correct a meeting that already has a record (SKILL.md sections 13, 14 and 22).
   *
   * **The version unit is the meeting, which is the whole of what makes this unlike
   * DCC** (section 14). "One submission is one leader's account of one meeting, so the
   * meeting is the unit": the client sends `cell_meetings.version`, one comparison
   * decides the whole roster, and nine against eight is a disagreement about the account
   * rather than about any one person. `DccAttendanceService` compares per
   * `(event, person)` because a DCC event is church-wide and two leaders recording
   * different people must never conflict — a Cell meeting belongs to one leader, so it
   * has a unit and does not need that. This is written from section 14 rather than from
   * that service (decision 0100).
   *
   * **One operation, not two** (decision 0190). Section 14 also named a per-person
   * correction carrying `cell_attendance.version`, which this route does not offer and
   * which is withdrawn: the meeting is the unit *because* a Cell meeting belongs to one
   * leader, and a per-person operation would need a second unit and a second conflict
   * body for a domain that has one of each. `cell_attendance.version` is written one
   * higher per superseded row and is never compared.
   *
   * **What a correction preserves is section 14's list**, and two entries on it are why
   * this method writes less than it might. `responsible_leader_id` is frozen and never
   * re-resolved (section 13). `submitted_by` and `submitted_at` are **not** overwritten:
   * section 14 names "actual submitter/actor" among what a correction preserves, so the
   * meeting keeps the person who first reported it, and who corrected it lives in the
   * audit entry and in each successor row's `recorded_by`.
   *
   * **Only the lines that changed are superseded.** A leader resubmitting a roster with
   * one name flipped writes one pair of rows, not twenty — and an unchanged line is not
   * an amendment, which is what keeps `cell.correct_subtree` off a resubmission that
   * changes nothing. Section 9 states that rule for DCC and the reasoning is the domain's
   * rather than that domain's.
   */
  private async correctWithin(
    trx: Transaction<Database>,
    params: {
      cellId: string;
      cellHandle: string;
      meetingId: string;
      reportingMonth: string;
      existing: {
        id: string;
        version: number;
        status: string;
        responsible_leader_id: string;
        facilitated_by: string | null;
        submitted_by: string | null;
        submitted_at: Date | null;
      };
      body: SubmitCellMeeting;
      actor: Actor;
      authority: ActorAuthority;
    },
  ): Promise<CellMeetingSubmissionResponse> {
    const { cellId, meetingId, existing, body, actor } = params;

    // **A status change is not this operation**, and it is refused before anything is
    // read about the roster — a change that writes no `cell_meeting_changes` row is a
    // meeting moving between statuses with nothing to explain it (section 13). Checked
    // first because a `NOT_HELD` body carries no attendance, so it would otherwise reach
    // the "nothing changed" path below and be answered as a no-op.
    if (body.status !== existing.status) {
      throw new InvariantViolationError(
        'Changing a meeting\u2019s status is a separate operation from correcting its ' +
          'attendance (SKILL.md section 13).',
        {
          cell_id: cellId,
          meeting_id: meetingId,
          current_status: existing.status,
          submitted_status: body.status,
        },
      );
    }

    // **Whether this meeting is the actor's to record at all, decided before anything
    // about the roster is read** (section 14, decision 0192). It depends on nothing
    // stored beyond who the meeting resolves through, so it can run first — and it must,
    // because everything below branches on what is stored.
    //
    // *A first version put it after the roster comparison, beside the amendment
    // capability. That made the **success** answer what the refusal was placed not to:
    // an actor without `cell.submit_on_behalf` got 201 for a roster that matched and 403
    // for one that did not, so two probes read the stored roster back on a meeting they
    // may not record.*
    //
    // *`DccAttendanceService` was cited here as running its equivalent "for every line
    // whatever the outcome", and that was not true when written: a `CREATE` line
    // carrying a `correction_reason` threw before `assertMayRecord` was reached, so the
    // on-behalf check never ran for it. Section 7's contents-ordering rule was settled to
    // bind DCC (decision 0193) and that refusal now runs behind the check, so the two
    // domains state one rule. Neither is argued from the other: the Cell ordering rests
    // on the roster read carrying this route's own declaration, which
    // `capability-scope-resolution.spec.ts` asserts.*
    await this.assertMayActForAnother(trx, params);

    // **The roster is read at the meeting's own instant, exactly as the first
    // submission reads it** (sections 12 and 13). A correction is an account of the same
    // meeting, so it answers about the same people; reading `now` would let a membership
    // change since the meeting silently add or drop a line.
    const members = await this.cells.membersAsOfWithin(trx, cellId, meetingId);
    const attendance = assertAttendanceMatchesRoster(body, members, { cellId, meetingId });

    const live = await trx
      .selectFrom('cell_attendance')
      .select(['id', 'person_id', 'present', 'version'])
      .where('cell_meeting_id', '=', existing.id)
      .where('superseded_at', 'is', null)
      .execute();

    const stored = new Map(live.map((row) => [row.person_id, row]));

    const changed = attendance.filter((line) => {
      const row = stored.get(line.person_id);

      return row === undefined || row.present !== line.present;
    });

    // **A submission that changes nothing is not an amendment**, so it needs no
    // correction capability, writes no rows, writes no audit entry and does not move the
    // meeting's version. Section 9 makes the same call one domain over: "the version
    // guards against overwriting a change nobody saw, and there is nothing here to
    // overwrite."
    //
    // *An earlier version bumped the version and wrote a `cell_attendance.corrected`
    // entry here, without requiring the capability — so the log recorded corrections
    // that corrected nothing, made by actors who could not have corrected anything.
    // Section 7 admits neither reading: either it is an amendment and the capability is
    // required, or it is not and no correction is recorded.*
    // **A submission that changes nothing succeeds, writing nothing, and takes no part
    // in the version check at all** (section 22, *Write conflicts*; decision 0191): a line that agrees
    // with the committed state "takes no part in the version check … and the identical
    // body resubmitted succeeds, writing nothing". It is not an amendment, so it needs
    // no correction capability, writes no rows, writes no audit entry and does not move
    // the meeting's version.
    //
    // *Two earlier versions got the stale-version case here wrong in opposite
    // directions. The first bumped the version and wrote a `cell_attendance.corrected`
    // entry without requiring the capability — a log of corrections that corrected
    // nothing. The second answered `RESOURCE_BUSY`, which decision 0158's question
    // refutes: could this same body, resubmitted unchanged, succeed? It could not, because
    // no version ever returns to the one it carries, so a conforming client retried
    // forever. Section 22's answer was the simplest of the three and was there all
    // along.*
    if (changed.length === 0) {
      return this.responseFor(params, {
        version: existing.version,
        recorded: attendance.length,
        present: attendance.filter((line) => line.present).length,
        corrected: 0,
      });
    }

    // **The capability is checked before anything about the stored record is disclosed,
    // and that now includes the null-version case.** What the early return above still
    // answers — matched or did not match — is accepted as a disclosure by decision 0191,
    // on the ground that recovering N people costs 2^N submissions and that the actor
    // holds the capability that records this meeting: `cell.submit_on_behalf` is settled
    // above, so every actor reaching the early return may file this meeting outright.
    // A `VERSION_CONFLICT` carries the
    // stored present count and the submitter's name (section 22), which
    // `GET .../roster` does not — so an actor holding `cell.take_attendance` and not
    // `cell.correct_subtree` could read the record out of a refusal.
    //
    // *The previous batch moved the numeric-version door behind this check and left the
    // null-version one in front of it, then claimed in its own message to have closed
    // the disclosure. Omitting `version` walked straight through. Whatever is right for
    // a client that read no record, it cannot be that one payload is withheld at one
    // door and handed over at the other.*
    await this.assertMayCorrect(trx, params);

    // **No version, against a record that exists**, is section 22's first
    // null-`submitted_version` case: the client asserted there is no record and there is
    // one. "The record did not change since it was read; it came into existence while
    // this client was drafting, which is the same problem from the other side and demands
    // the same resolution." Reached only where something actually differs, because an
    // agreeing submission returned above.
    if (body.version === undefined || body.version !== existing.version) {
      throw await this.conflictFor(trx, {
        actor,
        submittedVersion: body.version ?? null,
        existing,
        submittedPresent: attendance.filter((line) => line.present).length,
        storedPresent: live.filter((row) => row.present).length,
      });
    }

    for (const line of changed) {
      const predecessor = stored.get(line.person_id);
      const successorId = randomUUID();

      if (predecessor !== undefined) {
        // Closed first, and the successor's `recorded_at` is read back **in SQL** from
        // the row just closed. Carrying the instant through this process truncates
        // `timestamptz` microseconds to milliseconds, so the successor would begin up to
        // a millisecond before its predecessor ended — the overlap migration 0013
        // refuses, and the defect decision 0177 records shipping twice because both
        // sides of the comparison came back through the same driver.
        //
        // **The row count is read**, because a concurrent correction closing the same
        // row first leaves this matching nothing — and falling through to the insert
        // then violates `cell_attendance_one_live` and answers `INTERNAL_ERROR` on an
        // ordinary race, which section 22 names as the failure that naming these cases
        // exists to prevent.
        const closed = await trx
          .updateTable('cell_attendance')
          .set({ superseded_at: sql<Date>`clock_timestamp()`, superseded_by: successorId })
          .where('id', '=', predecessor.id)
          .where('superseded_at', 'is', null)
          .executeTakeFirst();

        if (closed.numUpdatedRows === 0n) {
          throw new LostCorrectionRace();
        }
      }

      await trx
        .insertInto('cell_attendance')
        .values({
          id: successorId,
          cell_meeting_id: existing.id,
          person_id: line.person_id,
          present: line.present,
          recorded_by: actor.accountId,
          correction_reason: body.correction_reason ?? null,
          version: predecessor === undefined ? 1 : predecessor.version + 1,
          ...(predecessor === undefined
            ? {}
            : {
                recorded_at: sql<Date>`(SELECT superseded_at FROM cell_attendance WHERE id = ${predecessor.id})`,
              }),
        })
        .execute();
    }

    // The meeting's own version moves once per submission that writes something — it is
    // the unit (section 14), so a client that read N holds a stale read afterwards.
    //
    // **Guarded on the version it read, and the result is checked.** Under READ
    // COMMITTED a concurrent correction's `UPDATE` blocks here, re-qualifies after the
    // winner commits, and matches nothing. `executeTakeFirstOrThrow` answered that with
    // a `NoResultError` the exception filter renders as `INTERNAL_ERROR`, on exactly the
    // race section 14 is about.
    const bumped = await trx
      .updateTable('cell_meetings')
      .set({ version: existing.version + 1 })
      .where('id', '=', existing.id)
      .where('version', '=', existing.version)
      .returning('version')
      .executeTakeFirst();

    if (bumped === undefined) {
      throw new LostCorrectionRace();
    }

    // Section 21 lists "Attendance corrections", and unlike a first submission this is
    // written whoever the actor is: the record changed, and `cell_meetings` carries one
    // mutable version while `cell_attendance` carries only the successor's own actor.
    //
    // **`on_behalf` is carried on the entry**, which section 21 requires in terms: "A
    // correction made for somebody else is one entry that says so… whether it was
    // somebody else's record to correct is an attribute of it, carried on the entry with
    // the responsible leader", and writing only the correction "loses every amendment an
    // upline made to a downline's records from the list that exists to find them".
    //
    // *An earlier version of this comment quoted section 21 as naming
    // `...submitted_on_behalf`. That string appears nowhere in the specification; the
    // requirement is real and the citation was invented.* Decided on the Person, as the
    // first-submission entry decides it, because section 14 makes the submitter a Person
    // and the responsible leader a Person while `actor_id` is an account.
    await this.audit.writeWithin(trx, {
      actorId: actor.accountId,
      action: 'cell_attendance.corrected',
      targetType: 'cell',
      targetId: cellId,
      before: { meeting_id: meetingId, version: existing.version },
      after: {
        meeting_id: meetingId,
        version: bumped.version,
        status: existing.status,
        responsible_leader_id: existing.responsible_leader_id,
        on_behalf: actor.personId !== existing.responsible_leader_id,
        corrected: changed.length,
        present: attendance.filter((line) => line.present).length,
      },
      // The column section 21 gives it, rather than a field inside `after`.
      reason: body.correction_reason ?? null,
    });

    return this.responseFor(params, {
      version: bumped.version,
      recorded: attendance.length,
      present: attendance.filter((line) => line.present).length,
      corrected: changed.length,
    });
  }

  /** The one response shape both outcomes of a correction answer with. */
  private responseFor(
    params: {
      cellHandle: string;
      meetingId: string;
      reportingMonth: string;
      existing: { status: string; responsible_leader_id: string; facilitated_by: string | null };
    },
    counts: { version: number; recorded: number; present: number; corrected: number },
  ): CellMeetingSubmissionResponse {
    return {
      cell_id: params.cellHandle,
      meeting_id: params.meetingId,
      status: params.existing.status,
      reporting_month: params.reportingMonth,
      responsible_leader_id: params.existing.responsible_leader_id,
      facilitated_by: params.existing.facilitated_by ?? params.existing.responsible_leader_id,
      ...counts,
    };
  }

  /**
   * The answer to a correction that lost a race (SKILL.md section 22, *Write conflicts*).
   *
   * Section 22 gives every lost race two outcomes, decided by re-reading the **committed**
   * state rather than by what the winner wrote: the submission still **disagrees** and
   * answers `VERSION_CONFLICT`, or it now **agrees** and answers `RESOURCE_BUSY`, because
   * the identical body resubmitted would succeed.
   *
   * **On the pool, after the transaction has rolled back, and the first version of this
   * read inside it.** READ COMMITTED shows a transaction its own uncommitted writes — and
   * by the time a later line loses the race this one has already inserted successors for
   * the earlier ones. Those rows are about to disappear, so comparing against them made
   * every line "agree" and answered `RESOURCE_BUSY` for a submission that genuinely
   * disagreed with what was committed. Reproduced on two connections.
   *
   * The docblock that shipped that argued the transaction was *alive*, which is true and
   * is the wrong property: what a re-read of committed state needs is **visibility**.
   * `DccAttendanceService.conflictAfterLostRace` re-reads on the pool for this reason
   * rather than incidentally.
   */
  private async lostRaceAnswer(
    cellId: string,
    meetingId: string,
    body: SubmitCellMeeting,
    actor: Actor,
  ): Promise<ApiError> {
    const meeting = await this.db
      .selectFrom('cell_meetings')
      .select(['id', 'version', 'status', 'responsible_leader_id'])
      .where('cell_id', '=', cellId)
      .where('scheduled_date', '=', meetingId)
      .executeTakeFirstOrThrow();

    // **The loser answers what this body would be answered against the committed state,
    // which is what "answers on what it finds" means** (section 22). The two guards below
    // are the two `correctWithin` runs before it reaches the same comparison, and this
    // method was reached only from that path until the first-submission catch was added.
    // Reusing the shape without re-deriving why it has that shape is what decision 0100
    // is about, and skipping them produced two defects a review reproduced.

    // **A status disagreement first, for the reason `correctWithin` gives where it does
    // the same:** a `NOT_HELD` body carries no attendance, so it reaches the comparison
    // below with an empty roster, `some` is vacuously false, and the loser is told
    // `RESOURCE_BUSY` — whose meaning is that the identical body resubmitted succeeds
    // writing nothing. It does not: the retry is refused, permanently, because section 13
    // makes a status change a separate operation. Decision 0158 fixes the test as one
    // question — could this same body, resubmitted unchanged, succeed? — and here it
    // could not.
    if (body.status !== meeting.status) {
      return new InvariantViolationError(
        'Changing a meeting’s status is a separate operation from correcting its ' +
          'attendance (SKILL.md section 13).',
        { cell_id: cellId, meeting_id: meetingId, current_status: meeting.status },
      );
    }

    // **Then the amendment capability, before any of the record is disclosed.** A
    // `VERSION_CONFLICT` carries the stored present count and the submitter's name, which
    // `GET .../roster` does not — so without this an actor holding `cell.take_attendance`
    // and not `cell.correct_subtree` read the record out of a lost race, having been
    // refused `403` for the identical body sent sequentially. Timing decided which.
    try {
      const authority = await this.authorization.authorityFor(actor.accountId);
      await this.assertMayCorrect(this.db, {
        cellId,
        meetingId,
        existing: { responsible_leader_id: meeting.responsible_leader_id },
        actor,
        authority,
      });
    } catch (error) {
      if (error instanceof ScopeDeniedError) {
        return error;
      }

      throw error;
    }

    const live = await this.db
      .selectFrom('cell_attendance')
      .select(['person_id', 'present'])
      .where('cell_meeting_id', '=', meeting.id)
      .where('superseded_at', 'is', null)
      .execute();

    const submitted = body.attendance ?? [];
    const committed = new Map(live.map((row) => [row.person_id, row.present]));
    const disagrees = submitted.some((line) => committed.get(line.person_id) !== line.present);

    if (!disagrees) {
      // **The winner recorded what this submission was carrying**, so it is unchanged
      // against the committed state, takes no part in the version check, and the
      // identical body resubmitted succeeds writing nothing — which is what
      // `RESOURCE_BUSY` means (section 22) and what the retry actually does, because the
      // no-op path above returns before the version is compared.
      return new ResourceBusyError({
        cell_id: cellId,
        meeting_id: meetingId,
        current_version: meeting.version,
      });
    }

    // Both actors and both timestamps, which section 22 requires and a placeholder
    // cannot satisfy: "A conflict response that omits any of them cannot satisfy
    // Section 14, because the person resolving it cannot tell which record to keep."
    const stored = await this.db
      .selectFrom('cell_meetings')
      .select(['submitted_by', 'submitted_at'])
      .where('id', '=', meeting.id)
      .executeTakeFirstOrThrow();

    return this.conflictFor(this.db, {
      actor,
      submittedVersion: body.version ?? null,
      existing: { version: meeting.version, ...stored },
      submittedPresent: submitted.filter((line) => line.present).length,
      storedPresent: live.filter((row) => row.present).length,
    });
  }

  /**
   * `cell.submit_on_behalf`, which section 14 requires of recording somebody else's
   * meeting (SKILL.md sections 7 and 14; ruling of 2026-09-03).
   *
   * **Measured against the leader the meeting resolves through, not its responsible
   * leader.** Section 7 places an `ACTIVE` Cell's meeting through the Cell's *current*
   * leader while section 13 freezes the responsible leader as of the meeting's date, so
   * on a Cell that has changed hands those are two people. Measuring against the frozen
   * one would refuse the successor a meeting section 7 says in terms that they file.
   *
   * *Section 21's `on_behalf` on the audit entry is measured against the responsible
   * leader instead, and that is not an inconsistency: the entry records whether the
   * record was somebody else's, and this governs whether the meeting was somebody else's
   * to reach. A successor filing a predecessor's meeting is logged on behalf and owes no
   * on-behalf capability.*
   *
   * `cell.take_attendance` was checked by the guard against the same resolution before
   * this runs, so an actor reaching here is already in scope of the meeting; what is left
   * is whether the meeting is theirs.
   */
  private async assertMayActForAnother(
    trx: Transaction<Database>,
    params: {
      cellId: string;
      meetingId: string;
      actor: Actor;
      authority: ActorAuthority;
    },
  ): Promise<void> {
    const through = await this.meetingScope.leaderForMeetingScopeWithin(
      trx,
      params.cellId,
      params.meetingId,
    );

    if (through === null || through === params.actor.personId) {
      // Their own meeting, or one nothing can place — the second is the guard's refusal
      // to make and it has already made it, since it resolves the same way.
      return;
    }

    const covered = await this.authorization.coversWith(
      trx,
      params.actor,
      params.authority,
      Capability.CellSubmitOnBehalf,
      { kind: 'person', personId: through },
    );

    if (!covered) {
      throw new ScopeDeniedError('Recording a meeting for another leader is outside your scope.', {
        capability: Capability.CellSubmitOnBehalf,
        cell_id: params.cellId,
        meeting_id: params.meetingId,
      });
    }
  }

  /**
   * `cell.correct_subtree`, which section 7 requires of an amendment and which the
   * decorator cannot declare (SKILL.md section 7).
   *
   * `cell.take_attendance` was checked by the guard before anything about the record was
   * read, so this is reached only by an actor already in scope of the meeting.
   *
   * **The target is whatever the guard resolved the meeting to, asked of the same
   * method.** Section 7 places a Cell meeting through its current leader while the Cell
   * is `ACTIVE` and through the record's frozen responsible leader once it is closed
   * (decisions 0186 and 0188) — two different Persons on a Cell that has changed hands.
   *
   * *An earlier version resolved against the frozen leader unconditionally, and the
   * docblock claimed that was "the same Person the guard used, so the two checks cannot
   * disagree". They disagree on every `ACTIVE` Cell that changed hands, and the
   * consequence was that **nobody could correct the record**: the current leader was
   * refused here, and the former leader was refused by the guard. Section 7 says in
   * terms that the current leader files it.*
   */
  private async assertMayCorrect(
    // `Db` as well as a transaction: `lostRaceAnswer` runs on the pool after its
    // transaction rolled back, and section 22 requires that re-read to see *committed*
    // state, which a doomed transaction's own view does not.
    trx: Db | Transaction<Database>,
    params: {
      cellId: string;
      meetingId: string;
      existing: { responsible_leader_id: string };
      actor: Actor;
      authority: ActorAuthority;
    },
  ): Promise<void> {
    const through = await this.meetingScope.leaderForMeetingScopeWithin(
      trx,
      params.cellId,
      params.meetingId,
    );

    const covered =
      through !== null &&
      (await this.authorization.coversWith(
        trx,
        params.actor,
        params.authority,
        Capability.CellCorrectSubtree,
        { kind: 'person', personId: through },
      ));

    if (!covered) {
      throw new ScopeDeniedError(
        'Correcting a meeting that has already been reported is outside your scope.',
        {
          capability: Capability.CellCorrectSubtree,
          cell_id: params.cellId,
          meeting_id: params.meetingId,
        },
      );
    }
  }

  /**
   * The conflict a stale version answers with (SKILL.md sections 14 and 22).
   *
   * Section 22 fixes the body: both values, both actors and both timestamps, "so that a
   * person can choose between them". For a Cell the value is the present count, which is
   * what section 14's own example is about — nine against eight is a disagreement about
   * the whole roster rather than about any one person, and several of the people in it
   * may not differ at all.
   */
  private async conflictFor(
    executor: Db | Transaction<Database>,
    params: {
      actor: Actor;
      submittedVersion: number | null;
      existing: { version: number; submitted_by: string | null; submitted_at: Date | null };
      submittedPresent: number;
      storedPresent: number;
    },
  ): Promise<ApiError> {
    return new VersionConflictError({
      submittedVersion: params.submittedVersion,
      currentVersion: params.existing.version,
      submitted: {
        values: { present: params.submittedPresent },
        recordedAt: new Date().toISOString(),
        actor: await this.personNameFor(executor, params.actor.personId),
      },
      current: {
        values: { present: params.storedPresent },
        // The meeting's own submission instant, which is when the account now stored
        // was made. A correction does not move it (section 14 preserves the submitter),
        // so this names the reading the other client is looking at.
        recordedAt: (params.existing.submitted_at ?? new Date()).toISOString(),
        actor: await this.accountNameFor(executor, params.existing.submitted_by),
      },
    });
  }

  /** A Person's name for a conflict body, on the caller's executor. */
  private async personNameFor(
    executor: Db | Transaction<Database>,
    personId: string | null,
  ): Promise<{ id: string; name: string }> {
    if (personId === null) {
      return { id: '', name: 'somebody whose account has since been removed' };
    }

    const person = await executor
      .selectFrom('persons')
      .select(['first_name', 'last_name'])
      .where('id', '=', personId)
      .executeTakeFirst();

    return {
      id: personId,
      name:
        person === undefined
          ? 'somebody no longer recorded'
          : `${person.first_name} ${person.last_name}`,
    };
  }

  /**
   * The Person behind an account, for a conflict body.
   *
   * On the caller's executor rather than the pool, for the reason the DCC counterpart
   * gives: section 14 makes a conflict an ordinary outcome rather than a rare one, so
   * reaching the pool here would ask for a second connection while holding one, every
   * time two leaders disagree (section 24).
   */
  private async accountNameFor(
    executor: Db | Transaction<Database>,
    accountId: string | null,
  ): Promise<{ id: string; name: string }> {
    if (accountId === null) {
      return { id: '', name: 'an earlier submission' };
    }

    const account = await executor
      .selectFrom('accounts')
      .select('person_id')
      .where('id', '=', accountId)
      .executeTakeFirst();

    return this.personNameFor(executor, account?.person_id ?? null);
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
