import { IsIn, IsUUID, ValidateIf } from 'class-validator';

import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

/**
 * The scope selectors the **DCC** monthly report is asked for (SKILL.md section 7).
 *
 * The vocabulary is `report_snapshots.scope_type`'s (section 20), narrowed to the scopes
 * this report admits. `CELL` is the one it excludes, and it is refused here rather than
 * silently ignored: section 7 refuses a scope the actor does not hold rather than
 * narrowing it, and the same courtesy is owed to a scope this route does not offer.
 *
 * **The exclusion is a rule rather than a gap.** Section 20 attributes every DCC figure by
 * the *person*, and a Cell is not a population that key runs over — `scope_type` enumerates
 * `CELL` for the Cell domain, where section 12 puts the bucket views it exists for.
 *
 * *This said `CELL` **and `NETWORK`** were refused "rather than silently ignored", and
 * `NETWORK` had been admitted one commit earlier by the ruling that built it (decision
 * 0219). The list beneath the sentence was right and the sentence was not.*
 */
export const REPORT_SCOPES = ['WHOLE_CHURCH', 'NETWORK', 'LEADER'] as const;

/**
 * The scope selectors the **Cell** monthly report is asked for (sections 12 and 20).
 *
 * `NETWORK` is the one it excludes, and unlike the DCC list above that is a **deferral**
 * rather than a rule: section 20 says a Network narrows "which people the *person* key runs
 * over", and the Cell domain attributes by the meeting's responsible leader instead — so
 * what a `NETWORK`-scoped Cell figure narrows is unstated, and it is recorded as open in
 * `CLAUDE.md`. The DCC route shipped without `NETWORK` on the same terms and gained it when
 * a ruling settled it.
 */
export const CELL_REPORT_SCOPES = ['WHOLE_CHURCH', 'LEADER', 'CELL'] as const;

/** The two Networks (SKILL.md section 4). Closed, as the column is. */
export const REPORT_NETWORKS = ['MENS', 'WOMENS'] as const;

export type ReportScopeSelector = (typeof REPORT_SCOPES)[number];
export type CellReportScopeSelector = (typeof CELL_REPORT_SCOPES)[number];

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

  /**
   * The Network the report is scoped to. Required where `scope` is `NETWORK`.
   *
   * **A Network's population is its membership, not its root's subtree** (decision 0219),
   * so this names a Network rather than a Person and there is no leader to supply instead.
   * Sent under any other scope it is refused in the controller for the reason `leader_id`
   * is: a request naming both is asking for two different things, and answering one of them
   * silently is how a client comes to believe it asked for the other.
   */
  @ValidateIf((dto: DccMonthlyReportDto) => dto.scope === 'NETWORK')
  @IsIn(REPORT_NETWORKS)
  network?: (typeof REPORT_NETWORKS)[number];
}

export class CellMonthlyReportDto {
  /**
   * The reporting month, as the first of it. The same field as the DCC report's, with the
   * same validator and for the same reasons — see `DccMonthlyReportDto.period`.
   */
  @IsManilaCalendarDate({ message: 'period must be a real calendar date, YYYY-MM-DD' })
  period!: string;

  @IsIn(CELL_REPORT_SCOPES)
  scope!: CellReportScopeSelector;

  /**
   * The leader the report is scoped to. Required where `scope` is `LEADER`.
   *
   * **What it selects is the meetings, not the people** (section 20). A leader-scoped Cell
   * figure covers every meeting whose frozen responsible leader is in this leader's
   * subtree, and then whoever attended those meetings — which can include people who are
   * in no part of that subtree, because Cell membership need not mirror pastoral
   * assignment (section 10).
   *
   * Sent under any other scope it is refused in the controller, for the reason the DCC
   * DTO gives above.
   */
  @ValidateIf((dto: CellMonthlyReportDto) => dto.scope === 'LEADER')
  @IsUUID()
  leader_id?: string;

  /**
   * The Cell the report is scoped to. Required where `scope` is `CELL`.
   *
   * **This is the only scope at which monthly-attendance buckets exist** (section 12), so
   * it is the field that decides the shape of the response and not only its population.
   *
   * **Its authorization is dated** (decision 0220): the Cell resolves through the leader
   * in force at the period's final millisecond, falling back to the Cell's last leader
   * where nobody held it then — so the leader of a Cell closed part-way through a month
   * can still read that month, which holds real recorded attendance.
   *
   * Sent under any other scope it is refused in the controller, as `leader_id` is.
   */
  @ValidateIf((dto: CellMonthlyReportDto) => dto.scope === 'CELL')
  @IsUUID()
  cell_id?: string;
}
