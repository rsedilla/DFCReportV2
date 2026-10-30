import { Controller, Get, Query } from '@nestjs/common';

import { RequiresCapability } from '../auth/authorization/authorization.decorators';
import { Capability } from '../auth/authorization/capabilities';
import { type Actor, AuthorizationService } from '../auth/authorization/authorization.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import {
  ApiError,
  NotFoundError,
  ScopeDeniedError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { canonicalId } from '../common/identifiers';
import { mapInTurns } from '../common/map-in-turns';
import {
  compareRosterKeys,
  decodeRosterCursor,
  encodeRosterCursor,
  rosterKeyOf,
  rosterStart,
  type RosterCursor,
} from '../common/roster-cursor';
import { reportingPeriodBounds } from '../common/time/reporting-period';
import { manilaDayOf } from '../common/time/manila';
import { recordDueAt, reportingMonthOf } from '../common/time/submission-window';
import { CellsReadService } from '../cells/cells.read.service';
import { DatabaseClock } from '../database/database-clock';
import type { NetworkName } from '../database/schema';
import { PeopleReadService } from '../people/people.read.service';

import {
  BranchCountsDto,
  BranchPeopleDto,
  BranchTrendsDto,
  CellByLeaderDto,
  CellMonthlyReportDto,
  CellTwelveDto,
  ChurchCountsDto,
  DccByLeaderDto,
  DccMonthlyReportDto,
  DccTwelveDto,
  LeaderRecordingStatusDto,
  RecordingStatusDto,
  TrendsDto,
  type TrendFigure,
} from './dto/reporting.dto';
import {
  ReportingService,
  type CellMonthlyReport,
  type Classification,
  type CellReportScope,
  type ChurchCountFigures,
  type CoverageByLeader,
  type DccMonthlyReport,
  type DccReportScope,
  type RecordingColumn,
  type RecordingFigures,
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
    private readonly clock: DatabaseClock,
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
    await this.readAsKept(query);
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
    await this.readAsKept(query);
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
    await this.readAsKept(query);
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
    await this.readAsKept(query);
    const scope = cellScopeOf(query);
    await this.assertNamesSomebody(scope);
    const coverage = await this.reporting.cellCoverageByLeader(scope, query.period);

    return this.byLeader(coverage, actor, query);
  }

  /**
   * `GET /api/v1/reports/cells/twelve` -- My 12 over a week, a month, a quarter or a year
   * (SKILL.md sections 12, 13, 17 and 20; decision 0293).
   *
   * **The same guard as the Cell report, on the same selector**, resolved at the month the
   * service derives from `kind` and `start` and refuses any other. `CELL` is refused: a Cell
   * has members rather than disciples, so it has no 12.
   *
   * **Rows are named as the by-leader list names them** (decision 0254): a row is named only
   * where the guard would admit that leader as a selector at the same instant, asked on the
   * pooled connection after the report's transaction has closed (section 24). Such a leader is
   * the subject's own disciple, so every row is named in practice; one that is not stays a
   * row, unnamed and not opening, so the People column still reconciles.
   *
   * **In first-name order, or a whole-church reader's in Network order, never by a figure**
   * (section 13, decision 0293): no row numbers, and
   * nothing a client can sort by a count.
   */
  @Get('cells/twelve')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    cellFrom: 'query.cell_id',
    periodFrom: 'query.period',
  })
  async cellsTwelve(
    @Query() query: CellTwelveDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    await this.readAsKept(query);
    const scope = cellScopeOf(query);
    if (scope.kind === 'CELL') {
      throw new ValidationFailedError(
        'A Cell has members rather than disciples, so it has no 12.',
        {
          field: 'scope',
          value: 'CELL',
        },
      );
    }
    await this.assertNamesSomebody(scope);
    const rootLeaders = rootLeadersAsked(query.rows, scope.kind);

    const twelve = await this.reporting.cellTwelve(
      scope.kind === 'LEADER'
        ? { kind: 'LEADER', person_id: scope.person_id }
        : rootLeaders
          ? { kind: 'ROOT_LEADERS' }
          : { kind: 'WHOLE_CHURCH' },
      query.kind,
      query.start,
      query.period,
    );

    const rows = await this.nameTwelveRows(
      actor,
      scope.kind === 'LEADER'
        ? { kind: 'LEADER', person_id: scope.person_id }
        : { kind: 'WHOLE_CHURCH' },
      twelve.at,
      twelve.rows,
    );

    return {
      kind: query.kind,
      start: twelve.from,
      end: twelve.to,
      open: twelve.open,
      coverage: twelve.coverage,
      rows,
      own: twelve.own,
      overlap: twelve.overlap,
      elsewhere: twelve.elsewhere,
      total: twelve.total,
      calendar_start: twelve.calendar_start,
      ...(rootLeaders ? { roots: await this.rootsOf(twelve.rows) } : {}),
    };
  }

  /**
   * `GET /api/v1/reports/dcc/twelve` -- DCC's My 12 over a week, a month, a quarter or a year
   * (SKILL.md sections 9, 13, 17 and 20; decision 0294).
   *
   * **The Cell table's route on the DCC report's guard and selector.** A whole-church reader's
   * rows are the two roots' 12s; a `NETWORK` selector returns the Network's total, by
   * membership, and no rows. The reach check, naming and order are the Cell table's, shared.
   */
  @Get('dcc/twelve')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    networkFrom: 'query.network',
    periodFrom: 'query.period',
  })
  async dccTwelve(
    @Query() query: DccTwelveDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    await this.readAsKept(query);
    const scope = scopeOf(query);
    await this.assertNamesSomebody(scope);
    const rootLeaders = rootLeadersAsked(query.rows, scope.kind);

    const twelve = await this.reporting.dccTwelve(
      rootLeaders ? { kind: 'ROOT_LEADERS' } : scope,
      query.kind,
      query.start,
      query.period,
    );
    const rows = await this.nameTwelveRows(actor, scope, twelve.at, twelve.rows);

    return {
      kind: query.kind,
      start: twelve.from,
      end: twelve.to,
      open: twelve.open,
      coverage: twelve.coverage,
      n: twelve.n,
      removed_events: twelve.removed_events,
      rows,
      own: twelve.own,
      overlap: twelve.overlap,
      elsewhere: twelve.elsewhere,
      total: twelve.total,
      buckets: twelve.buckets,
      calendar_start: twelve.calendar_start,
      ...(rootLeaders ? { roots: await this.rootsOf(twelve.rows) } : {}),
    };
  }

  /**
   * The Senior Pastors' *Recording status* (decision 0325): whether the church has recorded,
   * for a week or a month, as Whole Church boxes, one table per root's direct leaders in
   * first-name order, and an *Others* line.
   *
   * **Whole Church only** (point 8): `reports.view_subtree` against the church, so a reader
   * holding it over a subtree is refused rather than handed a narrower screen under a
   * church-wide heading. The percentage is computed here for the two boxes alone, rounded
   * down, and absent where nobody owed (point 3).
   */
  @Get('recording-status')
  @RequiresCapability(Capability.ReportsViewSubtree, { kind: 'church' })
  async recordingStatus(
    @Query() query: RecordingStatusDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    const status = await this.reporting.recordingStatus(query.kind, query.start, query.period);
    const opensPending = await this.pendingReachOf(actor);

    const ids = [
      ...(status.tables ?? []).flatMap((table) => [
        table.rootId,
        ...table.rows.map((row) => row.leaderId),
      ]),
    ];
    const identities = await this.people.forDecisions(ids);
    const person = (id: string) => {
      const identity = identities.get(id);

      return {
        id,
        member_id: identity?.memberId ?? null,
        full_name: identity?.fullName ?? null,
      };
    };
    const byName = (left: string, right: string) => {
      const a = identities.get(left);
      const b = identities.get(right);

      // An unnamed identity sorts last, then by identifier, so the order is total.
      return a !== undefined && b !== undefined
        ? compareRosterKeys(a, b)
        : a !== undefined
          ? -1
          : b !== undefined
            ? 1
            : left.localeCompare(right);
    };
    // On time first (decision 0335): the percentage is of leaders on time where the period
    // has a deadline, of leaders who recorded where it has none.
    const deadline = recordDueAt(status.end) !== null;
    const box = (column: RecordingColumn) => ({
      ...column,
      on_time: column.recorded - column.late,
      percent:
        column.owed === 0
          ? null
          : Math.floor(
              ((deadline ? column.recorded - column.late : column.recorded) * 100) / column.owed,
            ),
    });
    const figures = (row: RecordingFigures) => ({
      cell: row.cell,
      dcc: row.dcc,
      status:
        row.status.kind === 'STILL_TO_RECORD'
          ? { kind: row.status.kind, leaders: row.status.leaders }
          : { kind: row.status.kind },
    });

    return {
      kind: status.kind,
      start: status.start,
      end: status.end,
      open: status.open,
      deadline,
      whole_church: {
        cell: box(status.wholeChurch.cell),
        dcc: box(status.wholeChurch.dcc),
      },
      // The period before carries no percentage: point 3 gives one to the boxes alone.
      previous: {
        start: status.previous.start,
        end: status.previous.end,
        open: status.previous.open,
        deadline: recordDueAt(status.previous.end) !== null,
        cell: status.previous.figures.cell,
        dcc: status.previous.figures.dcc,
      },
      tables:
        status.tables === null
          ? null
          : [...status.tables]
              // By Network, Men's first, rather than by name: both roots may share a surname
              // (owner, 2026-10-08). Never by a figure.
              .sort(
                (left, right) =>
                  networkOrder(left.network) - networkOrder(right.network) ||
                  byName(left.rootId, right.rootId),
              )
              .map((table) => ({
                root: person(table.rootId),
                network: table.network,
                rows: [...table.rows]
                  .sort((left, right) => byName(left.leaderId, right.leaderId))
                  .map((row) => ({
                    leader: person(row.leaderId),
                    ...figures(row.figures),
                    opens_pending: opensPending(row.leaderId),
                  })),
              })),
      others: status.others === null ? null : figures(status.others),
    };
  }

  /**
   * Whether a row's leader is under the reader now for each Pending list (decision 0370), so a
   * figure links only where the list would open: a row is named for its period, and a leader
   * moved since then is outside the list's scope now. Read after the report's transaction, as
   * the rows' names are (section 24).
   */
  private async pendingReachOf(
    actor: Actor,
  ): Promise<(leaderId: string) => { cell: boolean; dcc: boolean }> {
    const [cell, dcc] = await Promise.all([
      this.authorization.scopeMembership(actor, Capability.CellViewSubtree),
      this.authorization.scopeMembership(actor, Capability.DccViewSubtree),
    ]);
    const reach = (membership: typeof cell) =>
      membership.kind === 'WHOLE_CHURCH'
        ? null
        : new Set([...membership.personIds].map((id) => canonicalId(id)));
    const [cells, dccs] = [reach(cell), reach(dcc)];

    return (leaderId) => ({
      cell: cells === null || cells.has(canonicalId(leaderId)),
      dcc: dccs === null || dccs.has(canonicalId(leaderId)),
    });
  }

  /**
   * A Full view leader's *Recording Status* (decision 0334): the Senior Pastors' tab for one
   * branch. Boxes for everyone beneath the leader, then one row per direct leader counting
   * that leader and everyone beneath them, in first-name order.
   *
   * Placed by the guard as a My 12 table is, so `reports.view_subtree` over the leader at the
   * period's instant. **A row is named only where the reader could open that leader as a
   * selector** (decision 0254), asked after the report's transaction has closed (section 24);
   * the rest are added into *Others*, which names nobody and is null when every row is named.
   * **The period before is authorized as it would be if it were the period shown**, so a
   * week answers alike in both places; it is null where the reader could not open that leader.
   */
  @Get('recording-status/leader')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    periodFrom: 'query.period',
  })
  async leaderRecordingStatus(
    @Query() query: LeaderRecordingStatusDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (query.scope === 'WHOLE_CHURCH') {
      throw new ValidationFailedError(
        'The whole church’s Recording Status is GET /reports/recording-status.',
        { field: 'scope', value: 'WHOLE_CHURCH' },
      );
    }
    await this.readAsKept(query);
    await this.assertNamesSomebody({ kind: 'LEADER', person_id: query.leader_id });
    const status = await this.reporting.leaderRecordingStatus(
      query.leader_id,
      query.kind,
      query.start,
      query.period,
    );

    // On time first (decision 0335): the percentage is of leaders on time where the period
    // has a deadline, of leaders who recorded where it has none.
    const deadline = recordDueAt(status.end) !== null;
    const box = (column: RecordingColumn) => ({
      ...column,
      on_time: column.recorded - column.late,
      percent:
        column.owed === 0
          ? null
          : Math.floor(
              ((deadline ? column.recorded - column.late : column.recorded) * 100) / column.owed,
            ),
    });
    const figures = (row: RecordingFigures) => ({
      cell: row.cell,
      dcc: row.dcc,
      status:
        row.status.kind === 'STILL_TO_RECORD'
          ? { kind: row.status.kind, leaders: row.status.leaders }
          : { kind: row.status.kind },
    });

    let rows: Record<string, unknown>[] | null = null;
    let others: Record<string, unknown> | null = null;
    const opensPending = await this.pendingReachOf(actor);
    if (status.rows !== null) {
      const admitted = await this.authorization.coversEach(
        actor,
        Capability.ReportsViewSubtree,
        status.rows.map((row) => ({
          kind: 'report_scope' as const,
          selector: { kind: 'LEADER' as const, personId: row.leaderId },
          at: reportingPeriodBounds(query.period).end,
        })),
      );
      const named = status.rows.filter((_, index) => admitted[index]);
      const identities = await this.people.forDecisions(named.map((row) => row.leaderId));

      rows = named
        .flatMap((row) => {
          const identity = identities.get(row.leaderId);
          return identity === undefined ? [] : [{ identity, row }];
        })
        .sort((left, right) => compareRosterKeys(left.identity, right.identity))
        .map(({ identity, row }) => ({
          leader: { id: row.leaderId, member_id: identity.memberId, full_name: identity.fullName },
          ...figures(row.figures),
          opens_pending: opensPending(row.leaderId),
        }));

      // The rows' people are disjoint, so the lines not shown add up as columns do.
      const shown = new Set(rows.map((row) => canonicalId((row.leader as { id: string }).id)));
      const rest = status.rows.filter((row) => !shown.has(canonicalId(row.leaderId)));
      if (rest.length > 0) {
        const sum = rest.reduce(
          (total, row) => ({
            cell: {
              recorded: total.cell.recorded + row.figures.cell.recorded,
              owed: total.cell.owed + row.figures.cell.owed,
              late: total.cell.late + row.figures.cell.late,
            },
            dcc: {
              recorded: total.dcc.recorded + row.figures.dcc.recorded,
              owed: total.dcc.owed + row.figures.dcc.owed,
              late: total.dcc.late + row.figures.dcc.late,
            },
            still:
              total.still +
              (row.figures.status.kind === 'STILL_TO_RECORD' ? row.figures.status.leaders : 0),
          }),
          {
            cell: { recorded: 0, owed: 0, late: 0 },
            dcc: { recorded: 0, owed: 0, late: 0 },
            still: 0,
          },
        );
        others = figures({
          cell: sum.cell,
          dcc: sum.dcc,
          status:
            sum.cell.owed === 0 && sum.dcc.owed === 0
              ? { kind: 'NOTHING_OWED' }
              : sum.still === 0
                ? { kind: 'COMPLETED' }
                : { kind: 'STILL_TO_RECORD', leaders: sum.still },
        });
      }
    }

    const [previousCovered] = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      [
        {
          kind: 'report_scope' as const,
          selector: { kind: 'LEADER' as const, personId: query.leader_id },
          at: reportingPeriodBounds(status.previous.guardMonth).end,
        },
      ],
    );
    const previous = previousCovered ? status.previous.figures : null;

    return {
      kind: status.kind,
      start: status.start,
      end: status.end,
      open: status.open,
      deadline,
      branch:
        status.branch === null
          ? null
          : { cell: box(status.branch.cell), dcc: box(status.branch.dcc) },
      previous: {
        start: status.previous.start,
        end: status.previous.end,
        open: status.previous.open,
        deadline: recordDueAt(status.previous.end) !== null,
        cell: previous?.cell ?? null,
        dcc: previous?.dcc ?? null,
      },
      rows,
      others,
    };
  }

  /**
   * `GET /api/v1/reports/people/branch` -- *# of People* for one leader's branch over a month
   * (decision 0364): the box, one row per direct disciple, and the leader's own row.
   *
   * **The report guard on a `LEADER` selector**, dated at the month as every report's is
   * (decision 0207), so a Full view leader reads their own branch and anyone's beneath them,
   * and nobody's above or beside. Their reach is checked again at the instant the figures were
   * counted, and a row is named only where that leader would be admitted as a selector then,
   * as a My 12 row is (decisions 0214 and 0254); any other stays a row, unnamed and not
   * opening, so the rows still add up. In first-name order, never by a figure (section 13).
   */
  @Get('people/branch')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    periodFrom: 'query.period',
  })
  async branchPeople(
    @Query() query: BranchPeopleDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    // The whole church's figure is `church-counts`; this route counts one leader's branch.
    if (query.scope !== 'LEADER' || query.leader_id === undefined) {
      throw new ValidationFailedError(
        'This counts one leader’s branch: send scope LEADER with leader_id.',
        { field: 'scope', value: query.scope },
      );
    }
    await this.readAsKept(query);
    const leaderId = query.leader_id;
    await this.assertNamesSomebody({ kind: 'LEADER', person_id: leaderId });
    const counts = await this.reporting.branchPeople(leaderId, query.period);

    const [reaches] = await this.authorization.coversEach(actor, Capability.ReportsViewSubtree, [
      {
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: leaderId },
        at: counts.at,
      },
    ]);
    if (!reaches) {
      throw new ScopeDeniedError('This report is outside your scope for the period asked.', {
        scope: 'LEADER',
      });
    }

    const rows = counts.rows ?? [];
    const admitted = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      rows.map((row) => ({
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: row.leaderId },
        at: counts.at,
      })),
    );
    const identities = await this.people.forDecisions(
      rows.filter((_, index) => admitted[index]).map((row) => row.leaderId),
    );

    return {
      period: counts.period,
      current: counts.current,
      at: counts.at.toISOString(),
      total: counts.total,
      own: counts.own,
      rows:
        counts.rows === null
          ? null
          : rows
              .map((row, index) => {
                const identity = admitted[index] ? identities.get(row.leaderId) : undefined;

                return {
                  key: identity === undefined ? null : rosterKeyOf(identity),
                  row: {
                    leader:
                      identity === undefined
                        ? null
                        : {
                            id: row.leaderId,
                            member_id: identity.memberId,
                            full_name: identity.fullName,
                          },
                    people: row.people,
                  },
                };
              })
              .sort((left, right) =>
                left.key === null
                  ? 1
                  : right.key === null
                    ? -1
                    : compareRosterKeys(left.key, right.key),
              )
              .map((entry) => entry.row),
    };
  }

  /**
   * `GET /api/v1/reports/counts/branch` -- *# of Cell Groups* and *# of Cell Leaders* for one
   * leader's branch over a month (decision 0380): the box, one row per direct disciple, and the
   * leader's own row.
   *
   * **Guarded and named exactly as `people/branch` is** (decision 0364): the report guard on a
   * `LEADER` selector dated at the month, the actor's reach checked again at the instant the
   * figures were counted, and a row named only where its leader would be admitted as a selector
   * then; any other stays a row, unnamed, so the rows still add up. In first-name order.
   */
  @Get('counts/branch')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    periodFrom: 'query.period',
  })
  async branchCounts(
    @Query() query: BranchCountsDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (query.scope !== 'LEADER' || query.leader_id === undefined) {
      throw new ValidationFailedError(
        'This counts one leader’s branch: send scope LEADER with leader_id.',
        { field: 'scope', value: query.scope },
      );
    }
    await this.readAsKept(query);
    const leaderId = query.leader_id;
    await this.assertNamesSomebody({ kind: 'LEADER', person_id: leaderId });
    const counts = await this.reporting.branchCounts(leaderId, query.period);

    const [reaches] = await this.authorization.coversEach(actor, Capability.ReportsViewSubtree, [
      {
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: leaderId },
        at: counts.at,
      },
    ]);
    if (!reaches) {
      throw new ScopeDeniedError('This report is outside your scope for the period asked.', {
        scope: 'LEADER',
      });
    }

    const rows = counts.rows ?? [];
    const admitted = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      rows.map((row) => ({
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: row.leaderId },
        at: counts.at,
      })),
    );
    const identities = await this.people.forDecisions(
      rows.filter((_, index) => admitted[index]).map((row) => row.leaderId),
    );

    return {
      period: counts.period,
      current: counts.current,
      at: counts.at.toISOString(),
      total: counts.total === null ? null : countFigures(counts.total),
      own: counts.own === null ? null : countFigures(counts.own),
      rows:
        counts.rows === null
          ? null
          : rows
              .map((row, index) => {
                const identity = admitted[index] ? identities.get(row.leaderId) : undefined;

                return {
                  key: identity === undefined ? null : rosterKeyOf(identity),
                  row: {
                    leader:
                      identity === undefined
                        ? null
                        : {
                            id: row.leaderId,
                            member_id: identity.memberId,
                            full_name: identity.fullName,
                          },
                    ...countFigures(row.figures),
                  },
                };
              })
              .sort((left, right) =>
                left.key === null
                  ? 1
                  : right.key === null
                    ? -1
                    : compareRosterKeys(left.key, right.key),
              )
              .map((entry) => entry.row),
    };
  }

  /**
   * `GET /api/v1/reports/trends/branch` -- a Full view leader's *Last 12 months* (decision
   * 0380): one figure for one leader's branch, month by month, the twelve months ending at
   * `period`, the last *so far* while it runs.
   *
   * **Each month is authorized at its own instant**, as a report for that month would be
   * (decisions 0207 and 0214): the guard admits the selector at `period`, and every earlier
   * month is checked again at its final millisecond. A month the actor could not have read the
   * branch for is a gap rather than a figure, so the line never shows a month a by-period
   * report would refuse. One line, the branch's own, and never the church's or another's.
   */
  @Get('trends/branch')
  @RequiresCapability(Capability.ReportsViewSubtree, {
    kind: 'report_scope',
    scopeFrom: 'query.scope',
    leaderFrom: 'query.leader_id',
    periodFrom: 'query.period',
  })
  async branchTrends(
    @Query() query: BranchTrendsDto,
    @CurrentActor() actor: Actor,
  ): Promise<Record<string, unknown>> {
    if (query.scope !== 'LEADER' || query.leader_id === undefined) {
      throw new ValidationFailedError(
        'This draws one leader’s branch: send scope LEADER with leader_id.',
        { field: 'scope', value: query.scope },
      );
    }
    await this.readAsKept(query);
    const leaderId = canonicalId(query.leader_id);
    await this.assertNamesSomebody({ kind: 'LEADER', person_id: leaderId });
    const months = Array.from({ length: 12 }, (_, index) => shiftMonth(query.period, index - 11));

    const admitted = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      months.map((month) => ({
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: leaderId },
        at: reportingPeriodBounds(month).end,
      })),
    );

    // A period that has not begun is refused as every report refuses it (decision 0216), before
    // any month is read; after that, any month that cannot be read is a gap (decision 0257),
    // the asked one included.
    await this.reporting.assertReportable(query.period);

    // The months are independent, so a few are read at once (TREND_REPORTS_AT_ONCE).
    const read = await mapInTurns(months, TREND_REPORTS_AT_ONCE, (month, index) =>
      admitted[index]
        ? this.branchTrendPoint(query.figure, month, leaderId).catch(refusalAsNull)
        : Promise.resolve(null),
    );
    const values = read.map((point) => point?.value ?? null);
    const open = read.map((point) => point?.open ?? false);

    const { person } = await this.namer([leaderId]);
    // The leader's Network today, so the line takes the colour the Senior Pastors' Trends give
    // that branch (decision 0388). It names the line and counts nothing.
    const network = (await this.people.currentNetworksOf([leaderId])).get(leaderId) ?? null;

    return {
      figure: query.figure,
      months,
      current: months[months.length - 1],
      open,
      lines: [{ leader: person(leaderId), network, values }],
    };
  }

  /** One month of a branch's *Last 12 months*, with whether that month is still open. */
  private async branchTrendPoint(
    figure: TrendFigure,
    month: string,
    leaderId: string,
  ): Promise<{ value: number | null; open: boolean }> {
    if (figure === 'CELLS' || figure === 'CELL_LEADERS' || figure === 'PEOPLE') {
      const counts = await this.reporting.branchCounts(leaderId, month);
      const total = counts.total;

      return {
        value:
          total === null
            ? null
            : figure === 'CELLS'
              ? total.cellGroups
              : figure === 'CELL_LEADERS'
                ? total.cellLeaders
                : total.people,
        // A count is taken on the month's last day, so only the month still running is *so far*.
        open: counts.current,
      };
    }

    const scope = { kind: 'LEADER' as const, person_id: leaderId };
    const report =
      figure === 'CG'
        ? await this.reporting.cellMonthly(scope, month)
        : await this.reporting.dccMonthly(scope, month);

    return { value: report.unique_people, open: report.open };
  }

  /**
   * The Senior Pastors' *Number of Cells* and *Number of people* for a month (decision 0326,
   * point 3): the whole church, one table per root's direct leaders, and *Others*.
   *
   * **Whole Church only**, as *Recording status* is: `reports.view_subtree` against the
   * church, so a reader holding it over a subtree is refused.
   */
  @Get('church-counts')
  @RequiresCapability(Capability.ReportsViewSubtree, { kind: 'church' })
  async churchCounts(@Query() query: ChurchCountsDto): Promise<Record<string, unknown>> {
    const counts = await this.reporting.churchCounts(query.period);
    const { person, byName } = await this.namer(
      (counts.tables ?? []).flatMap((table) => [
        table.rootId,
        ...table.rows.map((row) => row.leaderId),
      ]),
    );

    return {
      period: counts.period,
      current: counts.current,
      at: counts.at.toISOString(),
      whole_church: countFigures(counts.wholeChurch),
      tables:
        counts.tables === null
          ? null
          : [...counts.tables]
              .sort(
                (left, right) =>
                  networkOrder(left.network) - networkOrder(right.network) ||
                  byName(left.rootId, right.rootId),
              )
              .map((table) => ({
                root: person(table.rootId),
                network: table.network,
                rows: [...table.rows]
                  .sort((left, right) => byName(left.leaderId, right.leaderId))
                  .map((row) => ({ leader: person(row.leaderId), ...countFigures(row.figures) })),
              })),
      others: counts.others === null ? null : countFigures(counts.others),
    };
  }

  /**
   * The Senior Pastors' *Trends* (decision 0326, point 4): one figure for each of the last
   * twelve months, the current one *so far*.
   *
   * **Three lines, or one.** Without `leader_id`, the whole church and each root's branch;
   * with it, that leader's branch alone — one leader at a time, never two, so the graph cannot
   * rank them (sections 13 and 17). Each point is the figure its tab leads with: CG and DCC
   * attendance the month's unique people (sections 9 and 12), Number of Cells its Cell Groups,
   * Number of Cell Leaders its Cell Leaders, Number of people its People. A month a figure cannot be read for is null, and the screen
   * says so (decision 0257). `open` says which months are still open, so a finished month
   * inside its window is flagged as well as the current one (sections 17 and 19), and each
   * branch line names its Network rather than leaving the client to infer it from position.
   */
  @Get('trends')
  @RequiresCapability(Capability.ReportsViewSubtree, { kind: 'church' })
  async trends(@Query() query: TrendsDto): Promise<Record<string, unknown>> {
    const current = reportingMonthOf(manilaDayOf(await this.clock.now()));
    const months = Array.from({ length: 12 }, (_, index) => shiftMonth(current, index - 11));

    let lines: { leaderId: string | null; network: NetworkName | null }[];
    if (query.leader_id !== undefined) {
      await this.readAsKept(query);
      if (!(await this.people.findById(query.leader_id))) {
        throw new NotFoundError('No such person.');
      }
      lines = [{ leaderId: canonicalId(query.leader_id), network: null }];
    } else {
      const now = await this.reporting.churchCounts(current);
      lines = [
        { leaderId: null, network: null },
        ...[...(now.tables ?? [])]
          .sort((left, right) => networkOrder(left.network) - networkOrder(right.network))
          .map((table) => ({ leaderId: table.rootId, network: table.network })),
      ];
    }

    const branches = lines.flatMap((line) => (line.leaderId === null ? [] : [line.leaderId]));
    const points = new Map<string, (number | null)[]>(
      lines.map((line) => [line.leaderId ?? 'church', []]),
    );

    // Each month's open flag comes from that month's own report, inside the seam that owns
    // the period rules; a month that could not be read has no figure to flag.
    const read = await this.trendPoints(query.figure, months, branches);
    const open: boolean[] = [];
    for (const point of read) {
      open.push(point?.open ?? false);
      for (const line of lines) {
        const key = line.leaderId ?? 'church';
        points.get(key)!.push(point === null ? null : (point.values.get(key) ?? null));
      }
    }

    const { person } = await this.namer(branches);

    return {
      figure: query.figure,
      months,
      current,
      open,
      lines: lines.map((line) => ({
        leader: line.leaderId === null ? null : person(line.leaderId),
        network: line.network,
        values: points.get(line.leaderId ?? 'church'),
      })),
    };
  }

  /**
   * Each month of *Trends*, keyed `church` and by each branch's leader; null for a month that
   * could not be read.
   *
   * The reports are independent, so they are read TREND_REPORTS_AT_ONCE at a time rather than
   * one after another. A closed month is a stored read (decision 0320) and the month still
   * running is computed, so it is the current month's church and branch reports, side by side,
   * that this shortens.
   */
  private async trendPoints(
    figure: TrendFigure,
    months: readonly string[],
    branches: readonly string[],
  ): Promise<({ values: Map<string, number | null>; open: boolean } | null)[]> {
    if (figure === 'CELLS' || figure === 'CELL_LEADERS' || figure === 'PEOPLE') {
      const pick = (figures: ChurchCountFigures | null | undefined) =>
        figures === null || figures === undefined
          ? null
          : figure === 'CELLS'
            ? figures.cellGroups
            : figure === 'CELL_LEADERS'
              ? figures.cellLeaders
              : figures.people;

      return mapInTurns(months, TREND_REPORTS_AT_ONCE, async (month) => {
        const counts = await this.reporting.churchCounts(month, branches).catch(refusalAsNull);
        if (counts === null) {
          return null;
        }
        const values = new Map<string, number | null>([['church', pick(counts.wholeChurch)]]);
        for (const id of branches) {
          values.set(id, pick(counts.branches.get(canonicalId(id))));
        }
        // A count is taken on the month's last day, so only the month still running is *so
        // far* (decision 0326); the recording window is attendance's, not a count's.
        return { values, open: counts.current };
      });
    }

    type Scope = { kind: 'WHOLE_CHURCH' } | { kind: 'LEADER'; person_id: string };
    const report = async (
      scope: Scope,
      month: string,
    ): Promise<{ unique_people: number; open: boolean }> => {
      const { unique_people, open } =
        figure === 'CG'
          ? await this.reporting.cellMonthly(scope, month)
          : await this.reporting.dccMonthly(scope, month);
      return { unique_people, open };
    };

    // Every month's church report and each branch's, as one list of independent reads.
    type Ask = { month: string; key: string; scope: Scope };
    const asks = months.flatMap((month): Ask[] => [
      { month, key: 'church', scope: { kind: 'WHOLE_CHURCH' } },
      ...branches.map((id): Ask => ({ month, key: id, scope: { kind: 'LEADER', person_id: id } })),
    ]);
    const answers = await mapInTurns(asks, TREND_REPORTS_AT_ONCE, (ask) =>
      report(ask.scope, ask.month).catch(refusalAsNull),
    );

    return months.map((month) => {
      const own = asks.flatMap((ask, index) => (ask.month === month ? [index] : []));
      const church = answers[own[0]];
      // A month whose church report could not be read has no figure.
      if (church === null) {
        return null;
      }
      const values = new Map<string, number | null>();
      for (const index of own) {
        values.set(asks[index].key, answers[index]?.unique_people ?? null);
      }
      return { values, open: church.open };
    });
  }

  /** Names identities and orders them by first name, surname and Member ID, never by a figure. */
  private async namer(ids: readonly string[]): Promise<{
    person: (id: string) => { id: string; member_id: string | null; full_name: string | null };
    byName: (left: string, right: string) => number;
  }> {
    const identities = await this.people.forDecisions([...ids]);

    return {
      person: (id: string) => {
        const identity = identities.get(id);

        return { id, member_id: identity?.memberId ?? null, full_name: identity?.fullName ?? null };
      },
      byName: (left: string, right: string) => {
        const a = identities.get(left);
        const b = identities.get(right);

        // An unnamed identity sorts last, then by identifier, so the order is total.
        return a !== undefined && b !== undefined
          ? compareRosterKeys(a, b)
          : a !== undefined
            ? -1
            : b !== undefined
              ? 1
              : left.localeCompare(right);
      },
    };
  }

  /**
   * Checks the actor's reach at the instant a My 12 table was read, and names and orders its
   * rows (decisions 0214, 0254, 0293 and 0294).
   *
   * **The actor's reach is checked again at the instant the figures were read** (decision
   * 0214). The guard reads a month, and a week's month ends up to thirty days after the week
   * does, so a leader who joined the actor's subtree later in the month would otherwise be
   * readable for that week. Both checks must pass; the rows are named at the same instant.
   */
  private async nameTwelveRows(
    actor: Actor,
    scope:
      | { kind: 'LEADER'; person_id: string }
      | { kind: 'WHOLE_CHURCH' }
      | { kind: 'NETWORK'; network: NetworkName },
    at: Date,
    rows: readonly {
      leader_id: string;
      network: NetworkName | null;
      unique_people: number;
      classification: Classification;
      root_id?: string | null;
      root_network?: NetworkName | null;
    }[],
  ): Promise<Record<string, unknown>[]> {
    const [reaches] = await this.authorization.coversEach(actor, Capability.ReportsViewSubtree, [
      {
        kind: 'report_scope' as const,
        selector:
          scope.kind === 'LEADER'
            ? { kind: 'LEADER' as const, personId: scope.person_id }
            : scope.kind === 'NETWORK'
              ? { kind: 'NETWORK' as const, network: scope.network }
              : { kind: 'WHOLE_CHURCH' as const },
        at,
      },
    ]);
    if (!reaches) {
      throw new ScopeDeniedError('This report is outside your scope for the period asked.', {
        scope: scope.kind,
      });
    }
    const admitted = await this.authorization.coversEach(
      actor,
      Capability.ReportsViewSubtree,
      rows.map((row) => ({
        kind: 'report_scope' as const,
        selector: { kind: 'LEADER' as const, personId: row.leader_id },
        at,
      })),
    );
    const identities = await this.people.forDecisions(
      rows.filter((_, index) => admitted[index]).map((row) => row.leader_id),
    );

    return (
      rows
        .map((row, index) => {
          const identity = admitted[index] ? identities.get(row.leader_id) : undefined;

          return {
            key: identity === undefined ? null : rosterKeyOf(identity),
            network: row.network,
            rootNetwork: row.root_network ?? null,
            row: {
              ...(row.root_id === undefined || row.root_id === null
                ? {}
                : { root_id: row.root_id }),
              leader:
                identity === undefined
                  ? null
                  : {
                      id: row.leader_id,
                      member_id: identity.memberId,
                      full_name: identity.fullName,
                    },
              network: row.network,
              unique_people: row.unique_people,
              classification: row.classification,
            },
          };
        })
        // A whole-church reader's rows are labelled by Network, so they are in that order;
        // the Senior Pastors' rows are grouped by their root, the Men's first (decision 0326).
        .sort((left, right) =>
          networkOrder(left.rootNetwork) !== networkOrder(right.rootNetwork)
            ? networkOrder(left.rootNetwork) - networkOrder(right.rootNetwork)
            : left.key === null
              ? 1
              : right.key === null
                ? -1
                : left.network !== null && right.network !== null
                  ? left.network.localeCompare(right.network)
                  : compareRosterKeys(left.key, right.key),
        )
        .map((entry) => entry.row)
    );
  }

  /** The two roots a `ROOT_LEADERS` table's rows sit under, the Men's first, named with titles. */
  private async rootsOf(
    rows: readonly { root_id: string | null; root_network: NetworkName | null }[],
  ): Promise<{ id: string; full_name: string | null; network: NetworkName | null }[]> {
    const seen = new Map<string, NetworkName | null>();
    for (const row of rows) {
      if (row.root_id !== null && !seen.has(row.root_id)) {
        seen.set(row.root_id, row.root_network);
      }
    }
    const identities = await this.people.forDecisions([...seen.keys()]);

    return [...seen]
      .sort(([, left], [, right]) => networkOrder(left) - networkOrder(right))
      .map(([id, network]) => ({ id, full_name: identities.get(id)?.fullName ?? null, network }));
  }

  /**
   * A selector naming nobody answers `NOT_FOUND` (decision 0253), checked after the guard so
   * a narrower grant is refused whether or not the identifier names anybody.
   */
  /**
   * A report naming a leader merged away is the record kept's report (SKILL.md section 3,
   * decision 0408, point 22). The guard has resolved it the same way; this makes the figures
   * follow, by naming the record kept wherever the handler reads the leader.
   */
  private async readAsKept(query: { leader_id?: string }): Promise<void> {
    if (query.leader_id === undefined) {
      return;
    }
    const person = await this.people.forDecision(query.leader_id);
    if (person?.mergedIntoId) {
      query.leader_id = person.mergedIntoId;
    }
  }
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
              key: rosterKeyOf(identity),
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
      .sort((left, right) => compareRosterKeys(left.key, right.key));

    const after = decodeRosterCursor(page.cursor);
    const limit = page.limit ?? 50;
    const start = rosterStart(rest, (entry) => entry.key, after);
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

/**
 * How many of a Trends request's reports are read at once. Each holds a pool connection for
 * its transaction, so four leaves six of the pool's ten to other requests.
 */
const TREND_REPORTS_AT_ONCE = 4;

/** Men's before Women's, and a root with no seat last. */
function networkOrder(network: NetworkName | null): number {
  return network === 'MENS' ? 0 : network === 'WOMENS' ? 1 : 2;
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

/** A month's *Number of Cells* and *Number of people*, at the response boundary. */
function countFigures(figures: ChurchCountFigures): Record<string, number> {
  return {
    cell_groups: figures.cellGroups,
    youth: figures.youth,
    young_pro: figures.youngPro,
    couple: figures.couple,
    cell_leaders: figures.cellLeaders,
    people: figures.people,
  };
}

/**
 * Whether the Senior Pastors' tables were asked for (decision 0326). They are Whole Church's
 * figures with other rows, so any other selector is refused rather than quietly ignored.
 */
function rootLeadersAsked(rows: 'ROOT_LEADERS' | undefined, scope: string): boolean {
  if (rows === undefined) {
    return false;
  }
  if (scope !== 'WHOLE_CHURCH') {
    throw new ValidationFailedError(
      'rows=ROOT_LEADERS is offered with the Whole Church scope only.',
      {
        field: 'rows',
        value: rows,
      },
    );
  }
  return true;
}

/**
 * A month of *Trends* the API refuses to report, such as a placement graph section 20 refuses,
 * is a gap the screen names (decision 0257). Anything else is a fault and is not hidden.
 */
function refusalAsNull(error: unknown): null {
  if (error instanceof ApiError) {
    return null;
  }
  throw error;
}

/** The first of the month `offset` months from `month`, itself the first of a month. */
function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + offset, 1));

  return shifted.toISOString().slice(0, 10);
}
