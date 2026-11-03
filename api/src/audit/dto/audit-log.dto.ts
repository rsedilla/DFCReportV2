import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../../common/cursor';
import { IsStorableText } from '../../common/text/is-storable-text';
import { SEARCH_MINIMUM } from '../../people/dto/people.dto';
import { AUDIT_KINDS, type AuditKind } from '../audit-kinds';

/** The Admin's Audit Log (SKILL.md sections 19 and 22, decision 0428). */
export class AuditLogDto {
  /** A name, a Member ID or a Cell ID, or the start of one. */
  @IsOptional()
  @IsString()
  @Length(SEARCH_MINIMUM, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  q?: string;

  /** Absent is `EVERYTHING`. */
  @IsOptional()
  @IsIn(AUDIT_KINDS)
  kind?: AuditKind;

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
