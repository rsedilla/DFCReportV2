import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { NotFoundError } from '../common/errors/api-error';
import { NIL_UUID } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

import {
  decodeDccPersonAttendanceCursor,
  encodeDccPersonAttendanceCursor,
} from './dcc-person-attendance-cursor';

/** Section 9's DCC classification, as the API names it. */
export type DccClassification = 'VIP' | '2ND_TIMER' | '3RD_TIMER' | '4TH_TIMER' | 'REGULAR';

/**
 * Section 9's ladder: first attendance a VIP, fifth and beyond a Regular. None before the
 * first, because a person who has attended nothing has no classification.
 */
export function dccClassificationFor(attended: number): DccClassification | null {
  switch (attended) {
    case 0:
      return null;
    case 1:
      return 'VIP';
    case 2:
      return '2ND_TIMER';
    case 3:
      return '3RD_TIMER';
    case 4:
      return '4TH_TIMER';
    default:
      return 'REGULAR';
  }
}

/** Section 22: `limit` defaults to 50. The DTO bounds it at 200. */
const DEFAULT_PAGE = 50;

interface PersonAttendanceRow {
  attended: number;
  rows: { event_id: string; event_date: string; present: boolean; removed: boolean }[];
}

/**
 * One person's DCC attendance and the classification it gives (SKILL.md section 9;
 * decision 0247).
 *
 * **Scope is decided before this runs.** The route declares `dcc.view_subtree` against the
 * person, so the guard has already refused anybody the actor does not hold in scope today.
 * What is left here is whether the person exists and what their records say.
 */
@Injectable()
export class DccPersonAttendanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
  ) {}

  /**
   * `GET /api/v1/dcc/people/{id}/attendance`.
   *
   * **The records are every live record**, newest event first, including one on a Sunday
   * that was later removed: section 9 keeps the removed event and the attendance on it, and
   * the row carries `removed` so the list says why that Present does not count.
   *
   * **The count is taken over this person's own records**, by the rule the monthly figures
   * apply in `DccFiguresService`: present, live, and not on a removed Sunday. Those figures
   * cannot be reused for it, because they cover only people who attended in the month asked
   * for. No record can exist for a Sunday that has not begun, so counting every record
   * standing now is the lifetime count so far.
   *
   * **One statement, so the page and the count come from one snapshot.** The application
   * runs at `READ COMMITTED` (section 24), where two statements can each see a different
   * committed state, and a count that disagreed with the list beside it would be the kind
   * of figure section 9's ladder exists to make explainable.
   */
  async forPerson(
    personId: string,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<Record<string, unknown>> {
    const person = await this.people.findById(personId);
    if (!person) {
      throw new NotFoundError('No such person.');
    }

    const after = decodeDccPersonAttendanceCursor(page.cursor);
    const limit = page.limit ?? DEFAULT_PAGE;

    const result = await sql<PersonAttendanceRow>`
      WITH live AS (
        SELECT a.dcc_event_id AS event_id,
               e.event_date,
               a.present,
               e.removed_at IS NOT NULL AS removed
          FROM dcc_attendance a
          JOIN dcc_events e ON e.id = a.dcc_event_id
         WHERE a.person_id = ${person.id}
           AND a.superseded_at IS NULL
      ),
      page AS (
        SELECT live.event_id,
               to_char(live.event_date, 'YYYY-MM-DD') AS event_date,
               live.present,
               live.removed
          FROM live
         WHERE ${after === null}
            OR (live.event_date, live.event_id)
               < (${after?.eventDate ?? '1970-01-01'}::date, ${after?.eventId ?? NIL_UUID}::uuid)
         ORDER BY live.event_date DESC, live.event_id DESC
         LIMIT ${limit + 1}
      )
      SELECT (SELECT count(*) FROM live WHERE live.present AND NOT live.removed)::int AS attended,
             coalesce(
               (SELECT json_agg(page ORDER BY page.event_date DESC, page.event_id DESC) FROM page),
               '[]'::json
             ) AS rows
    `.execute(this.db);

    const { attended, rows } = result.rows[0];
    const more = rows.length > limit;
    const window = rows.slice(0, limit);
    const last = window[window.length - 1];

    return {
      person_id: person.id,
      classification: dccClassificationFor(attended),
      attended,
      data: window.map((row) => ({
        event_id: row.event_id,
        event_date: row.event_date,
        present: row.present,
        removed: row.removed,
      })),
      next_cursor:
        more && last !== undefined
          ? encodeDccPersonAttendanceCursor({ eventDate: last.event_date, eventId: last.event_id })
          : null,
    };
  }
}
