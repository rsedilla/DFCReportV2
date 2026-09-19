import { Inject, Injectable } from '@nestjs/common';

import { canonicalId } from '../common/identifiers';
import { manilaDayOf } from '../common/time/manila';
import { databaseNow, reportingMonthOf, windowClosesAt } from '../common/time/submission-window';
import { CellsReadService } from '../cells/cells.read.service';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';

import { CellFiguresService } from './cell-figures.service';
import { DccCoverageService } from './dcc-coverage.service';

/** A branch as the Network screen shows it: the focus person and their direct disciples. */
interface Branch {
  /** The focus person and everyone beneath them now. */
  members: string[];
  /** Each direct disciple's own branch, themselves included. */
  childBranches: Map<string, string[]>;
}

/**
 * The Network screen's figures for the current month (SKILL.md section 17, decision
 * 0252).
 *
 * **Every figure is a sum over a branch as it stands now of each leader's own unmet
 * obligations**, owned as decision 0254 owns them: a DCC leader-event by the leader who
 * held the edge at the event, a scheduled Cell meeting by the leader who led the Cell on
 * its date (section 20). An obligation has one owner, so a branch's figure is a plain sum
 * and nothing is counted twice. **The two domains are never added together** (decision
 * 0252): a record and a meeting are different units.
 *
 * **The current month only, and always marked open** (section 17). Past months are read
 * in Reports, which owns the period (decision 0254); nothing here resolves a tree at a
 * past instant.
 *
 * Here rather than in `people` because both figures are this module's, and `cells` and
 * `hierarchy` are already reachable from it without a cycle.
 */
@Injectable()
export class BranchFiguresService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly cells: CellsReadService,
    private readonly recordedMeetings: CellFiguresService,
    private readonly dccCoverage: DccCoverageService,
  ) {}

  /** `GET /api/v1/leaders/{id}/dcc-behind`. */
  async dccBehind(personId: string): Promise<Record<string, unknown>> {
    const { reportingMonth, open } = await this.currentMonth();
    const branch = await this.branchOf(personId);
    const unmet = await this.dccCoverage.unmetByLeaderIn(reportingMonth, branch.members);

    return {
      reporting_month: reportingMonth,
      open,
      branch_behind: sumOver(branch.members, unmet),
      behind_by_child: byChild(branch, unmet),
    };
  }

  /** `GET /api/v1/leaders/{id}/cell-figures`. */
  async cellFigures(personId: string): Promise<Record<string, unknown>> {
    const { reportingMonth, open, today } = await this.currentMonth();
    const branch = await this.branchOf(personId);

    const [scheduled, recorded, leaders] = await Promise.all([
      this.cells.scheduledMeetingsWithLeaderIn(this.db, reportingMonth),
      this.recordedMeetings.recordedScheduledDatesIn(this.db, reportingMonth),
      this.cells.currentCellLeaderIds(),
    ]);

    // A meeting whose Manila day has not begun takes no record yet (decision 0238), so it
    // is not behind. One with no leader on its date has no owner and falls in no branch,
    // which `CLAUDE.md` records as open and unreachable.
    const unmet = new Map<string, number>();

    for (const meeting of scheduled) {
      if (
        meeting.leaderId === null ||
        meeting.scheduledDate > today ||
        recorded.has(`${meeting.cellId}|${meeting.scheduledDate}`)
      ) {
        continue;
      }

      const key = canonicalId(meeting.leaderId);
      unmet.set(key, (unmet.get(key) ?? 0) + 1);
    }

    const current = new Set([...leaders].map((id) => canonicalId(id)));

    return {
      reporting_month: reportingMonth,
      open,
      // Beneath, so the focus person is not counted (decision 0252).
      cell_leaders_beneath: branch.members.filter(
        (id) => !sameAs(id, personId) && current.has(canonicalId(id)),
      ).length,
      branch_meetings_behind: sumOver(branch.members, unmet),
      meetings_behind_by_child: byChild(branch, unmet),
    };
  }

  private async currentMonth(): Promise<{ reportingMonth: string; open: boolean; today: string }> {
    const now = await databaseNow(this.db);
    const today = manilaDayOf(now);
    const reportingMonth = reportingMonthOf(today);

    return {
      reportingMonth,
      today,
      open: now.getTime() < windowClosesAt(reportingMonth).getTime(),
    };
  }

  private async branchOf(personId: string): Promise<Branch> {
    const edges = await this.hierarchy.subtreeEdgesOf(personId);
    const childrenOf = new Map<string, string[]>();

    for (const edge of edges) {
      const siblings = childrenOf.get(edge.leaderId) ?? [];
      siblings.push(edge.personId);
      childrenOf.set(edge.leaderId, siblings);
    }

    const collect = (rootId: string): string[] => {
      const out: string[] = [];
      const stack = [rootId];

      while (stack.length > 0) {
        const id = stack.pop() as string;
        out.push(id);
        stack.push(...(childrenOf.get(id) ?? []));
      }

      return out;
    };

    return {
      members: collect(personId),
      childBranches: new Map(
        (childrenOf.get(personId) ?? []).map((childId) => [childId, collect(childId)]),
      ),
    };
  }
}

function sumOver(members: readonly string[], unmet: ReadonlyMap<string, number>): number {
  return members.reduce((sum, id) => sum + (unmet.get(canonicalId(id)) ?? 0), 0);
}

/**
 * One figure per direct disciple, **every one of them rather than a page**: the screen's
 * filter shows only rows where a figure is above zero, and it can only do that across a
 * whole generation. The size is the generation's, which is the size of what `children`
 * pages.
 */
function byChild(branch: Branch, unmet: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...branch.childBranches].map(([childId, members]) => [childId, sumOver(members, unmet)]),
  );
}

function sameAs(left: string, right: string): boolean {
  return canonicalId(left) === canonicalId(right);
}
