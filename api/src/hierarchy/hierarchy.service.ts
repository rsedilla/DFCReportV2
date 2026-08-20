import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { InvariantViolationError } from '../common/errors/api-error';
import { DATABASE, type Db } from '../database/database.module';

/**
 * The `hierarchy` module: pastoral assignments, subtree resolution, and the
 * section 5 invariants. It is the only writer of `pastoral_assignments`, which is
 * what gives those invariants exactly one place to live (SKILL.md section 2,
 * Modules).
 *
 * Every query here walks the tree, and every one of them carries its own cycle
 * detection. Section 5 is explicit that this is a correctness requirement rather
 * than a performance preference: a cycle introduced by a migration, by direct SQL,
 * or by a defect must surface as an error rather than as a query that never
 * returns. PostgreSQL 16 is the minimum version precisely so the CYCLE clause is
 * available and the visited-path fallback is never written by hand.
 */
@Injectable()
export class HierarchyService {
  constructor(@Inject(DATABASE) private readonly db: Db) {}

  /**
   * The person's leaders, nearest first. A Network root returns an empty list:
   * they have no leader above them, and that is the intended state rather than
   * missing data (section 5, Network roots).
   */
  async ancestorsOf(personId: string): Promise<string[]> {
    const result = await sql<{ leader_id: string | null; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE upline AS (
        SELECT pa.person_id, pa.leader_id, 1 AS depth
          FROM pastoral_assignments pa
         WHERE pa.person_id = ${personId}::uuid
           AND pa.ended_at IS NULL
        UNION ALL
        SELECT pa.person_id, pa.leader_id, u.depth + 1
          FROM pastoral_assignments pa
          JOIN upline u ON pa.person_id = u.leader_id
         WHERE pa.ended_at IS NULL
      ) CYCLE person_id SET is_cycle USING path
      SELECT leader_id, depth, is_cycle FROM upline ORDER BY depth
    `.execute(this.db);

    this.rejectCycle(result.rows, personId);

    return result.rows
      .map((row) => row.leader_id)
      .filter((leaderId): leaderId is string => leaderId !== null);
  }

  /**
   * Everyone recursively below the person, the person included at depth 0.
   *
   * Direct leaders and descendants are different things and are never conflated
   * (section 5, Direct leaders vs descendants); this is the second of the two.
   */
  async subtreeOf(personId: string): Promise<string[]> {
    const result = await sql<{ person_id: string; depth: number; is_cycle: boolean }>`
      WITH RECURSIVE subtree AS (
        SELECT ${personId}::uuid AS person_id, 0 AS depth
        UNION ALL
        SELECT pa.person_id, s.depth + 1
          FROM pastoral_assignments pa
          JOIN subtree s ON pa.leader_id = s.person_id
         WHERE pa.ended_at IS NULL
      ) CYCLE person_id SET is_cycle USING path
      SELECT person_id, depth, is_cycle FROM subtree ORDER BY depth
    `.execute(this.db);

    this.rejectCycle(result.rows, personId);

    return result.rows.map((row) => row.person_id);
  }

  /** The immediate children of a leader, whether or not they qualify as leaders. */
  async directChildrenOf(personId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('pastoral_assignments')
      .select('person_id')
      .where('leader_id', '=', personId)
      .where('ended_at', 'is', null)
      .execute();

    return rows.map((row) => row.person_id);
  }

  /**
   * Whether `personId` falls inside `rootPersonId`'s subtree.
   *
   * Walks up from the target rather than materializing the root's subtree: the
   * answer is the same, and the walk is bounded by the depth of the tree rather
   * than by the size of a branch.
   */
  async isWithinSubtree(
    rootPersonId: string,
    personId: string,
    options: { includeSelf: boolean },
  ): Promise<boolean> {
    if (rootPersonId === personId) {
      return options.includeSelf;
    }

    const ancestors = await this.ancestorsOf(personId);
    return ancestors.includes(rootPersonId);
  }

  private rejectCycle(rows: readonly { is_cycle: boolean }[], personId: string): void {
    if (rows.some((row) => row.is_cycle)) {
      throw new InvariantViolationError(
        'The pastoral tree contains a cycle and cannot be resolved. This is a data defect: report it rather than retrying.',
        { person_id: personId },
      );
    }
  }
}
