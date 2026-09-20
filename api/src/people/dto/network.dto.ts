import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { CURSOR_MAX_LENGTH } from '../../common/cursor';

/**
 * The paging every tree route takes (SKILL.md section 22, decision 0252).
 *
 * **All three page, and the G12 shape is not an exemption.** Section 22's rule is
 * unqualified — "cursor-based, on every collection endpoint" — nothing in this
 * specification or the schema bounds a leader's direct disciples, and section 16 counts
 * *Leaders with 12+ Direct Leaders*, so exceeding twelve is a state the church measures
 * rather than one it forbids.
 */
export class TreePagingQueryDto {
  /**
   * Defaults to 50 and is capped at 200, matching the other collections.
   *
   * A tree page is read top down, so a caller taking the default sees the nearest
   * generations first rather than an arbitrary slice.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(200, { message: 'limit must be at most 200' })
  limit?: number;

  /**
   * **Exempt from the storable-text rule, like every other cursor**: base64url as sent
   * reaches no statement. Its *decoded* keys do, and each route's decoder validates them —
   * `decodeRosterCursor` on `my-tree` and `children`, which order by name, and
   * `decodeDescendantsCursor` on `descendants`, whose `int4`-bounded depth and UUID are
   * bound as casts and would otherwise answer `INTERNAL_ERROR`.
   */
  @IsOptional()
  @IsString()
  // `Length` rather than `MaxLength`, so `?cursor=` is refused rather than silently
  // restarting at page one -- which section 22 names as the exact asymmetry to avoid: a
  // value one byte too long was refused while one of the right length carrying nothing
  // readable was a silent restart. Every other cursor DTO here does the same.
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;
}
