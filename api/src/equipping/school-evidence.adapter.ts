import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';

import type { Database } from '../database/schema';
import type { SchoolEvidence, SchoolEvidencePort } from '../training/school-evidence.port';

/**
 * `equipping`'s answer to what the school recorded for a person (decision 0509, point 8), behind
 * `training`'s `SCHOOL_EVIDENCE_PORT`. The kinds of record the school files from, as they stand
 * now (a grade posted while the student was archived, when the school filed nothing, counts too,
 * the ruling's words being that the school has passed them):
 *
 * - **the Encounter**: a current record of having come, dated that weekend;
 * - **Life Class**: a posted *Passed*, dated the posting day, or a posted *Not yet* that passed
 *   later, dated the weekend it passed at. That weekend is the record of having come written in
 *   the same transaction as `passed_later_at`, which `now()` makes the same instant; it is kept,
 *   since correcting it to not attended is refused (point 4).
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

    const passed = await trx
      .selectFrom('equipping_final_grades as g')
      .innerJoin('equipping_class_postings as p', 'p.id', 'g.posting_id')
      .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
      .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
      .select('p.posted_at')
      .where('r.person_id', 'in', [...personIds])
      .where('g.grade', '=', 'PASSED')
      .execute();

    const passedLater = await trx
      .selectFrom('equipping_final_grades as g')
      .innerJoin('equipping_enrollments as n', 'n.id', 'g.enrollment_id')
      .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
      .innerJoin('equipping_encounter_enrollments as e', 'e.person_id', 'r.person_id')
      .innerJoin('equipping_encounter_attendance as a', (join) =>
        join
          .onRef('a.encounter_enrollment_id', '=', 'e.id')
          .on('a.came', '=', true)
          .on('a.superseded_at', 'is', null)
          .on(sql<boolean>`a.recorded_at = g.passed_later_at`),
      )
      .select(['e.encounter_season_id', 'e.network'])
      .where('r.person_id', 'in', [...personIds])
      .where('g.grade', '=', 'NOT_YET')
      .where('g.passed_later_at', 'is not', null)
      .execute();

    return [
      ...passed.map((row): SchoolEvidence => ({ kind: 'POSTED', postedAt: row.posted_at })),
      ...passedLater.map((row): SchoolEvidence => ({
        kind: 'WEEKEND',
        seasonId: row.encounter_season_id,
        network: row.network,
      })),
    ];
  }
}
