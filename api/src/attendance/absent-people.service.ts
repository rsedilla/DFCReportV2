import { Inject, Injectable } from '@nestjs/common';

import { AbsenceService, type MonthDays } from './absence.service';
import { CellsReadService } from '../cells/cells.read.service';
import { canonicalId } from '../common/identifiers';
import { manilaDayOf, startOfManilaDay } from '../common/time/manila';
import { databaseNow } from '../common/time/submission-window';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { PeopleReadService } from '../people/people.read.service';

import type { ScopeMembership } from '../auth/authorization/authorization.service';
import type { AbsentPeoplePort, AbsentPerson } from '../people/person-archive.ports';

type Cursor = { firstName: string; lastName: string; memberId: string };

/**
 * People's *Absent 3+ Months* list (SKILL.md section 19, decision 0397), composed here from
 * what each owning module computes (decision 0206), behind `people`'s `ABSENT_PEOPLE_PORT`:
 * `attendance` the marks, `cells` and `hierarchy` which months somebody was in a Cell or under
 * a leader for the whole of, `people` the lifecycle, the names and who is outside the tree.
 *
 * **The candidates come first and are few**: only somebody with an Absent mark in every one
 * of the three months and no Present mark is examined further, so the remaining reads are
 * over that set rather than over the church, and it is ordered and paged in memory.
 */
@Injectable()
export class AbsentPeopleService implements AbsentPeoplePort {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly absence: AbsenceService,
    private readonly cells: CellsReadService,
    private readonly hierarchy: HierarchyService,
    private readonly people: PeopleReadService,
  ) {}

  async absentPage(
    scope: ScopeMembership,
    limit: number,
    cursor: Cursor | null,
  ): Promise<{ months: string[]; rows: AbsentPerson[]; nextCursor: Cursor | null }> {
    const now = await databaseNow(this.db);
    const months = lastFinishedMonths(manilaDayOf(now), 3);
    const labels = months.map((month) => month.first.slice(0, 7));

    let candidates = await this.absence.absentEveryMonth(months);

    if (scope.kind === 'PERSONS') {
      const inScope = new Set([...scope.personIds].map((id) => canonicalId(id)));
      candidates = candidates.filter((id) => inScope.has(canonicalId(id)));
    }

    if (candidates.length === 0) {
      return { months: labels, rows: [], nextCursor: null };
    }

    const bounds = months.map((month, index) => ({
      from: startOfManilaDay(month.first),
      to: startOfManilaDay(
        index + 1 < months.length ? months[index + 1].first : nextFirst(month.first),
      ),
    }));

    const [decisions, outside, inACell, underALeader] = await Promise.all([
      this.people.forDecisions(candidates),
      this.people.outsideTreeAt(this.db, now),
      this.cells.monthsInACellWithin(this.db, candidates, bounds),
      this.hierarchy.monthsUnderALeaderWithin(this.db, candidates, bounds),
    ]);

    // Current, not merged, not outside the tree (decision 0339), and on a roster or a
    // checklist for the whole of every month, so nobody new is listed.
    const listed = candidates.filter((id) => {
      const person = decisions.get(id);
      if (person === undefined || person.isArchived || person.mergedIntoId !== null) {
        return false;
      }
      if (outside.has(id)) {
        return false;
      }
      return months.every(
        (_, index) =>
          inACell.get(id)?.has(index) === true || underALeader.get(id)?.has(index) === true,
      );
    });

    const names = await this.people.namesOf(listed);
    const ordered = listed
      .map((id) => ({ id, name: names.get(id) }))
      .filter(
        (row): row is { id: string; name: NonNullable<typeof row.name> } => row.name !== undefined,
      )
      .sort(
        (a, b) =>
          compare(a.name.firstName, b.name.firstName) ||
          compare(a.name.lastName, b.name.lastName) ||
          compare(a.name.memberId, b.name.memberId),
      )
      .filter(
        (row) =>
          cursor === null ||
          compare(row.name.firstName, cursor.firstName) > 0 ||
          (row.name.firstName === cursor.firstName &&
            (compare(row.name.lastName, cursor.lastName) > 0 ||
              (row.name.lastName === cursor.lastName &&
                compare(row.name.memberId, cursor.memberId) > 0))),
      );

    const page = ordered.slice(0, limit);
    const ids = page.map((row) => row.id);

    const [leaders, cellsOf, seen] = await Promise.all([
      this.people.directLeaderNamesOf(ids),
      this.cells.currentCellsOfMany(ids),
      this.absence.lastSeen(ids),
    ]);
    const leaderIds = await this.hierarchy.directLeaderIdsOf(ids);
    const cellIds = [...cellsOf.values()].flatMap((cells) => [
      ...(cells.membership === null ? [] : [cells.membership.id]),
      ...cells.leads.map((cell) => cell.id),
    ]);
    const headings = await this.cells.cellHeadingsWithin(this.db, [...new Set(cellIds)]);
    const heading = (cellId: string) => ({
      category: headings.get(cellId)?.category ?? null,
      day_of_week: headings.get(cellId)?.dayOfWeek ?? null,
    });

    const rows: AbsentPerson[] = page.map(({ id, name }) => {
      const cells = cellsOf.get(id) ?? { membership: null, leads: [] };
      const leaderId = leaderIds.get(id) ?? null;

      return {
        id,
        member_id: name.memberId,
        full_name: name.fullName,
        leader:
          leaderId === null ? null : { person_id: leaderId, full_name: leaders.get(id) ?? '' },
        cell:
          cells.membership === null
            ? null
            : {
                id: cells.membership.id,
                cell_id: cells.membership.cellId,
                ...heading(cells.membership.id),
              },
        leads: cells.leads.map((cell) => ({
          id: cell.id,
          cell_id: cell.cellId,
          ...heading(cell.id),
          members: headings.get(cell.id)?.memberCount ?? 0,
        })),
        last_at_cell: seen.cell.get(id) ?? null,
        last_at_dcc: seen.dcc.get(id) ?? null,
      };
    });

    const last = page[page.length - 1];

    return {
      months: labels,
      rows,
      nextCursor:
        ordered.length > limit && last !== undefined
          ? {
              firstName: last.name.firstName,
              lastName: last.name.lastName,
              memberId: last.name.memberId,
            }
          : null,
    };
  }
}

/** Code-point order, as PostgreSQL's `C` collation and the other name-ordered lists compare. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first day of the month after the one `first` begins. */
function nextFirst(first: string): string {
  const [year, month] = first.split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The `count` calendar months that have finished before the one `today` falls in, oldest first. */
export function lastFinishedMonths(today: string, count: number): MonthDays[] {
  const [year, month] = today.split('-').map(Number);
  const months: MonthDays[] = [];

  for (let back = count; back >= 1; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    months.push({
      first,
      last: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    });
  }

  return months;
}
