import { Injectable } from '@nestjs/common';
import { type Kysely, type Transaction } from 'kysely';

import { lifeClassFiledOf } from './life-class-from-school';
import { shareSolOpeningWithin } from './sol-opening';

import type { Database } from '../database/schema';
import type {
  SchoolEvidence,
  SchoolEvidencePort,
  SchoolProgram,
  SolLevel,
} from '../training/school-evidence.port';

/**
 * `equipping`'s answer to what the school recorded for a person (decision 0509, point 8), behind
 * `training`'s `SCHOOL_EVIDENCE_PORT`. The kinds of record the school files from, as they stand
 * now (a grade posted while the student was archived, when the school filed nothing, counts too,
 * the ruling's words being that the school has passed them):
 *
 * - **the Encounter**: a current record of having come, dated that weekend;
 * - **Life Class**: what the school's Life Class stands filed under for each posted grade
 *   (`lifeClassFiledOf`): the day a grade became *Passed*, at posting or by a change after it
 *   (decision 0513), or the weekend a posted *Not yet* passed at; nothing for a pass changed away;
 * - **SOL 1 to 3**: a *Passed* in a class of that level, dated the day it was posted, or the day a
 *   change after posting made it so (decision 0514, points 12 and 13; decisions 0516 and 0517).
 *   SOL has no *Not yet*.
 */
@Injectable()
export class SchoolEvidenceAdapter implements SchoolEvidencePort {
  async evidenceWithin(
    trx: Transaction<Database>,
    personIds: readonly string[],
    program: SchoolProgram,
  ): Promise<SchoolEvidence[]> {
    if (personIds.length === 0) {
      return [];
    }

    if (program === 'SOL_1' || program === 'SOL_2' || program === 'SOL_3') {
      const passed = await trx
        .selectFrom('equipping_current_grades as g')
        .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
        .innerJoin('equipping_classes as c', 'c.id', 'p.class_id')
        .innerJoin('equipping_enrollments as e', 'e.id', 'g.enrollment_id')
        .innerJoin('equipping_registrations as r', 'r.id', 'e.registration_id')
        .select(['p.posted_at', 'g.life_class_filed_at'])
        .where('c.level', '=', program)
        .where('g.grade', '=', 'PASSED')
        .where('r.person_id', 'in', [...personIds])
        .execute();
      // A Passed reached by a change after posting is dated by that change (decision 0514, point 12).
      return passed.map((row) => ({
        kind: 'POSTED',
        postedAt: row.life_class_filed_at ?? row.posted_at,
      }));
    }

    if (program === 'ENCOUNTER') {
      const came = await trx
        .selectFrom('equipping_encounter_attendance as a')
        .innerJoin('equipping_encounter_enrollments as e', 'e.id', 'a.encounter_enrollment_id')
        .select(['e.encounter_season_id', 'e.network'])
        .where('e.person_id', 'in', [...personIds])
        .where('a.came', '=', true)
        .where('a.superseded_at', 'is', null)
        .execute();
      return came.map((row) => ({
        kind: 'WEEKEND',
        seasonId: row.encounter_season_id,
        network: row.network,
      }));
    }

    // **What the school's Life Class stands filed under, grade by grade** (decision 0513): read
    // where a change files and withdraws it, so the evidence and the withdrawal name one date. A
    // pass changed away since names none.
    const filed = await lifeClassFiledOf(trx, { personIds });
    return filed.flatMap(({ filed: each }): SchoolEvidence[] =>
      each === null
        ? []
        : each.kind === 'INSTANT'
          ? [{ kind: 'POSTED', postedAt: each.at }]
          : [{ kind: 'WEEKEND', seasonId: each.seasonId, network: each.network }],
    );
  }

  async shareSolOpeningWithin(trx: Transaction<Database>): Promise<void> {
    await shareSolOpeningWithin(trx);
  }

  async solLevelsRun(
    executor: Kysely<Database> | Transaction<Database>,
  ): Promise<ReadonlySet<SolLevel>> {
    const open = await executor
      .selectFrom('equipping_classes')
      .select('level')
      .distinct()
      .where('level', 'in', ['SOL_1', 'SOL_2', 'SOL_3'])
      .where('cancelled_at', 'is', null)
      .execute();
    return new Set(open.map((row) => row.level as SolLevel));
  }
}
