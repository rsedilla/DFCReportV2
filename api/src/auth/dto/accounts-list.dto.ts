import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../../common/cursor';
import { IsStorableText } from '../../common/text/is-storable-text';
import { SEARCH_MINIMUM } from '../../people/dto/people.dto';
import { ACCOUNT_FILTERS, type AccountFilter } from '../accounts-list.service';

/** The Admin area's Accounts list (SKILL.md sections 19 and 22, decision 0419). */
export class AccountsListDto {
  /** A name, username or email address, or part of one. */
  @IsOptional()
  @IsString()
  @Length(SEARCH_MINIMUM, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  q?: string;

  /** Absent lists every account. */
  @IsOptional()
  @IsIn(ACCOUNT_FILTERS)
  filter?: AccountFilter;

  /** Opaque, and passed back unmodified (section 22). */
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
}
