import { sql } from 'kysely';

import type { CellCategory, Database } from '../database/schema';
import type { Transaction } from 'kysely';

export interface NewCellInput {
  cellLeaderId: string;
  category: CellCategory;
  /** ISO 8601: 1 is Monday, 7 is Sunday (SKILL.md section 20). */
  dayOfWeek: number;
  /** Wall-clock time in Asia/Manila, `HH:MM` or `HH:MM:SS`. */
  timeOfDay: string;
}

export interface NewCell {
  id: string;
  cellId: string;
  timeOfDay: string;
  createdAt: Date;
}

/**
 * The Cell, its category row, its schedule row and its leadership assignment
 * (SKILL.md section 10, *Creating a Cell*).
 *
 * **One statement, and section 10 requires it to be.** The schedule row starts at the
 * Cell's `created_at` — a Cell created part-way through a month opens its first
 * schedule row at creation rather than on a first of month — and equality with a
 * column on another table is exact: `created_at DEFAULT now()` beside an
 * application-computed timestamp differs by microseconds and aborts every creation,
 * "with a failure that reads as a clock problem rather than as a rule". Taking the
 * value from the same expression is what section 10 prescribes, and migration 0009's
 * schedule trigger is what refuses anything else.
 *
 * Migration 0009 refuses each half of a partly-built Cell independently: an `ACTIVE`
 * Cell has exactly one leadership assignment, an open category row and an open
 * schedule row. Those are deferred constraint triggers, so they see the state the
 * transaction ends in rather than the order these rows arrive in.
 *
 * **Shared by both paths that create a Cell**, which is why it is a function here
 * rather than a private method on either. Section 2 relaxes creation to Admin during
 * initial encoding (`CellsService.createDirectly`) and section 10 makes approval of a
 * `NEW_CELL` request the only other one (`CellsLeadershipRequestService.approve`).
 * Two copies of a statement whose whole point is that four rows share one instant is
 * two copies free to drift on exactly the property that matters.
 *
 * It deliberately writes no audit entry and takes no idempotency claim. Those differ
 * between the two callers — section 21 names a separate action for a Cell "created
 * directly by Admin during initial encoding" — and folding them in would make this
 * the thing it exists not to be: a second place where a creation is defined.
 */
export async function insertCellWithin(
  trx: Transaction<Database>,
  input: NewCellInput,
  actorId: string,
): Promise<NewCell> {
  const result = await sql<{
    id: string;
    cell_id: string;
    time_of_day: string;
    created_at: Date;
  }>`
      WITH new_cell AS (
        INSERT INTO cells DEFAULT VALUES
        RETURNING id, cell_id, created_at
      ), category AS (
        INSERT INTO cell_categories (cell_id, category, actor_id, started_at)
        SELECT id, ${input.category}::cell_category, ${actorId}::uuid, created_at FROM new_cell
      ), schedule AS (
        INSERT INTO cell_schedules (cell_id, day_of_week, time_of_day, actor_id, started_at)
        SELECT id, ${input.dayOfWeek}::smallint, ${input.timeOfDay}::time, ${actorId}::uuid, created_at
          FROM new_cell
      ), leadership AS (
        INSERT INTO cell_leaderships (person_id, cell_id, started_at)
        SELECT ${input.cellLeaderId}::uuid, id, created_at FROM new_cell
      )
      SELECT nc.id, nc.cell_id, ${input.timeOfDay}::time::text AS time_of_day, nc.created_at
        FROM new_cell nc
    `.execute(trx);

  const row = result.rows[0];

  return {
    id: row.id,
    cellId: row.cell_id,
    timeOfDay: row.time_of_day,
    createdAt: row.created_at,
  };
}
