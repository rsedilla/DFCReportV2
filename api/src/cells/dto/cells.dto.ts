import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Max, Min, ValidateIf } from 'class-validator';

import { CURSOR_MAX_LENGTH } from '../../common/cursor';

import type {
  CellCategory,
  CellClosureReason,
  CellDeclineReason,
  CellRequestKind,
} from '../../database/schema';

const CATEGORIES: CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];

/** Section 10: `kind` is a closed enumeration; a third value is an amendment. */
const REQUEST_KINDS: CellRequestKind[] = ['NEW_CELL', 'HANDOVER'];

/** Section 10, *Declining*. Fixed, and not administrator-configurable. */
const DECLINE_REASONS: CellDeclineReason[] = [
  'LEADER_DEVELOPMENT_CONTINUING',
  'TIMING_DEFERRED',
  'DUPLICATE_REQUEST',
  'SUBMITTED_IN_ERROR',
  'OTHER',
];

/**
 * Section 10, *Closure reasons*, and the list is closed.
 *
 * Multiplication is deliberately absent and must not be added: when a Cell
 * multiplies a disciple opens a new Cell and the original continues under the same
 * leader, so multiplication creates Cells and never closes one.
 */
const CLOSURE_REASONS: CellClosureReason[] = [
  'MERGED_INTO_ANOTHER_CELL',
  'LEADER_STEPPED_DOWN',
  'MEMBERS_DISPERSED',
  'CREATED_IN_ERROR',
  'OTHER',
];

/**
 * `POST /api/v1/cells` (SKILL.md section 22).
 *
 * **`cell_leader_id`, not `leader_id`.** Section 22 fixes the name: section 11
 * makes Cell leadership a first-class concept distinct from pastoral leadership, so
 * a bare `leader_id` does not say which kind of leader it means. The identifier
 * pipe canonicalizes it, because the field name says it is one.
 */
export class CreateCellDto {
  @IsUUID()
  cell_leader_id!: string;

  @IsIn(CATEGORIES)
  category!: CellCategory;

  /**
   * ISO 8601 day number: 1 is Monday, 7 is Sunday.
   *
   * Section 20 begins a calendar week on Monday, and this is what
   * `EXTRACT(ISODOW ...)` returns — so deriving a month's scheduled meetings is
   * arithmetic against the calendar rather than a mapping table. The same check
   * exists in the database; this one is here so a bad value is `VALIDATION_FAILED`
   * rather than a constraint violation.
   */
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week!: number;

  /**
   * Wall-clock time in Asia/Manila, with no offset of its own (section 20).
   *
   * A standing weekly schedule means the same wall-clock time each week rather than
   * a fixed instant, so an offset here would be wrong rather than redundant.
   */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'time_of_day must be HH:MM or HH:MM:SS, in Asia/Manila wall-clock time',
  })
  time_of_day!: string;
}

/**
 * `POST /api/v1/cells/leadership-requests` (SKILL.md section 10, *Creating a Cell*).
 *
 * **One shape for both kinds, because section 10 makes it one workflow.** Both carry
 * the same state machine, the same decline reasons, the same approver and the same two
 * steps, and section 10 says in terms that splitting them "would duplicate all four and
 * let them drift". `kind` decides which of the remaining fields are required, exactly as
 * it decides which columns migration 0009 requires.
 *
 * `cell_id` is the one field meaning something different in each: for a handover it
 * names the Cell at request, and for a new Cell nothing names one until approval mints
 * it. It is refused rather than ignored on a `NEW_CELL` request — the database has a
 * check constraint saying a `PENDING` `NEW_CELL` names no Cell, and a client that sent
 * one meant something the workflow cannot do.
 */
export class CreateLeadershipRequestDto {
  @IsIn(REQUEST_KINDS)
  kind!: CellRequestKind;

  /**
   * The person the request says is ready to lead.
   *
   * **The guard resolves scope against this field**, at subtree-excluding-self — the
   * one place in the system where a scope value does that work, because the object the
   * scope is about is also the one object the actor may not be (section 7, section 10).
   */
  @IsUUID()
  prospective_leader_id!: string;

  /** Required for a new Cell, refused for a handover: a handover changes no schedule. */
  @ValidateIf((dto: CreateLeadershipRequestDto) => dto.kind === 'NEW_CELL')
  @IsIn(CATEGORIES)
  category?: CellCategory;

  /** ISO 8601 day number, 1 Monday to 7 Sunday, as `CreateCellDto` (section 20). */
  @ValidateIf((dto: CreateLeadershipRequestDto) => dto.kind === 'NEW_CELL')
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week?: number;

  /** Asia/Manila wall-clock time with no offset of its own, as `CreateCellDto`. */
  @ValidateIf((dto: CreateLeadershipRequestDto) => dto.kind === 'NEW_CELL')
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'time_of_day must be HH:MM or HH:MM:SS, in Asia/Manila wall-clock time',
  })
  time_of_day?: string;

  /**
   * The Cell being handed over. Required for a handover, and refused for a new Cell.
   *
   * **Only the first half is here.** Two `@ValidateIf`s on one property are **ANDed**,
   * not replaced — `class-validator` collects every conditional and skips the property
   * if any returns false — so "present and a UUID for a handover" and "absent for a new
   * Cell" cannot both be expressed here, because their conjunction is unsatisfiable.
   * (*An earlier version of this said the second condition replaced the first. The
   * conclusion was right and the mechanism was not.*) The refusal lives in the service,
   * beside the other rules `kind` decides, and `forbidNonWhitelisted` cannot help
   * because the field is whitelisted on this DTO.
   */
  @ValidateIf((dto: CreateLeadershipRequestDto) => dto.kind === 'HANDOVER')
  @IsUUID()
  cell_id?: string;
}

/**
 * `GET /api/v1/cells/leadership-requests` (SKILL.md section 19, section 22).
 *
 * The same two parameters section 22 fixes for every collection, and the same bounds
 * the Cell roster carries: a default of 50, a maximum of 200, and an opaque cursor
 * bounded by the shared guard in `common/cursor.ts`.
 */
export class LeadershipRequestQueueDto {
  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** The `next_cursor` of the previous page, passed back unmodified (section 22). */
  @IsOptional()
  @IsString()
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;
}

/**
 * `POST /api/v1/cells/leadership-requests/{request_id}/decline`
 * (SKILL.md section 10, *Declining*).
 *
 * The list is fixed and not administrator-configurable (section 10). It is short and
 * neutral by design: a decline is a durable record about a named person, and an
 * unconstrained free-text field is exactly where a judgmental label would be written
 * (section 1, principle 7). A decline records that a Cell was not opened at this time
 * and never an assessment of the person.
 */
export class DeclineLeadershipRequestDto {
  @IsIn(DECLINE_REASONS)
  reason!: CellDeclineReason;

  /**
   * Required where the reason is `OTHER`, and **permitted with any other reason**.
   *
   * *An earlier version said "refused otherwise", which was a rule section 10 does not
   * have — its shape says only "nullable, required where the reason is `OTHER`", and
   * migration 0009's `..._note_only_with_reason` permits a note beside any reason.
   * Nothing refused it either, so the sentence was false of the code as well as of the
   * specification.*
   *
   * **The `|| note !== undefined` disjunct is what makes the bounds apply at all**, and
   * dropping it is how the sentence came to be false. `@ValidateIf` gates the
   * *validators* on a property, so with the condition on the reason alone the minimum
   * and the 500-character maximum were inert for four of the five reasons and a
   * 5,000-character note was accepted. That is `CloseCellDto.note`'s shape, and this is
   * the half of it that was reused without its reason being re-derived (section 25 rule
   * 19).
   *
   * *An earlier version of this said the **trim** was inert too, and that the note was
   * "stored untrimmed". It was not: `@Transform` is a `class-transformer` decorator and
   * `ValidationPipe` runs `plainToInstance` before `validate`, so the transform runs
   * whatever `@ValidateIf` decides — as `CloseCellDto.note` says twenty lines below, in
   * this same file. Reproduced: the 5,000-character note was stored **trimmed**. The
   * defect was the missing bound and not the missing trim, and the wrong reason travelled
   * into `CLAUDE.md`, a commit message and a test comment.*
   *
   * **Trimmed, then required to be non-empty**, because the database compares
   * `btrim(coalesce(note, '')) <> ''` — `@MinLength(1)` alone accepts two spaces and
   * turns a documented refusal into a constraint violation rendered `INTERNAL_ERROR`.
   *
   * **An explicit `null` is refused, and that is a decision rather than a side effect.**
   * `null !== undefined`, so it satisfies the condition above and then fails `@IsString`.
   * Omitting the field is how a decline carries no note; sending `null` says something
   * this endpoint does not define, and the conservative direction is taken deliberately
   * — the 2026-08-24 ruling on an explicit null birthday is the precedent, and its point
   * is that a nullable column must not become a capability nobody decided on. Verified
   * against the installed `class-validator` rather than assumed.
   */
  @ValidateIf(
    (dto: DeclineLeadershipRequestDto) => dto.reason === 'OTHER' || dto.note !== undefined,
  )
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(500)
  note?: string;
}

/**
 * `POST /api/v1/cells/leadership-requests/{request_id}/approve` (SKILL.md section 10).
 *
 * **Empty, and declared rather than omitted.** An approval carries no fields: section
 * 10 says everything takes effect at approval and that "nothing about a request is
 * backdated to when it was made", so there is no effective date to send; the category,
 * day and time a `NEW_CELL` asks for are already on the request row, and a handover
 * names its Cell there.
 *
 * The class exists so that `forbidNonWhitelisted` refuses a body carrying anything at
 * all. Without a DTO the extra property is silently dropped, and a client sending
 * `effective_date` would be answered 200 by a server that ignored it — which is the
 * shape section 10's "everything takes effect at approval" most invites somebody to
 * try. Refusing says so.
 */
export class ApproveLeadershipRequestDto {}

/**
 * `POST /api/v1/cells/{id}/members` (SKILL.md section 10).
 *
 * One field: a person has at most one active membership, so adding somebody who
 * already belongs elsewhere *is* the move section 10 describes. There is no
 * "source" to name, and no effective date to send — a membership change takes
 * effect when it is made, and backdating one is `records.backdate_effective_date`
 * territory that section 10 does not open.
 */
export class AddCellMemberDto {
  @IsUUID()
  person_id!: string;
}

/**
 * `PUT /api/v1/cells/{id}/category` (SKILL.md section 10, *Category changes*).
 *
 * The validators are the same three the creation DTO carries for this field, and
 * that repetition is deliberate rather than a missed abstraction: a shared base
 * class would couple two request shapes that section 10 governs with different
 * rules, and the one thing they must not share is the effective date.
 */
export class ChangeCellCategoryDto {
  @IsIn(CATEGORIES)
  category!: CellCategory;
}

/**
 * `PUT /api/v1/cells/{id}/schedule` (SKILL.md section 10, *Schedule changes*).
 *
 * Day and time move together. Section 10 treats the schedule as one thing — "the
 * Cell's standing day and time" — and `cell_schedules` carries both on one
 * effective-dated row, so accepting one without the other would mean reading the
 * current row to fill the gap and recording a change to a field nobody sent.
 */
export class ChangeCellScheduleDto {
  /**
   * ISO 8601 day number: 1 is Monday, 7 is Sunday (section 20).
   *
   * Validated here as well as in the database so a bad value is
   * `VALIDATION_FAILED` rather than a constraint violation.
   */
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week!: number;

  /** Wall-clock time in Asia/Manila, with no offset of its own (section 20). */
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'time_of_day must be HH:MM or HH:MM:SS, in Asia/Manila wall-clock time',
  })
  time_of_day!: string;
}

/**
 * One member of a closing Cell, and what the closer decided about them
 * (SKILL.md section 10, *What closing does*).
 */
export class CellClosureMemberDto {
  @IsUUID()
  person_id!: string;

  /**
   * The Cell to move them to, or `null` to leave them in none.
   *
   * **Required, and `null` is a decision rather than an omission.** Section 10:
   * members "must be dealt with explicitly rather than silently… Closure is not
   * blocked on reassigning them, but it must not complete without the decision being
   * made and recorded." An optional field would let a client leave somebody
   * unassigned by forgetting them, which is exactly what that sentence forbids —
   * and people left without a Cell go to section 15's attention list, which is a
   * queue somebody has to work rather than a place to lose them.
   */
  @ValidateIf((decision: CellClosureMemberDto) => decision.destination_cell_id !== null)
  @IsUUID()
  destination_cell_id!: string | null;
}

/**
 * `POST /api/v1/cells/{id}/closure` (SKILL.md section 10, *What closing does*).
 *
 * **`members` names every current member, and the server refuses the closure if it
 * does not.** It is not an optional convenience: it is the recorded decision section
 * 10 requires, and it is also what the operation locks people by, so a list that has
 * gone stale is a list that locked the wrong people. The refusal asks for the
 * membership to be re-read, which is section 14's rule that a conflict is resolved by
 * a person rather than by last-write-wins.
 */
export class CloseCellDto {
  @IsIn(CLOSURE_REASONS)
  reason!: CellClosureReason;

  /**
   * Required where the reason is `OTHER` or the closure is backdated; optional
   * otherwise.
   *
   * **The decorators are what enforce the first half, and an earlier version of this
   * block claimed the enforcement while carrying only `@IsOptional()`.** A closure
   * reasoned `OTHER` with no note then fell through to `cells_other_requires_note`,
   * which nothing classifies, so it answered `INTERNAL_ERROR` — the
   * 500-instead-of-an-answer failure this repository keeps recording, produced by a
   * docblock rather than by the code beneath it.
   *
   * `@ValidateIf` rather than `@IsOptional()`, because the two differ on exactly the
   * case that matters: `@IsOptional()` skips validation for null as well as
   * undefined, which is how a nullable column once became an erase capability nobody
   * decided on (section 3, the 2026-08-24 birthday ruling).
   *
   * The backdating half is a service check rather than a decorator: it depends on the
   * effective date resolving to a Manila day earlier than today, which is a fact about
   * the clock rather than about the payload.
   *
   * A note is permitted with any reason — `cells_note_only_with_reason` allows it, and
   * a closure legitimately carries a sentence of context. Section 10 keeps the *reason*
   * list closed and free of judgement (Principle 7); the note qualifies it.
   */
  @ValidateIf((closure: CloseCellDto) => closure.reason === 'OTHER' || closure.note !== undefined)
  @IsString()
  @MaxLength(500)
  // **Trimmed, then required to be non-empty.** `@MinLength(1)` alone accepts `"  "`,
  // which `cells_other_requires_note` does not — it compares `btrim(...) <> ''` — so a
  // whitespace note reached the `UPDATE cells` and answered `INTERNAL_ERROR`, which is
  // the failure this validation exists to remove, half-closed. It also satisfied the
  // backdating rule below, so a backdated closure could carry a blank explanation and
  // still write `effective_date.backdated` with a whitespace reason.
  //
  // The transform runs before the validators, so `@MinLength` sees the trimmed value
  // and what is stored is what was checked.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  note?: string;

  /**
   * Asia/Manila calendar day, `YYYY-MM-DD` (section 22).
   *
   * Omitted, the closure takes effect now. Supplied, it must clear the floor the Cell's
   * own leadership and membership records set — and where it is earlier than the
   * current Manila day it is backdating, which requires
   * `records.backdate_effective_date` and a note (section 10).
   *
   * **Today's date is not backdating**, though it resolves to Manila midnight and so
   * is hours behind an undated closure. Section 10 makes the test the *day*, and the
   * harm it guards is a closure reaching back to the first of the month.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effective_date must be an Asia/Manila calendar day, YYYY-MM-DD',
  })
  effective_date?: string;

  /**
   * **Bounded, because it is the only unbounded list any request in this API
   * carries.** Every entry becomes an advisory lock, one audit entry, and — for one
   * naming a destination — a share of that Cell's row lock, which `lockCellsWithin`
   * folds to one per Cell however many members name it. *An earlier version said "two
   * audit entries" and "a `cells` row lock" per entry; both were wrong, and both
   * overstated the cost this bound is set against.*
   *
   * Five hundred is far above any real Cell — section 2 puts the church at roughly 800
   * Cells across three to four thousand people — and far below what would hold a
   * transaction open long enough to matter to section 24's pool. Section 22 carries
   * the number and the code, because a bound a client cannot discover is one it meets
   * as an unexplained refusal.
   */
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CellClosureMemberDto)
  members!: CellClosureMemberDto[];
}

/**
 * `GET /api/v1/cells/{id}/members` (SKILL.md section 22, *Pagination*).
 *
 * **`limit` is bound because section 22 makes pagination cursor-based on *every*
 * collection endpoint**, and an envelope that answers `next_cursor: null` over a list
 * it silently truncated reads as "this is the last page". A first version returned the
 * envelope and bound no parameter, which is that shape with the truncation still to
 * come.
 *
 * `next_cursor` is null for every Cell this church has, which is a fact about the data
 * rather than a simplification: a Cell's membership is what one leader can pastor, so
 * the default page holds every member of any Cell here. Where it does not — a Cell over
 * the limit — the answer says so by returning `limit` rows and a cursor, rather than by
 * returning everything.
 *
 * *An earlier version of this block said `next_cursor` "is still always null" four
 * lines above describing the case that returns one, and beside code that returns one.
 * It described the version before the pagination, in the commit that added it.*
 */
export class CellMembersDto {
  /** Section 22: defaults to 50, maximum 200. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /**
   * The `next_cursor` of the previous page, passed back unmodified.
   *
   * Opaque, as section 22 requires: base64url of the three ordering keys the read
   * service fixes — last name, first name, Member ID. A keyset rather than an offset,
   * which section 22 forbids because a member added while a client pages would shift
   * every subsequent page by one.
   *
   * *This said "the `person_id` the previous page ended on", which named neither the
   * field the code emits nor the field it consumes — both are the Member ID at the
   * time, and both are the whole key now. A client following the docblock would have
   * sent a UUID and been answered a silent empty page reading as "last page".*
   */
  @IsOptional()
  @IsString()
  // `Length` rather than `MaxLength`, so `?cursor=` is refused exactly as
  // `GET /api/v1/people` refuses it — the consistency this endpoint's treat-as-absent
  // behaviour is argued from, which held for the decoder and not for the validation in
  // front of it. The maximum is explained in `common/cursor.ts`; the 200 it replaces was
  // sized for a cursor that carried a Member ID and nothing else.
  @Length(1, CURSOR_MAX_LENGTH)
  cursor?: string;
}
