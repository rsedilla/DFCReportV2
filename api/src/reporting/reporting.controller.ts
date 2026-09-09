import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { ValidationFailedError } from '../common/errors/api-error';

import { CellMonthlyReportDto, DccMonthlyReportDto } from './dto/reporting.dto';
import {
  ReportingService,
  type CellMonthlyReport,
  type CellReportScope,
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
 * No client existed to break: the screens are unbuilt, and both routes are waived in
 * `web/screen-coverage.json`.
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
  constructor(private readonly reporting: ReportingService) {}

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
    return this.reporting.dccMonthly(scopeOf(query), query.period);
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
    return this.reporting.cellMonthly(cellScopeOf(query), query.period);
  }
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
