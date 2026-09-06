import { IsIn, IsUUID, ValidateIf } from 'class-validator';

import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

/**
 * The scope selector a report is asked for (SKILL.md section 7).
 *
 * The vocabulary is `report_snapshots.scope_type`'s (section 20), narrowed to what the
 * service computes today. `CELL` and `NETWORK` are in that enumeration and are refused
 * here rather than silently ignored: a client asking for a Network report and receiving a
 * Whole Church one would be told nothing, and section 7 refuses a scope the actor does not
 * hold rather than narrowing it — the same courtesy is owed to a scope nothing computes.
 */
export const REPORT_SCOPES = ['WHOLE_CHURCH', 'LEADER'] as const;

export type ReportScopeSelector = (typeof REPORT_SCOPES)[number];

export class DccMonthlyReportDto {
  /**
   * The reporting month, as the first of it — `2026-10-01`, which is this repository's
   * one spelling of a month.
   *
   * **`IsManilaCalendarDate` rather than `@IsString()`**, which is what it was and which
   * `storable-text-coverage.spec.ts` correctly flagged: a bare `@IsString()` accepts
   * arbitrary text, so §22's storability rule reached it and the check derived it as a
   * free-text field. It is not one. Constraining the shape is the honest fix rather than
   * decorating a month as though a leader might type a null byte into it — and decision
   * 0185's validator refuses a well-formed value that is not a real day, where a regex
   * would admit `2026-02-30`.
   *
   * **What stays in `assertReportingMonth` is the rest of the rule**: that the day is the
   * first of the month, and that the month is before December 9999. Those are domain
   * bounds rather than a shape, and the capability guard applies them before this DTO is
   * constructed, because the instant it resolves scope at is derived from this field.
   */
  @IsManilaCalendarDate({ message: 'period must be a real calendar date, YYYY-MM-DD' })
  period!: string;

  @IsIn(REPORT_SCOPES)
  scope!: ReportScopeSelector;

  /**
   * The leader the report is scoped to. Required where `scope` is `LEADER`.
   *
   * A `leader_id` sent alongside `WHOLE_CHURCH` is refused in the controller rather than
   * here: `@ValidateIf` sets a condition for the whole property, so "a UUID under one
   * scope and absent under the other" is not expressible as two decorators on one field.
   * It is refused rather than ignored, because a request naming both is asking for two
   * different things and answering one of them silently is how a client comes to believe
   * it asked for the other.
   */
  @ValidateIf((dto: DccMonthlyReportDto) => dto.scope === 'LEADER')
  @IsUUID()
  leader_id?: string;
}
