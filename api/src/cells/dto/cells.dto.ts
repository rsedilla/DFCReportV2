import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Max, Min, ValidateIf } from 'class-validator';

import type { CellCategory, CellClosureReason } from '../../database/schema';

const CATEGORIES: CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];

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
  @MinLength(1)
  note?: string;

  /**
   * Asia/Manila calendar day, `YYYY-MM-DD` (section 22).
   *
   * Omitted, the closure takes effect now. Supplied, it requires
   * `records.backdate_effective_date` (section 10) and must clear the floor the
   * Cell's own leadership and membership records set.
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
