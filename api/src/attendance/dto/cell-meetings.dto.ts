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
