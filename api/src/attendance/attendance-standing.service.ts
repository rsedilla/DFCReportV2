import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { canonicalId, sameId } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { PeopleReadService } from '../people/people.read.service';

/** One person's attendance so far, for section 29's registration requirements. */
export interface AttendanceStanding {
  /** DCC Sundays attended: present, live, and not on a removed Sunday (section 9). */
  dccAttended: number;
  /** Cell meetings attended: present, live, at a meeting held or rescheduled (section 12). */
  cellAttended: number;
  /** The day of the last Cell meeting attended, its actual day where it moved. */
  lastCellMeetingOn: string | null;
}

/**
 * How much each person has attended so far, DCC and Cell, for the requirements a Life Class
 * registration reads (SKILL.md section 29, decision 0499).
 *
 * **The counts are the lifetime counts sections 9 and 12 classify by**, taken over the records
 * standing now: the same rules `DccPersonAttendanceService` and `CellFiguresService` apply, so a
 * person reads as Regular here exactly when their page and their monthly figures say so. No
 * record can exist for a day that has not begun, so counting every live record is the count so
 * far.
 *
 * **A record kept counts the records merged into it** (decision 0408): one count per person,
 * and a Sunday or a meeting attended on both records counts once.
 *
 * Here rather than in `equipping`, because these are `attendance`'s tables (section 2).
 */
@Injectable()
export class AttendanceStandingService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly people: PeopleReadService,
  ) {}

  async standingOf(personIds: readonly string[]): Promise<Map<string, AttendanceStanding>> {
    const standing = new Map<string, AttendanceStanding>();
    if (personIds.length === 0) {
      return standing;
    }

    const pairs = await this.people.mergedPairsWithin(this.db);
    const owners: string[] = [];
    const records: string[] = [];
    for (const id of new Set(personIds.map((each) => canonicalId(each)))) {
      owners.push(id);
      records.push(id);
      pairs.absorbed.forEach((absorbed, index) => {
        if (sameId(pairs.kept[index], id)) {
          owners.push(id);
          records.push(absorbed);
        }
      });
      standing.set(id, { dccAttended: 0, cellAttended: 0, lastCellMeetingOn: null });
    }

    const dcc = await sql<{ owner: string; attended: number }>`
      WITH records AS (
        SELECT * FROM unnest(${owners}::uuid[], ${records}::uuid[]) AS r(owner, record)
      )
      SELECT r.owner, count(DISTINCT a.dcc_event_id)::int AS attended
        FROM records r
        JOIN dcc_attendance a ON a.person_id = r.record
        JOIN dcc_events e ON e.id = a.dcc_event_id
       WHERE a.present
         AND a.superseded_at IS NULL
         AND e.removed_at IS NULL
       GROUP BY r.owner
    `.execute(this.db);

    const cell = await sql<{ owner: string; attended: number; last_on: string | null }>`
      WITH records AS (
        SELECT * FROM unnest(${owners}::uuid[], ${records}::uuid[]) AS r(owner, record)
      )
      SELECT r.owner,
             count(DISTINCT a.cell_meeting_id)::int AS attended,
             to_char(max(coalesce(m.actual_date, m.scheduled_date)), 'YYYY-MM-DD') AS last_on
        FROM records r
        JOIN cell_attendance a ON a.person_id = r.record
        JOIN cell_meetings m ON m.id = a.cell_meeting_id
       WHERE a.present
         AND a.superseded_at IS NULL
         AND m.status IN ('HELD', 'RESCHEDULED')
       GROUP BY r.owner
    `.execute(this.db);

    for (const row of dcc.rows) {
      standing.get(canonicalId(row.owner))!.dccAttended = row.attended;
    }
    for (const row of cell.rows) {
      const entry = standing.get(canonicalId(row.owner))!;
      entry.cellAttended = row.attended;
      entry.lastCellMeetingOn = row.last_on;
    }
    return standing;
  }
}
