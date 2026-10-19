import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../../common/cursor';
import type { NetworkName } from '../../database/schema';
import { IsStorableText } from '../../common/text/is-storable-text';
import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

/**
 * `GET /api/v1/cells/{id}/meetings` (SKILL.md sections 13 and 22).
 *
 * **`month` is a plain `YYYY-MM-DD` Manila date and is required.** Section 22: a
 * date-only field is `YYYY-MM-DD` and always an Asia/Manila date, and "never send a
 * date-only field as a timestamp; the conversion is where months silently shift".
 *
 * Required rather than defaulted to the current month, because a default here is a
 * figure that changes under the caller. Section 13 closes a month at the end of the
 * 7th, so on the 7th of April the "current" month is genuinely ambiguous between the
 * one still open for records and the one the calendar is in — and a client that meant
 * March would silently receive April. Naming the month costs a client nothing and
 * removes a class of report that is right on most days.
 */
export class CellMeetingsQueryDto {
  /**
   * Any day of the reporting month; the service normalises it to the first.
   *
   * Accepting any day rather than only the first is deliberate: a client listing "this
   * month's meetings" holds a date, not a month, and forcing it to truncate is asking
   * every client to reimplement `reportingMonthOf` — which is exactly where a month
   * silently shifts if one of them does it in local time.
   */
  /**
   * **One decorator over section 22's shared predicate, and it replaces a pair.** The
   * shape alone was a 500: `@Matches` refuses a timestamp, which section 22 requires of
   * a date-only field — "never send a date-only field as a timestamp; the conversion is
   * where months silently shift" — and does not refuse `2026-02-30`, which is
   * well-shaped and is not a day, and which `reportingMonthOf` threw on.
   *
   * The pair that fixed it added `@IsDateString({ strict: true })` for the second half.
   * That was the convention `people.dto.ts` documented, and it was one of three
   * conventions in this codebase for one rule — which is what the ruling of 2026-09-02
   * settled, by making section 22 name a single predicate and putting it behind a
   * single decorator. `IsManilaCalendarDate` does both halves, and every date-only
   * field in the API now carries it.
   */
  @IsManilaCalendarDate({
    message: 'month must be a YYYY-MM-DD Asia/Manila date that exists (SKILL.md section 22).',
  })
  month!: string;
}

/**
 * `GET /api/v1/cells/meetings/awaiting`: the month, and whose work (decision 0258). The
 * actor's own is the default; `branch` adds everyone beneath them in the pastoral tree.
 */
export class AwaitingMeetingsQueryDto extends CellMeetingsQueryDto {
  @IsOptional()
  @IsIn(['mine', 'branch'], { message: 'whose must be mine or branch' })
  whose?: 'mine' | 'branch';
}

/**
 * `GET /api/v1/cells/meetings/pending` (SKILL.md section 19; decision 0368): Record's
 * Pending CG Records, the Cells of the reader's scope with a meeting still to record whose
 * week is open, paged by the leader's name, as `GET /dcc/pending-leaders` is.
 */
export class CellPendingQueryDto {
  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** The `next_cursor` of the previous page, passed back unmodified (section 22). */
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;

  /**
   * Narrows the list to Cells whose Cell ID contains the term, or whose leader's name,
   * normalized, or Member ID does. Two characters minimum, counted again by the service on
   * the term as searched (decision 0261).
   */
  @IsOptional()
  @IsString()
  @Length(2, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  q?: string;

  /** Narrows the list to the Cells whose leader is in one Network now. */
  @IsOptional()
  @IsIn(['MENS', 'WOMENS'], { message: 'network accepts MENS or WOMENS (SKILL.md section 22).' })
  network?: NetworkName;

  /**
   * `true` keeps only the meetings past their deadline whose week is still open, and the
   * Cells with one (decision 0368). Anything but `true` or `false` is refused.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  late?: boolean;

  /**
   * Keeps only that leader's branch now: them and everyone beneath them, within the reader's
   * scope (decision 0370). Opened from a Recording Progress row.
   */
  @IsOptional()
  @IsUUID()
  leader_id?: string;
}
