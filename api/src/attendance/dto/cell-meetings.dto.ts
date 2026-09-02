import { IsDateString, Matches } from 'class-validator';

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
   * **Both decorators, and the shape one alone was a 500.** `@Matches` refuses a
   * timestamp, which section 22 requires of a date-only field — "never send a date-only
   * field as a timestamp; the conversion is where months silently shift". It does not
   * refuse `2026-02-30`, which is well-shaped and is not a day, and which
   * `reportingMonthOf` throws on: a plain `Error`, which the exception filter does not
   * recognise, so the route answered `INTERNAL_ERROR`.
   *
   * `@IsDateString({ strict: true })` does the second half, and this is the convention
   * `people.dto.ts` already documents and uses on every date field it takes. This DTO
   * had only the first half, so the guard's new calendar check protected
   * `{meeting_id}` on the two routes that name a meeting and left `month` on the one
   * that does not — the same defect, one route sideways, introduced by the commit that
   * fixed it.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'month must be a YYYY-MM-DD Asia/Manila date (SKILL.md section 22).',
  })
  @IsDateString(
    { strict: true },
    { message: 'month must be a date that exists (SKILL.md section 22).' },
  )
  month!: string;
}
