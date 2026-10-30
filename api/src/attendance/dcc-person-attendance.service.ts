import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import {
  AuthorizationService,
  holdsWholeChurch,
  type Actor,
} from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
import { NotFoundError } from '../common/errors/api-error';
import { NIL_UUID, sameId } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';
import { DccCoverageService } from './dcc-coverage.service';

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
  rows: {
    event_id: string;
    event_date: string;
    present: boolean;
    removed: boolean;
    responsible_leader_id: string | null;
  }[];
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
    private readonly authorization: AuthorizationService,
    private readonly coverage: DccCoverageService,
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
    actor?: Actor,
  ): Promise<Record<string, unknown>> {
    const person = await this.people.findById(personId);
    if (!person) {
      throw new NotFoundError('No such person.');
    }

    const after = decodeDccPersonAttendanceCursor(page.cursor);
    const limit = page.limit ?? DEFAULT_PAGE;

    // A record kept reads the Sundays of every record merged into it (decision 0408): one line
    // per Sunday, Present where either record was marked Present.
    const pairs = await this.people.mergedPairsWithin(this.db);
    const records = [
      person.id,
      ...pairs.absorbed.filter((_, index) => sameId(pairs.kept[index], person.id)),
    ];

    const result = await sql<PersonAttendanceRow>`
      WITH live AS (
        SELECT a.dcc_event_id AS event_id,
               e.event_date,
               bool_or(a.present) AS present,
               e.removed_at IS NOT NULL AS removed,
               (array_agg(a.responsible_leader_id))[1] AS responsible_leader_id
          FROM dcc_attendance a
          JOIN dcc_events e ON e.id = a.dcc_event_id
         WHERE a.person_id = ANY (${records}::uuid[])
           AND a.superseded_at IS NULL
         GROUP BY a.dcc_event_id, e.event_date, e.removed_at
      ),
      page AS (
        SELECT live.event_id,
               to_char(live.event_date, 'YYYY-MM-DD') AS event_date,
               live.present,
               live.removed,
               live.responsible_leader_id
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

    // **Whose checklist each Sunday is on, for the Admin alone** (decision 0411): an account
    // that may record on anybody's behalf church-wide is told, so a person's Sunday opens the
    // checklist it belongs to, where a closed week can be amended. Nobody else is told, so the
    // field discloses nothing a reader could not already reach.
    let owners: Map<string, string | null> | null = null;
    if (actor !== undefined) {
      const authority = await this.authorization.authorityFor(actor.accountId);
      if (
        holdsWholeChurch(authority, Capability.DccSubmitOnBehalf) &&
        holdsWholeChurch(authority, Capability.DccTakeAttendance)
      ) {
        owners = await this.coverage.checklistOwners(
          window.map((row) => ({
            eventId: row.event_id,
            eventDate: row.event_date,
            leaderId: row.responsible_leader_id,
          })),
        );
      }
    }

    return {
      person_id: person.id,
      classification: dccClassificationFor(attended),
      attended,
      data: window.map((row) => ({
        event_id: row.event_id,
        event_date: row.event_date,
        present: row.present,
        removed: row.removed,
        ...(owners === null ? {} : { checklist_of: owners.get(row.event_id) ?? null }),
      })),
      next_cursor:
        more && last !== undefined
          ? encodeDccPersonAttendanceCursor({ eventDate: last.event_date, eventId: last.event_id })
          : null,
    };
  }
}
