import { type Transaction } from 'kysely';

import type { Db } from '../database/database.module';
import type { Database, NetworkName } from '../database/schema';

/**
 * **What the school's Life Class stands filed under, for one posted grade** (decisions 0509 and
 * 0513): the instant whose Manila day dated it, or the weekend a posted *Not yet* passed at, or
 * nothing where the grade as it stands holds none.
 */
export type LifeClassFiled =
  | { kind: 'INSTANT'; at: Date }
  | { kind: 'WEEKEND'; seasonId: string; network: NetworkName }
  | null;

/**
 * Read in one place for the change that files or withdraws it and for the evidence Training asks
 * for (decision 0509, point 8), so the two never disagree about the date (decision 0513):
 *
 * - passed at a later Encounter after the last change, or with none: that weekend, the record of
 *   having come written in the same transaction as `passed_later_at`;
 * - else, after a change: what the latest change recorded (`life_class_filed_at`, or the weekend);
 * - else, posted *Passed*: the posting's instant.
 */
export async function lifeClassFiledOf(
  executor: Db | Transaction<Database>,
  where: { finalGradeIds: readonly string[] } | { personIds: readonly string[] },
): Promise<{ finalGradeId: string; personId: string; filed: LifeClassFiled }[]> {
  const ids = 'finalGradeIds' in where ? where.finalGradeIds : where.personIds;
  if (ids.length === 0) {
    return [];
  }
  const rows = await executor
    .selectFrom('equipping_current_grades as c')
    .innerJoin('equipping_final_grades as g', 'g.id', 'c.final_grade_id')
    .innerJoin('equipping_class_postings as p', 'p.id', 'c.posting_id')
    .innerJoin('equipping_enrollments as n', 'n.id', 'c.enrollment_id')
    .innerJoin('equipping_registrations as r', 'r.id', 'n.registration_id')
    .select([
      'c.final_grade_id',
      'r.person_id',
      'g.grade as posted_grade',
      'p.posted_at',
      'g.passed_later_at',
      'c.changes',
      'c.changed_at',
      'c.life_class_filed_at',
      'c.life_class_weekend',
    ])
    .where('finalGradeIds' in where ? 'c.final_grade_id' : 'r.person_id', 'in', [...ids])
    // A Life Class grade, never another level's (decision 0514).
    .where('r.level', '=', 'LIFE_CLASS')
    .execute();
  // The weekend a posted Not yet passed at: the record of having come written in the same
  // transaction as `passed_later_at`, which `now()` makes the same instant.
  const passedLater = rows.filter((row) => row.passed_later_at !== null);
  const attended =
    passedLater.length === 0
      ? []
      : await executor
          .selectFrom('equipping_encounter_attendance as a')
          .innerJoin('equipping_encounter_enrollments as e', 'e.id', 'a.encounter_enrollment_id')
          .select(['a.recorded_at', 'e.person_id', 'e.encounter_season_id', 'e.network'])
          .where('a.came', '=', true)
          .where('a.superseded_at', 'is', null)
          .where(
            'e.person_id',
            'in',
            passedLater.map((row) => row.person_id),
          )
          .execute();
  const weekendOf = (row: (typeof rows)[number]): LifeClassFiled => {
    const hit = attended.find(
      (each) =>
        each.person_id === row.person_id &&
        row.passed_later_at !== null &&
        new Date(each.recorded_at).getTime() === new Date(row.passed_later_at).getTime(),
    );
    return hit === undefined
      ? null
      : { kind: 'WEEKEND', seasonId: hit.encounter_season_id, network: hit.network };
  };
  return rows.map((row) => {
    const weekend = weekendOf(row);
    let filed: LifeClassFiled = null;
    if (
      row.passed_later_at !== null &&
      (row.changes === 0 || row.changed_at === null || row.passed_later_at > row.changed_at)
    ) {
      filed = weekend;
    } else if (row.changes > 0) {
      filed =
        row.life_class_filed_at !== null
          ? { kind: 'INSTANT', at: row.life_class_filed_at }
          : row.life_class_weekend
            ? weekend
            : null;
    } else if (row.posted_grade === 'PASSED') {
      filed = { kind: 'INSTANT', at: row.posted_at };
    }
    return { finalGradeId: row.final_grade_id, personId: row.person_id, filed };
  });
}
