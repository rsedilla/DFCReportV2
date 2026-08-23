import { Transform, Type } from 'class-transformer';
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
  Matches,
  Max,
  Min,
} from 'class-validator';

import { canonicalId } from '../../common/identifiers';

import type { CivilStatus, Sex } from '../../database/schema';

/**
 * Section 25, rules 5 and 6: never add a civil-status or sex value beyond these
 * unless the requirements explicitly change. The database holds the same two
 * enumerations; this is the outer of the two checks, not the only one.
 */
const SEXES: Sex[] = ['MALE', 'FEMALE'];

/**
 * A date-only field is `YYYY-MM-DD` and nothing else (SKILL.md section 22:
 * "Never send a date-only field as a timestamp; the conversion is where months
 * silently shift").
 *
 * `@IsDateString({ strict: true })` alone is not enough — it accepts a full ISO
 * timestamp. One arriving here would be stored, compared as a raw string against
 * stored `YYYY-MM-DD` values, and match nothing: every Tier 1 birthday rule and
 * the whole transposition rule would go quiet, and creation would proceed without
 * the acknowledgement section 3 requires, with nothing reporting a problem. The
 * shape check is what refuses it; `IsDateString` still does the work of refusing
 * a date that does not exist.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CIVIL_STATUSES: CivilStatus[] = ['SINGLE', 'MARRIED', 'WIDOWED'];

/**
 * Identifiers arrive canonical, so that nothing downstream has to remember that a
 * `uuid` column compares case-insensitively while TypeScript does not
 * (`common/identifiers.ts` gives the two defects this has already caused).
 *
 * Typed rather than inlined, because `TransformFnParams.value` is `any` and an
 * inline arrow returns it as `any` into a `string` field — which is how a
 * transform that silently did nothing would look exactly like one that worked.
 */
function toCanonicalId({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? canonicalId(value) : value;
}

function toCanonicalIds({ value }: { value: unknown }): unknown {
  return Array.isArray(value)
    ? (value as unknown[]).map((item) => toCanonicalId({ value: item }))
    : value;
}

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
  @Matches(DATE_ONLY, { message: 'must be a plain YYYY-MM-DD date, not a timestamp' })
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
   *
   * Canonicalized on the way in, like every identifier a client supplies: a `uuid`
   * column compares case-insensitively and TypeScript does not, so an id spelled in
   * uppercase is one record to the database and a different string to any
   * comparison written here (`common/identifiers.ts`).
   */
  @Transform(toCanonicalId)
  @IsUUID()
  pastoral_leader_id!: string;

  /** Tier 1 candidates the actor has seen and passed over (section 3). */
  @IsOptional()
  @Transform(toCanonicalIds)
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
  @Matches(DATE_ONLY, { message: 'must be a plain YYYY-MM-DD date, not a timestamp' })
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

/**
 * The audited sex correction of SKILL.md section 4.
 *
 * Not part of `EditPersonDto` and never will be: sex determines Network, which
 * determines which pastoral edges are legal, so it carries its own capability
 * (`people.correct_sex`, Admin-only at Whole Church) and forces a Network change
 * and the reassignment that goes with it.
 */
export class CorrectSexDto {
  @IsIn(SEXES)
  sex!: Sex;

  /**
   * Required. Section 4: every use of this endpoint is a correction, and
   * `network_assignments.reason` is nullable only because an initial assignment
   * has nothing to explain.
   */
  @IsString()
  @Length(1, 500)
  reason!: string;

  /**
   * The leader the person moves to, in their **new** Network.
   *
   * Required exactly when the person holds an open pastoral edge, because section
   * 4 makes the change and the reassignment one atomic operation and neither may
   * validly precede the other. Rejected when they hold none, so that a client
   * naming a leader is never quietly ignored.
   */
  @IsOptional()
  @Transform(toCanonicalId)
  @IsUUID()
  pastoral_leader_id?: string;

  /**
   * A plain `YYYY-MM-DD` Asia/Manila date, never a timestamp (section 22),
   * resolved to the start of that day in that zone (section 20).
   *
   * Its presence is what makes this a backdated correction, which additionally
   * requires `records.backdate_effective_date` (section 5) and is bounded by the
   * floor in section 4. Absent, the correction takes effect when it is recorded.
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'must be a plain YYYY-MM-DD date, not a timestamp' })
  @IsDateString({ strict: true })
  effective_date?: string;
}

/**
 * Reassigning a person's pastoral leader (SKILL.md section 5, Changing a person's
 * pastoral leader).
 *
 * The contract these fields carry is pinned by the eleven authorization cases in
 * `test/authorization/pastoral-assignment.spec.ts`, which were written before the
 * endpoint and are what it is built toward.
 */
export class ReassignPastoralLeaderDto {
  /** The leader the person moves to, in the person's own unchanged Network. */
  @Transform(toCanonicalId)
  @IsUUID()
  leader_id!: string;

  /**
   * Required when `effective_date` is given and not otherwise (section 5).
   * Backdating "always requires a reason"; an ordinary reassignment records a
   * decision taken today and the audit entry already carries who took it.
   */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  /**
   * A plain `YYYY-MM-DD` Asia/Manila date (section 22), resolved to the start of
   * that day in that zone (section 20). Its presence makes this a backdated
   * reassignment, which additionally requires `records.backdate_effective_date`
   * and is bounded by the two rules in section 5.
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'must be a plain YYYY-MM-DD date, not a timestamp' })
  @IsDateString({ strict: true })
  effective_date?: string;
}

/**
 * The pre-flight duplicate check (SKILL.md section 3; section 9, step 1: "Search
 * existing People first").
 *
 * Everything is optional except the names, because this is asked *before* a
 * Person exists and an encoder may not yet have a birthday or a number. Section 3
 * is explicit that a missing middle name or birthday never counts against a
 * match.
 */
export class DuplicateCandidatesDto {
  @IsString()
  @Length(1, 100)
  first_name!: string;

  @IsString()
  @Length(1, 100)
  last_name!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'must be a plain YYYY-MM-DD date, not a timestamp' })
  @IsDateString({ strict: true })
  birth_date?: string;

  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  mobile_number?: string;

  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
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
