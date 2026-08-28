import { IsIn, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

import type { CellCategory } from '../../database/schema';

const CATEGORIES: CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];

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
