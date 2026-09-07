import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { ValidationFailedError } from '../common/errors/api-error';

import { DccMonthlyReportDto } from './dto/reporting.dto';
import { ReportingService, type DccMonthlyReport, type ReportScope } from './reporting.service';

/**
 * The aggregate reporting surface (SKILL.md section 22).
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
   * scope is one of the two this service computes.
   */
  @Get('dcc/monthly')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    periodFrom: 'query.period',
  })
  async dccMonthly(@Query() query: DccMonthlyReportDto): Promise<DccMonthlyReport> {
    return this.reporting.dccMonthly(scopeOf(query), query.period);
  }
}

/**
 * The selector as the service takes it.
 *
 * A `leader_id` sent with `WHOLE_CHURCH` is refused here rather than dropped, for the
 * reason its DTO gives: the request is asking for two different things.
 */
function scopeOf(query: DccMonthlyReportDto): ReportScope {
  if (query.scope === 'LEADER') {
    // The DTO requires it under this scope, so this is a type narrowing rather than a
    // second check -- and it is written as one so the non-null assertion is not.
    if (query.leader_id === undefined) {
      throw new ValidationFailedError('leader_id is required where scope is LEADER.', {
        field: 'leader_id',
      });
    }

    return { kind: 'LEADER', personId: query.leader_id };
  }

  if (query.leader_id !== undefined) {
    throw new ValidationFailedError('leader_id is only meaningful where scope is LEADER.', {
      field: 'leader_id',
    });
  }

  return { kind: 'WHOLE_CHURCH' };
}
