import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { type Actor, AuthorizationService } from '../auth/authorization/authorization.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import { NotFoundError, ValidationFailedError } from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { decodeRosterCursor, encodeRosterCursor, type RosterCursor } from '../common/roster-cursor';
import { reportingPeriodBounds } from '../common/time/reporting-period';
import { CellsReadService } from '../cells/cells.read.service';
import { PeopleReadService } from '../people/people.read.service';

import {
  CellByLeaderDto,
  CellMonthlyReportDto,
  DccByLeaderDto,
  DccMonthlyReportDto,
} from './dto/reporting.dto';
import {
  ReportingService,
  type CellMonthlyReport,
  type CellReportScope,
  type CoverageByLeader,
  type DccMonthlyReport,
  type DccReportScope,
} from './reporting.service';

/**
 * The aggregate reporting surface (SKILL.md section 22).
 *
 * **Every field of every response here is `snake_case`, which section 22 requires of the
 * whole boundary**: "Names are `snake_case`", and "`camelCase` is not used at this
 * boundary". Both routes returned `uniquePeople`, `removedEvents`, `secondTimer` and a
 * `scope` carrying `personId` or `cellId` until 2026-09-08 — this module was the only one
 * in the repository that did, while `person_id`, `next_cursor` and `full_name` are the
 * shape everywhere else.
 *
 * **What made it worth fixing rather than noting** is that it broke section 22's other
 * naming rule inside a single route: "One concept carries one field name across every
 * endpoint." A client sent `cell_id` and was answered `cellId`. The identifier cases are
 * also the ones section 22 warns about by name — an identifier spelled `camelCase` "is not
 * canonicalized, which is a defect that shows up as an authorization comparison quietly
 * answering on a spelling" — and while nothing here compares one, the next route to echo a
 * selector back would inherit the spelling.
 *
 * No client existed to break.
 *
 * **`reports.view_subtree` guards everything here, and never substitutes for
 * `dcc.view_subtree` or `cell.view_subtree`** — section 7 states that in both directions.
 * A leader granted the domain capability may read the records; reading the church's
 * *figures* is a separate grant, and this is the family it covers.
 *
 * **The target is the scope selector itself** (section 7), not the actor and not a Person.
 * A request for a scope the actor does not hold is `SCOPE_DENIED` and is never quietly
 * narrowed to the scope they do hold — so a Leader asking for Whole Church is refused
 * rather than handed their own subtree's figures under a church-wide heading.
 *
 * **The selector resolves as of the period being reported** (decision 0207), through the
 * pastoral tree in force at that instant and never through section 20's placement graph
 * (decision 0214). So a leader may read October's figures for somebody who left their
 * subtree in November, and may not read them for somebody who joined it in November.
 */
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly authorization: AuthorizationService,
    private readonly people: PeopleReadService,
    private readonly cells: CellsReadService,
  ) {}

  /**
   * DCC classification and monthly-attendance buckets for a month (sections 9, 12, 20).
   *
   * The guard has already read `period` and `scope` off this query to place the request
   * in the tree, so by the time this method runs the month is a reporting month and the
   * scope is one the service computes.
   */
  @Get('dcc/monthly')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    networkFrom: 'query.network',
    periodFrom: 'query.period',
  })
  async dccMonthly(@Query() query: DccMonthlyReportDto): Promise<DccMonthlyReport> {
    const scope = scopeOf(query);
    await this.assertNamesSomebody(scope);

    return this.reporting.dccMonthly(scope, query.period);
  }

  /**
   * Cell classification, and monthly-attendance buckets where section 12 permits them
   * (sections 12 and 20).
   *
   * **The buckets are in the response at `CELL` scope and absent at every other**, which
   * is section 12's structural rule rather than a rendering choice: `N` belongs to a Cell,
   * so an aggregate `Completed` would mean "attended everything their own Cell happened to
   * record" and would be inflated by exactly the Cells that recorded least. Decision 0202
   * settles that nothing replaces them.
   *
   * **`cell_id` is dated at the guard** (decision 0220), which is the one thing about this
   * route that is not shared with the DCC one above: a Cell resolves through the leader in
   * force at the period's final millisecond, falling back to its last leader where nobody
   * held it then.
   *
   * **Coverage ships at every scope, and it is the figure an aggregate view leads with**
   * (section 12, decision 0202). Its denominator is derived from the Cell's schedule
   * against the calendar rather than from anything submitted, which is section 12's own
   * reason for putting it first — recording less makes coverage worse and never better.
   * Each scheduled meeting is attributed to the leader who led that Cell on the scheduled
   * date (section 20), so a Cell handed over mid-month splits between two leaders.
   *
   * *This said "Coverage is not here yet" and pointed at `docs/ROADMAP.md` for the debt,
   * which the same change that added the figure left standing on the route's own
   * docblock.*
   */
  @Get('cells/monthly')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    cellFrom: 'query.cell_id',
    periodFrom: 'query.period',
  })
  async cellsMonthly(@Query() query: CellMonthlyReportDto): Promise<CellMonthlyReport> {
    const scope = cellScopeOf(query);
    await this.assertNamesSomebody(scope);

    return this.reporting.cellMonthly(scope, query.period);
  }

  /**
   * `GET /api/v1/reports/dcc/monthly/by-leader` -- the DCC report's coverage line, one row per
   * leader who owns an obligation in it (SKILL.md section 17, decision 0254).
   *
   * **The same guard as the report it breaks down**, on the same selector and period, so a
   * reader who may not read the report may not read its rows. Each row counts that leader's
   * own obligations, so the rows and the unnamed line add up to the report's coverage.
   */
  @Get('dcc/monthly/by-leader')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    networkFrom: 'query.network',
    periodFrom: 'query.period',
  })
  async dccByLeader(
    @Query() query: DccByLeaderDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const scope = scopeOf(query);
    await this.assertNamesSomebody(scope);
    const coverage = await this.reporting.dccCoverageByLeader(scope, query.period);

    return this.byLeader(coverage, actor, query);
  }

  /**
   * `GET /api/v1/reports/cells/monthly/by-leader` -- the Cell report's coverage line, one row
   * per leader who led a scheduled meeting's Cell on its date (decision 0254, section 20).
   */
  @Get('cells/monthly/by-leader')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    cellFrom: 'query.cell_id',
    periodFrom: 'query.period',
  })
  async cellsByLeader(
    @Query() query: CellByLeaderDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const scope = cellScopeOf(query);
    await this.assertNamesSomebody(scope);
    const coverage = await this.reporting.cellCoverageByLeader(scope, query.period);

    return this.byLeader(coverage, actor, query);
  }

  /**
   * A selector naming nobody answers `NOT_FOUND` (decision 0253), checked after the guard so
   * a narrower grant is refused whether or not the identifier names anybody.
   */
  private async assertNamesSomebody(scope: DccReportScope | CellReportScope): Promise<void> {
    if (scope.kind === 'LEADER' && (await this.people.findById(scope.person_id)) === null) {
      throw new NotFoundError('No such person.');
    }

    if (scope.kind === 'CELL' && !(await this.cells.exists(scope.cell_id))) {
      throw new NotFoundError('No such Cell.');
    }
  }

  /**
   * Names the rows and pages them (decision 0254).
   *
   * **A row is named exactly when the guard would admit that leader as a `LEADER` selector
   * at the period's final millisecond**, asked of `authorization` on the pooled connection
   * after the report's transaction has closed -- section 24 forbids measuring reach against
   * the snapshot a report is computed from. Every other line is added into one line that
   * names nobody, does not open, and is null when it counts nothing. A meeting with no owner
   * (`leaderId` null) can only be counted there.
   *
   * **The reader's own row comes first, then the rest by name** on the shared roster key.
   * The reader's row is on the first page only; the cursor pages the rest. The total is the
   * report's coverage, on every page.
   */
  private async byLeader(
    coverage: CoverageByLeader,
    actor: Actor,
    page: { period: string; limit?: number; cursor?: string },
  ): Promise<Record<string, unknown>> {
    const owned = coverage.lines.flatMap((line) =>
      line.leaderId === null
        ? []
        : [{ leaderId: line.leaderId, filed: line.filed, owed: line.owed }],
    );
    const at = reportingPeriodBounds(page.period).end;
    const admitted = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      owned.map((line) => ({
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: line.leaderId },
        at,
      })),
    );

    const named = owned.filter((_, index) => admitted[index]);
    const identities = await this.people.forDecisions(named.map((line) => line.leaderId));

    const total = { filed: 0, owed: 0 };
    for (const line of coverage.lines) {
      total.filed += line.filed;
      total.owed += line.owed;
    }

    const rows = named.flatMap((line) => {
      const identity = identities.get(line.leaderId);

      return identity === undefined
        ? []
        : [
            {
              key: keyOf(identity),
              isReader: canonicalId(line.leaderId) === canonicalId(actor.personId),
              row: {
                leader: {
                  id: line.leaderId,
                  member_id: identity.memberId,
                  full_name: identity.fullName,
                },
                filed: line.filed,
                owed: line.owed,
              },
            },
          ];
    });

    // Everything not shown as a named row, so the rows and this line add up to the total.
    const shown = rows.reduce(
      (sum, entry) => ({ filed: sum.filed + entry.row.filed, owed: sum.owed + entry.row.owed }),
      { filed: 0, owed: 0 },
    );
    const others = { filed: total.filed - shown.filed, owed: total.owed - shown.owed };

    const reader = rows.find((entry) => entry.isReader);
    const rest = rows
      .filter((entry) => !entry.isReader)
      .sort((left, right) => compareKeys(left.key, right.key));

    const after = decodeRosterCursor(page.cursor);
    const limit = page.limit ?? 50;
    const beyond =
      after === null ? 0 : rest.findIndex((entry) => compareKeys(entry.key, after) > 0);
    const start = beyond === -1 ? rest.length : beyond;
    const first = after === null && reader !== undefined;
    // The reader's row takes a place on the first page, so every page holds `limit` rows.
    const room = first ? limit - 1 : limit;
    const window = rest.slice(start, start + room);
    const last = window[window.length - 1];
    // Where the reader's row fills the first page, the cursor sorts before every other row.
    const resume = last?.key ?? (first ? BEFORE_EVERY_KEY : undefined);

    return {
      period: page.period,
      open: coverage.open,
      data: [...(first ? [reader] : []), ...window].map((entry) => entry.row),
      others: others.filed === 0 && others.owed === 0 ? null : others,
      total,
      next_cursor:
        start + room < rest.length && resume !== undefined ? encodeRosterCursor(resume) : null,
    };
  }
}

const BEFORE_EVERY_KEY: RosterCursor = { lastName: '', firstName: '', memberId: '' };

function keyOf(identity: { lastName: string; firstName: string; memberId: string }): RosterCursor {
  return {
    lastName: identity.lastName,
    firstName: identity.firstName,
    memberId: identity.memberId,
  };
}

/** The roster order: last name, first name, Member ID, so the sort and the cursor agree. */
function compareKeys(left: RosterCursor, right: RosterCursor): number {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.memberId.localeCompare(right.memberId)
  );
}

/**
 * The selector as the service takes it.
 *
 * A `leader_id` sent with `WHOLE_CHURCH` is refused here rather than dropped, for the
 * reason its DTO gives: the request is asking for two different things.
 */
function scopeOf(query: DccMonthlyReportDto): DccReportScope {
  // **Each argument is refused wherever it is not meaningful, in both directions.** The
  // three scopes take three different arguments, so a request carrying the wrong one is
  // asking for something other than what it named.
  if (query.scope !== 'LEADER' && query.leader_id !== undefined) {
    throw new ValidationFailedError('leader_id is only meaningful where scope is LEADER.', {
      field: 'leader_id',
    });
  }

  if (query.scope !== 'NETWORK' && query.network !== undefined) {
    throw new ValidationFailedError('network is only meaningful where scope is NETWORK.', {
      field: 'network',
    });
  }

  if (query.scope === 'LEADER') {
    // The DTO requires it under this scope, so this is a type narrowing rather than a
    // second check -- and it is written as one so the non-null assertion is not.
    if (query.leader_id === undefined) {
      throw new ValidationFailedError('leader_id is required where scope is LEADER.', {
        field: 'leader_id',
      });
    }

    return { kind: 'LEADER', person_id: query.leader_id };
  }

  if (query.scope === 'NETWORK') {
    if (query.network === undefined) {
      throw new ValidationFailedError('network is required where scope is NETWORK.', {
        field: 'network',
      });
    }

    return { kind: 'NETWORK', network: query.network };
  }

  return { kind: 'WHOLE_CHURCH' };
}

/**
 * The Cell report's selector as the service takes it.
 *
 * The same shape as `scopeOf` above and deliberately not shared with it: the two routes
 * offer different scopes, so a common function would have to take the admissible set as an
 * argument and would refuse `NETWORK` here by a condition rather than by its type. Section
 * 22's ordering means each refusal names the field a client needs in order to fix it, and
 * the fields differ.
 */
function cellScopeOf(query: CellMonthlyReportDto): CellReportScope {
  // Each argument is refused wherever it is not meaningful, in both directions, as the DCC
  // selector's own comment sets out.
  if (query.scope !== 'LEADER' && query.leader_id !== undefined) {
    throw new ValidationFailedError('leader_id is only meaningful where scope is LEADER.', {
      field: 'leader_id',
    });
  }

  if (query.scope !== 'CELL' && query.cell_id !== undefined) {
    throw new ValidationFailedError('cell_id is only meaningful where scope is CELL.', {
      field: 'cell_id',
    });
  }

  if (query.scope === 'LEADER') {
    if (query.leader_id === undefined) {
      throw new ValidationFailedError('leader_id is required where scope is LEADER.', {
        field: 'leader_id',
      });
    }

    return { kind: 'LEADER', person_id: query.leader_id };
  }

  if (query.scope === 'CELL') {
    if (query.cell_id === undefined) {
      throw new ValidationFailedError('cell_id is required where scope is CELL.', {
        field: 'cell_id',
      });
    }

    return { kind: 'CELL', cell_id: query.cell_id };
  }

  return { kind: 'WHOLE_CHURCH' };
}
