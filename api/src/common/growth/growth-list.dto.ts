import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../cursor';
import { IsStorableText } from '../text/is-storable-text';
import { SEARCH_MINIMUM } from '../../people/dto/people.dto';

/**
 * A Growth tab's list (SKILL.md section 28): searched as the People list is, and paged by
 * the same name key (section 22).
 */
export class GrowthListDto {
  /** A name, or a Member ID prefix, as on the People list (section 8, decision 0259). */
  @IsOptional()
  @IsString()
  @Length(SEARCH_MINIMUM, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  q?: string;

  /** The `next_cursor` of the previous page, passed back unmodified (section 22). */
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  @IsStorableText()
  cursor?: string;

  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /**
   * Only the actor's own direct disciples, as the Cells list offers its own Cells
   * (decision 0226). Anything but `true` or `false` is left for `@IsBoolean()` to refuse.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  mine?: boolean;
}
