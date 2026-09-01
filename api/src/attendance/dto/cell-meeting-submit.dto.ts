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
 * **Two statuses here, not three.** `HELD` and `NOT_HELD` are what a *first* submission
 * can say. `RESCHEDULED` moves an existing meeting and belongs with the change history
 * of section 13, which is a separate operation on a record that already exists — so it
 * arrives with `cell_meeting_changes` rather than here, and this DTO refuses it rather
 * than accepting a status the route cannot yet honour.
 */
export class SubmitCellMeetingDto {
  @IsIn(['HELD', 'NOT_HELD'], {
    message:
      'status must be HELD or NOT_HELD. A reschedule changes an existing meeting ' +
      '(SKILL.md section 13).',
  })
  status!: 'HELD' | 'NOT_HELD';

  /**
   * The `cell_meetings.version` the client read, or absent for a first submission.
   *
   * Section 14: "A Cell submission carries the meeting's version. One submission is one
   * leader's account of one meeting, so the meeting is the unit." Absent means the
   * client believes no record exists — and two clients can believe that at once, which
   * the unique index over `(cell_id, scheduled_date)` decides rather than a version
   * comparison, because there is no version to compare.
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
