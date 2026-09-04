import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { IsStorableText } from '../../common/text/is-storable-text';
import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

/**
 * Amending a month that has already closed (SKILL.md section 13; decision 0182).
 *
 * **A flag on the submission route, not a route of its own.** Section 13: "Everything an
 * amendment does is what a submission does — the roster, the per-line rules, the version
 * check, the all-or-nothing rule, the idempotency obligations of Section 22 — and only
 * *when* it is allowed and *who* may do it differ. A second route would have to stay
 * behaviourally identical to this one forever."
 *
 * Its presence skips the window check **and nothing else**, and requires
 * `records.backdate_effective_date` *in addition to* `cell.take_attendance` — so an
 * amendment widens *when* and never *what* or *whose*.
 *
 * The reason is required by the object rather than optional within it: section 13 owes an
 * amendment a reason, and an optional field on an optional object is a reason nobody
 * supplies.
 */
export class ClosedMonthAmendmentDto {
  /**
   * **Non-blank, not merely present or non-empty.** Section 5 requires a reason for every
   * backdated effective date, and `@IsString()` alone accepts `""` — a reason nobody
   * supplied, arriving through the very shape this object exists to prevent. Section 21
   * stores it, so a blank one is an audit entry that explains nothing.
   *
   * `@Matches(/\S/)` rather than `@MinLength(1)`, which was the first fix and let `" "`
   * through — the same hole one space wider. The repository's nearest precedents
   * (`people.dto.ts`'s Network-change and backdate reasons) carry `@Length(1, 500)` and
   * have it too; that is a gap to close there rather than a shape to copy here.
   *
   * `correction_reason` on this route carries no non-blank rule, and that is not a
   * precedent to copy here (section 25 rule 19): section 14 asks for one "as appropriate"
   * and it is optional, while this one is the whole justification for reaching past a
   * closed window.
   *
   * **`@IsStorableText` because this field reaches `audit_log.reason`**, and a null byte
   * in it answered `INTERNAL_ERROR` on every path of this route. It was the one free-text
   * field of this DTO left undecorated when the other two were guarded — in the commit
   * whose own docblock claimed the rule was applied to every free-text field on the
   * route. Same route, same file, same class, found by the review after.
   */
  @IsString()
  @Matches(/\S/, { message: 'reason must not be blank' })
  @MaxLength(500)
  @IsStorableText()
  reason!: string;
}

/** One person's presence at the meeting (SKILL.md section 12). */
export class CellAttendanceLineDto {
  @IsUUID()
  person_id!: string;

  /**
   * Face to face only (section 12). There is no third value: a person was in the room
   * or was not, and online participation "creates no attendance record".
   */
  @IsBoolean()
  present!: boolean;
}

/**
 * `POST /api/v1/cells/{id}/meetings/{meeting_id}/submit` (SKILL.md sections 12, 13, 14).
 *
 * **One route for the first submission and for a correction**, which is what section 22
 * documents — its route list carries this one write and notes that an Admin amendment is
 * a flag on it. Section 13 gives the argument, about the amendment and applying equally
 * here: everything a correction does is what a submission does, and "a second route would
 * have to stay behaviourally identical to this one forever". `DccAttendanceService` takes
 * the same shape one domain over, for the same reason.
 *
 * The two are told apart by `version`, and the capability differs between them: section 7
 * guards a first submission with `cell.take_attendance` and a correction with
 * `cell.correct_subtree`. A route declares one capability, so the second is checked in
 * the service — again as DCC does.
 *
 * **`actual_date` and `actual_time` are deliberately absent**, and were briefly here.
 * `forbidNonWhitelisted` refuses an undeclared field, so declaring one the service does
 * not read turns a refusal into silent acceptance — and section 22's versioning rule
 * makes that costly in one direction only: a field accepted and ignored cannot later be
 * given meaning without changing behaviour for clients already sending it. They arrive
 * with the reschedule that reads them.
 *
 * **All three statuses, and the first submission's restriction moved to the service.**
 * `RESCHEDULED` is not legal on a first submission (section 13, decision 0188), and a DTO
 * cannot tell a first submission from a correction: whether a record exists is a fact
 * about the database. It was refused here while the route made only first submissions; it
 * is now refused in the service, where the answer is known, and the refusal is an
 * `INVARIANT_VIOLATION` rather than a validation error because the request is well formed
 * and breaks a domain rule.
 *
 * **`RESCHEDULED` is reachable from 2026-09-04** (decision 0195), on a second submission
 * carrying `actual_date` against a record that already exists. It was accepted and
 * reachable by no path before that: a correction refused any status change, so no
 * `cell_meetings` row could carry it. Four transitions are legal and the service refuses
 * the rest — a DTO cannot tell them apart, because which one this is depends on what is
 * stored.
 *
 * **That is not the `actual_date` argument run backwards, and a version of this block
 * said it was.** `actual_date` is absent because accepting a field and ignoring it forfeits
 * the refusal `forbidNonWhitelisted` would give — an argument against *accepting*. This
 * status is declared because section 13 names exactly three and the enum is the domain's,
 * not this route's. Narrowing it later is not impossible, only versioned (section 22), so
 * the two are separate reasons rather than two halves of one.
 */
export class SubmitCellMeetingDto {
  @IsIn(['HELD', 'RESCHEDULED', 'NOT_HELD'])
  status!: 'HELD' | 'RESCHEDULED' | 'NOT_HELD';

  /**
   * Why an already-recorded meeting is being changed (section 14).
   *
   * Optional, matching `cell_attendance.correction_reason`. Section 14 asks for a reason
   * "as appropriate" rather than always: a submission is a whole roster, and requiring one
   * per changed line would put a dialog in front of a leader who noticed one mistake in
   * twenty names.
   *
   * **It is meaningless on a first submission and is accepted there, and this paragraph
   * said it was refused.** It is not: a first submission carrying one answers 201 and the
   * value is stored nowhere. Nor is it stored on a transition to `NOT_HELD`, where that
   * branch writes `not_held_note` into the column instead. So the field is honoured on the
   * correction and reschedule paths and dropped on the two beside them, which is the shape
   * section 22 says can never be given meaning later.
   *
   * Recorded as open in `CLAUDE.md` rather than fixed here, because the answer is a rule
   * and not a guard: refusing it on a first submission is one answer, and storing it on a
   * `NOT_HELD` transition is another, and that one has to say what happens when a leader
   * sends both a `correction_reason` and a `not_held_note` for a single column.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsStorableText()
  correction_reason?: string;

  /**
   * The `cell_meetings.version` the client read, or absent for a first submission.
   *
   * Section 14: "A Cell submission carries the meeting's version. One submission is one
   * leader's account of one meeting, so the meeting is the unit." Absent means the
   * client believes no record exists — and two clients can believe that at once, which
   * the unique index over `(cell_id, scheduled_date)` decides rather than a version
   * comparison, because there is no version to compare.
   *
   * **Present means the client read a record and is correcting it.** That is what tells
   * this route which of its two operations it is performing, and therefore which
   * capability section 7 requires. A version sent for a meeting with no record is
   * refused — section 22 is explicit that a refusal with no second value to show is not
   * a `VERSION_CONFLICT`, whatever went stale.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /**
   * Who conducted the meeting, where that is not the responsible leader (section 13).
   *
   * Nullable and defaulted rather than required: section 13 defaults it to "the
   * meeting's responsible leader — whoever led the Cell on its date, and not whoever
   * holds the Cell when the record is entered".
   */
  @IsOptional()
  @IsUUID()
  facilitated_by?: string;

  /** Required where the status is `NOT_HELD`, from section 13's fixed list. */
  @IsOptional()
  @IsIn([
    'LEADER_UNAVAILABLE',
    'WEATHER_OR_CALAMITY',
    'HOLIDAY_OR_CHURCH_EVENT',
    'NO_MEMBERS_AVAILABLE',
    'OTHER',
  ])
  not_held_reason?: string;

  /** Required where the reason is `OTHER` (section 13). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @IsStorableText()
  not_held_note?: string;

  /**
   * Every member of the Cell on the meeting date, present or not.
   *
   * **Required for `HELD`, and it is the whole roster rather than the people who
   * came.** Section 13: a meeting where the leader was there and nobody else came "is
   * `HELD` with zero attendance. It counts in the denominator, and **every member is
   * recorded as not having attended**." Absent rows and rows marked absent are
   * different facts, and section 20's reconciliation needs the second: classification
   * and monthly-attendance buckets must sum to the same unique-people total, which a
   * roster with holes in it cannot do.
   *
   * Forbidden for `NOT_HELD`, which "carries no attendance" — the meeting did not
   * happen, so there is nobody to have been absent from it.
   *
   * The bound matches `POST /cells/{id}/closure`, which section 22 caps at 500 for the
   * same reason: it is a Cell roster, and a Cell that size is a data defect rather than
   * a large Cell.
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CellAttendanceLineDto)
  attendance?: CellAttendanceLineDto[];

  /**
   * The date the meeting actually took place, where it moved (section 13, decision 0195).
   *
   * **Present exactly on a reschedule**, which is `status: 'RESCHEDULED'` against a record
   * that already exists. It moves `actual_date` and leaves `scheduled_date` alone, so the
   * meeting's identity survives — `(cell_id, scheduled_date)` — and so does its
   * `reporting_month` and its `week_starting`. A January 31 meeting moved to February 2
   * still reports in January.
   *
   * **These two were deliberately absent until this slice**, and the docblock above says
   * why: `forbidNonWhitelisted` refuses an undeclared field, so declaring one the service
   * does not read turns a refusal into silent acceptance, and section 22's versioning rule
   * makes that irreversible. The reschedule route is what reads them, so they arrive with
   * it.
   *
   * `IsManilaCalendarDate` rather than a shape check: a well-formed value that is not a
   * day — `2026-02-30` — is refused at the edge rather than normalised into a date nobody
   * named (decision 0185).
   */
  @IsOptional()
  @IsManilaCalendarDate({ message: 'actual_date must be a real calendar date, YYYY-MM-DD' })
  actual_date?: string;

  /** The time it actually took place, where that moved too. Optional (section 13). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'actual_time must be HH:MM' })
  actual_time?: string;

  /**
   * Present only to amend a month that has already closed (section 13, decision 0182).
   *
   * Absent, a closed month refuses for an Admin too — so a retry that happens to arrive
   * after the 7th never rewrites a closed period by accident.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ClosedMonthAmendmentDto)
  amendment?: ClosedMonthAmendmentDto;
}
