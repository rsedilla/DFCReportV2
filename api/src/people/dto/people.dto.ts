import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

import type { CivilStatus, Sex } from '../../database/schema';

/**
 * Section 25, rules 5 and 6: never add a civil-status or sex value beyond these
 * unless the requirements explicitly change. The database holds the same two
 * enumerations; this is the outer of the two checks, not the only one.
 */
const SEXES: Sex[] = ['MALE', 'FEMALE'];
const CIVIL_STATUSES: CivilStatus[] = ['SINGLE', 'MARRIED', 'WIDOWED'];

/**
 * Validation supports legitimate names containing spaces, hyphens, apostrophes
 * and Unicode (SKILL.md section 3, Name handling). There is deliberately no
 * "letters only" rule: it rejects real names and teaches encoders to invent
 * spellings, which is how duplicates get made.
 */
export class CreatePersonDto {
  @IsString()
  @Length(1, 100)
  first_name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  middle_name?: string | null;

  @IsString()
  @Length(1, 100)
  last_name!: string;

  /** A plain `YYYY-MM-DD` Asia/Manila date, never a timestamp (section 22). */
  @IsDateString({ strict: true })
  birth_date!: string;

  @IsIn(SEXES)
  sex!: Sex;

  @IsIn(CIVIL_STATUSES)
  civil_status!: CivilStatus;

  /**
   * Optional, and loosely validated (section 3). A required contact field gets
   * filled with fictions, and family abroad, visitors and landlines all produce
   * numbers no local mobile pattern accepts.
   */
  @IsOptional()
  @IsString()
  @Length(0, 40)
  mobile_number?: string | null;

  /**
   * Required here, though the service permits null. Section 9 captures the leader
   * at registration, and the guard resolves this endpoint's scope against them —
   * so a request without one has no target to authorize against.
   */
  @IsUUID()
  pastoral_leader_id!: string;

  /** Tier 1 candidates the actor has seen and passed over (section 3). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(50)
  acknowledged_duplicate_ids?: string[];
}

/**
 * `people.edit_basic` covers a person's own descriptive fields and nothing else
 * (section 7). Sex is absent deliberately: it determines Network, which
 * determines which pastoral edges are legal, so it has its own capability and its
 * own audited path. `whitelist` and `forbidNonWhitelisted` are on globally, so a
 * request carrying `sex` is refused rather than quietly ignored.
 */
export class EditPersonDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  middle_name?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  last_name?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  birth_date?: string;

  @IsOptional()
  @IsIn(CIVIL_STATUSES)
  civil_status?: CivilStatus;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  mobile_number?: string | null;
}

export class SearchPeopleDto {
  @IsString()
  @Length(2, 100)
  q!: string;

  /** Opaque, and passed back unmodified (section 22). */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  cursor?: string;

  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
