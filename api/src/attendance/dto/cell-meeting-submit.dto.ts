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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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
 * **`RESCHEDULED` is accepted here and reachable by no path today**, which an earlier
 * version of this block obscured by saying it "is legal on a correction". It is not:
 * a correction refuses any status change, so no `cell_meetings` row can carry it. The
 * reschedule route is what makes it reachable, and it arrives with the same slice that
 * brings back `actual_date` and `actual_time`.
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
   * Optional, matching `cell_attendance.correction_reason`, and meaningless on a first
   * submission — where it is refused, so it cannot be read as a reason for the original.
   * Section 14 asks for a reason "as appropriate" rather than always: a submission is a
   * whole roster, and requiring one per changed line would put a dialog in front of a
   * leader who noticed one mistake in twenty names.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
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
}
