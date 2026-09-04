import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { CURSOR_MAX_LENGTH, NAME_FIELD_MAX_LENGTH } from '../../common/cursor';
import { IsManilaCalendarDate } from '../../common/time/is-manila-calendar-date';

import type { CivilStatus, Sex } from '../../database/schema';
import { IsStorableText } from '../../common/text/is-storable-text';

/**
 * Section 25, rules 5 and 6: never add a civil-status or sex value beyond these
 * unless the requirements explicitly change. The database holds the same two
 * enumerations; this is the outer of the two checks, not the only one.
 */
const SEXES: Sex[] = ['MALE', 'FEMALE'];

/**
 * Every date-only field here carries `@IsManilaCalendarDate()`, which is section 22's
 * single predicate for the whole API (ruling of 2026-09-02).
 *
 * It replaces the `@Matches(DATE_ONLY)` plus `@IsDateString({ strict: true })` pair
 * this file used to document, and does both halves of what that pair did. The shape
 * half matters here for a reason particular to this module: a full ISO timestamp is
 * what `@IsDateString` alone admits, and one arriving here would be stored, compared
 * as a raw string against stored `YYYY-MM-DD` values, and match nothing — so every
 * Tier 1 birthday rule and the whole transposition rule would go quiet, and creation
 * would proceed without the acknowledgement section 3 requires, with nothing reporting
 * a problem.
 *
 * That argument is why this file had the stricter of the three conventions the ruling
 * found. What it did not have was the *same* convention as its neighbours, and the
 * loosest of the three wrote a Cell closure effective on a day nobody named.
 *
 * **Nothing this file accepts or refuses changes**, and that was verified rather than
 * assumed: the pair and `isCalendarDate` agree on every well-shaped value tried, years
 * 1 to 99 included. This is a consolidation, and the mutation that restores the pair
 * survives every case here — by construction, because the two are equivalent.
 */
const CIVIL_STATUSES: CivilStatus[] = ['SINGLE', 'MARRIED', 'WIDOWED'];

/**
 * Validation supports legitimate names containing spaces, hyphens, apostrophes
 * and Unicode (SKILL.md section 3, Name handling). There is deliberately no
 * "letters only" rule: it rejects real names and teaches encoders to invent
 * spellings, which is how duplicates get made.
 */
export class CreatePersonDto {
  @IsString()
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  first_name!: string;

  @IsOptional()
  @IsString()
  @Length(0, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  middle_name?: string | null;

  @IsString()
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  last_name!: string;

  /**
   * A plain `YYYY-MM-DD` Asia/Manila date, never a timestamp (section 22).
   *
   * Optional, per section 3. A leader registering somebody at first contact may
   * not have asked, and somebody may decline to give it — and a mandatory field
   * that people cannot fill is filled with fictions, which for this field means
   * false Tier 1 matches that then block real people from being recorded.
   */
  @IsOptional()
  @IsManilaCalendarDate()
  birth_date?: string;

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
  @IsStorableText()
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
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(0, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  middle_name?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  last_name?: string;

  /**
   * Set only. `@ValidateIf` rather than `@IsOptional()`, deliberately.
   *
   * `@IsOptional()` skips `null` as well as `undefined`, so an explicit
   * `{"birth_date": null}` would reach the service and erase a recorded birthday.
   * Before the column became nullable the database refused that; migration 0007
   * would have turned it into a working destructive edit nobody decided on —
   * verified, it answered 200 and wrote NULL over a recorded date.
   *
   * Section 3 defines adding a birthday and does not define removing one, so this
   * refuses `null` as malformed input rather than answering a question the
   * specification has not been asked. The two fields either side of it are
   * `string | null` because clearing them *is* intended, which is what makes the
   * difference here a decision rather than an oversight.
   */
  @ValidateIf((body: EditPersonDto) => body.birth_date !== undefined)
  @IsManilaCalendarDate()
  birth_date?: string;

  @IsOptional()
  @IsIn(CIVIL_STATUSES)
  civil_status?: CivilStatus;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  @IsStorableText()
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
  @IsStorableText()
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
  @IsManilaCalendarDate()
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
  /**
   * The leader the person moves to, in the person's own unchanged Network.
   *
   * Named `pastoral_leader_id` to match `POST /people` and the sex correction
   * (section 22, Conventions). Section 11 makes Cell leadership a first-class
   * concept, so a bare `leader_id` is ambiguous in this domain — the longer name
   * says which kind. The database column stays `pastoral_assignments.leader_id`,
   * which its table already disambiguates.
   */
  @IsUUID()
  pastoral_leader_id!: string;

  /**
   * Required when `effective_date` is given and not otherwise (section 5).
   * Backdating "always requires a reason"; an ordinary reassignment records a
   * decision taken today and the audit entry already carries who took it.
   */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @IsStorableText()
  reason?: string;

  /**
   * A plain `YYYY-MM-DD` Asia/Manila date (section 22), resolved to the start of
   * that day in that zone (section 20). Its presence makes this a backdated
   * reassignment, which additionally requires `records.backdate_effective_date`
   * and is bounded by the two rules in section 5.
   */
  @IsOptional()
  @IsManilaCalendarDate()
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
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  first_name!: string;

  @IsString()
  @Length(1, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  last_name!: string;

  @IsOptional()
  @IsManilaCalendarDate()
  birth_date?: string;

  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  @IsStorableText()
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
  // The upper bound is the name bound rather than a coincidence that matches it: this
  // term is matched against `first_name`, `last_name` and the two joined, so a bound
  // below `NAME_FIELD_MAX_LENGTH` would leave a full-length name searchable only by
  // prefix, and would do so silently if that constant were ever raised. The minimum is
  // its own rule — two characters, so a one-letter probe cannot page the directory.
  @Length(2, NAME_FIELD_MAX_LENGTH)
  @IsStorableText()
  q!: string;

  /**
   * Opaque, and passed back unmodified (section 22).
   *
   * **500 was too small, and the same defect was found on the Cell roster first.** This
   * cursor carries `last_name`, `first_name` and a UUID; the two names are bounded at
   * 100 UTF-16 units each by the create and edit DTOs, and section 3 lets a name hold
   * any character — so 100 three-byte characters apiece is 600 bytes before the UUID and
   * the JSON punctuation, and base64url of that is 899. Past it the server emits a
   * cursor its own DTO refuses, and the client is answered `VALIDATION_FAILED` on a
   * value it was handed, with no way to page on.
   *
   * Fixed here rather than left, because `common/cursor.ts` cites this field as the
   * precedent it was measured against, and a reader checking that citation would find
   * the defect still in it. The bound is shared and explained there — and it is a guard
   * on request size rather than a proof, because the column is bare `text` and the tree
   * import bounds no name, which `CLAUDE.md` carries as open.
   */
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;

  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
