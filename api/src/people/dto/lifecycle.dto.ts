import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { CURSOR_MAX_LENGTH } from '../../common/cursor';
import { IsStorableText } from '../../common/text/is-storable-text';
import { ARCHIVE_REASONS, type GivenArchiveReason } from '../people.lifecycle.service';

/** `POST /api/v1/people/{id}/archive` (SKILL.md section 3, decision 0397). */
export class ArchivePersonDto {
  /** One of the seven reasons a new archive may give; the retired one is refused. */
  @IsIn(ARCHIVE_REASONS)
  reason!: GivenArchiveReason;

  /** The comment, required with `OTHER` and kept with any reason. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @IsStorableText()
  note?: string;

  /**
   * Section 6's account-access decision, required where the Person holds an account that is
   * not disabled, and needing `accounts.manage` over them.
   */
  @IsOptional()
  @IsIn(['DISABLE', 'KEEP'])
  account_access?: 'DISABLE' | 'KEEP';
}

/** A page of a decision 0397 list (section 22: defaults to 50, maximum 200). */
export class LifecycleListDto {
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  @IsStorableText()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
