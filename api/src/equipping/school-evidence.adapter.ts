import { Injectable } from '@nestjs/common';
import { type Transaction } from 'kysely';

import { lifeClassFiledOf } from './life-class-from-school';

import type { Database } from '../database/schema';
import type { SchoolEvidence, SchoolEvidencePort } from '../training/school-evidence.port';

/**
 * `equipping`'s answer to what the school recorded for a person (decision 0509, point 8), behind
 * `training`'s `SCHOOL_EVIDENCE_PORT`. The kinds of record the school files from, as they stand
 * now (a grade posted while the student was archived, when the school filed nothing, counts too,
 * the ruling's words being that the school has passed them):
 *
 * - **the Encounter**: a current record of having come, dated that weekend;
 * - **Life Class**: what the school's Life Class stands filed under for each posted grade
 *   (`lifeClassFiledOf`): the day a grade became *Passed*, at posting or by a change after it
 *   (decision 0513), or the weekend a posted *Not yet* passed at; nothing for a pass changed away.
 */
@Injectable()
export class SchoolEvidenceAdapter implements SchoolEvidencePort {
  async evidenceWithin(
    trx: Transaction<Database>,
    personIds: readonly string[],
    program: 'ENCOUNTER' | 'LIFE_CLASS',
  ): Promise<SchoolEvidence[]> {
    if (personIds.length === 0) {
      return [];
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
}
