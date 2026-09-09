import { Inject, Injectable } from '@nestjs/common';

import { CellFiguresService, type CellFiguresPopulation } from '../attendance/cell-figures.service';
import { DccCoverageService, type DccCoverageScope } from '../attendance/dcc-coverage.service';
import { DccFiguresService } from '../attendance/dcc-figures.service';
import { CellsReadService } from '../cells/cells.read.service';
import { endOfManilaDay } from '../common/time/manila';
import { canonicalId } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import type { Database, NetworkName } from '../database/schema';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';

import type { Transaction } from 'kysely';
import {
  assertReportingMonth,
  assertReportingPeriodHasBegun,
  reportingPeriodBounds,
  type ReportingPeriod,
} from '../common/time/reporting-period';

/**
 * Which population a report covers. Section 20 enumerates four, and all four now exist.
 *
 * `LEADER` names a Person, and the people it covers are that person's **placement**
 * subtree (decision 0206), not the tree in force at any one instant — which is a different
 * and wider set, and using the wrong one is a silent wrong total rather than an error.
 */
export type ReportScope =
  | { kind: 'WHOLE_CHURCH' }
  /**
   * A Network, whose population is its **membership** and never its root's subtree
   * (decision 0219). Section 4 requires the relationship to be stored rather than derived;
   * the two readings differ by anybody whose pastoral chain terminates outside the tree,
   * and it is that difference which makes Men's + Women's equal Whole Church — while every
   * person holds one Network row at the instant, which is an open question rather than a
   * constraint (`CLAUDE.md`).
   */
  | { kind: 'NETWORK'; network: NetworkName }
  | { kind: 'LEADER'; person_id: string }
  /**
   * One Cell. The only scope at which section 12 permits monthly-attendance buckets, and
   * the reason that section exists in the shape it does.
   */
  | { kind: 'CELL'; cell_id: string };

/**
 * The scopes each domain's monthly report admits, as types rather than as a check.
 *
 * **Section 20's enumeration is one list and the two domains take different subsets of
 * it**, so a route handing the wrong scope to the wrong report fails to compile rather
 * than being refused at runtime by a DTO nobody has to keep in step.
 *
 * **DCC excludes `CELL`**: section 20 attributes every DCC figure by the *person*, and a
 * Cell is not a population that key runs over — `report_snapshots.scope_type` enumerates
 * `CELL` for the Cell domain, and section 12 puts the bucket views it exists for there.
 *
 * **Cells exclude `NETWORK`**, and that is a deferral rather than a rule. Section 20 says
 * a Network narrows "which people the *person* key runs over"; the Cell domain does not
 * use that key, attributing instead by the meeting's responsible leader — so what a
 * `NETWORK`-scoped *Cell* figure narrows is genuinely unstated, and it is recorded as open
 * in `CLAUDE.md` rather than decided here. The DCC route shipped without `NETWORK` for the
 * same reason and gained it with decision 0219.
 */
export type DccReportScope = Exclude<ReportScope, { kind: 'CELL' }>;
export type CellReportScope = Exclude<ReportScope, { kind: 'NETWORK' }>;

/**
 * The five classification buckets, in the order sections 9 and 12 list them.
 *
 * **One type for both domains because the ladder is identical** — first attendance is a
 * VIP, fifth and beyond is a Regular — while the *journeys* are separate and are counted
 * separately: section 12 says a person may be "DCC Regular and Cell 2nd Timer, or vice
 * versa". What is shared is the mapping from a lifetime count to a bucket, and it would
 * stop being shareable the moment either section changed its own ladder.
 */
export interface Classification {
  vip: number;
  second_timer: number;
  third_timer: number;
  fourth_timer: number;
  regular: number;
}

/**
 * One monthly-attendance bucket. `completed` is `times === n`, carried rather than left
 * for a caller to recompute — section 9 is explicit that `Completed` means every
 * applicable event and is never a fixed number, and a client comparing against 4 or 5
 * would be the mistake it warns about. Section 12 says the same of a Cell in its own
 * words: "Never label buckets from the calendar count."
 */
export interface AttendanceBucket {
  times: number;
  people: number;
  completed: boolean;
}

export interface DccMonthlyReport {
  scope: DccReportScope;
  /** The reporting month, as the first of it — this repository's one spelling of a month. */
  period: string;
  /**
   * Whether the month is still open for submission.
   *
   * Section 17 requires a report to say so, "because an open month's coverage figure is
   * still changing". It is load-bearing beside `n`, which counts the calendar rows a month
   * holds whether or not their day has passed (section 9) — mid-month, somebody who came to
   * both Sundays so far reads as two of three, and only this says why.
   */
  open: boolean;
  n: number;
  /**
   * The Sundays of this month the calendar holds but that carried no service.
   *
   * Section 9 requires a removal to be visible on any report covering the month, "so that a
   * month showing four events where the calendar shows five is explained rather than merely
   * odd". `n` on its own cannot explain itself.
   */
  removed_events: string[];
  unique_people: number;
  classification: Classification;
  buckets: AttendanceBucket[];
  /**
   * The month's recording coverage: obligations met over obligations owed, summed across
   * the month's events (section 9, decision 0224).
   *
   * **Two figures, never divided into a percentage or a score** (section 13). They are
   * carried separately for that reason rather than for the caller's convenience — a ratio
   * is a leader's score, and section 13 forbids one.
   *
   * **It is not a property of the population above.** Classification and the buckets
   * attribute by the *person*, placed as of the period's end; coverage attributes by the
   * *obligation*, placed at each event date (section 20). So a leader whose subtree
   * attended nothing still owes records, and the two halves of this response answer
   * different questions about different parties. Neither section 20 identity ranges over
   * coverage.
   *
   * `0 of 0` is a real answer and is rendered rather than suppressed (decision 0224).
   */
  coverage: Coverage;
}

/** Obligations met over obligations owed (section 9, decision 0224). Never divided. */
export interface Coverage {
  met: number;
  owed: number;
}

/** What every Cell monthly report carries, whatever its scope (sections 12 and 20). */
interface CellMonthlyCommon {
  /** The reporting month, as the first of it — this repository's one spelling of a month. */
  period: string;
  /**
   * Whether the month is still open for submission (sections 13 and 17).
   *
   * Section 17 requires a report to say so. It matters more here than for DCC: a Cell's
   * `n` counts what has been *recorded*, so mid-month it grows as leaders submit, and a
   * bucket labelled `Completed (2/2)` on the 10th is not the same claim as one labelled
   * `Completed (4/4)` on the 8th of the following month.
   */
  open: boolean;
  unique_people: number;
  classification: Classification;
  /**
   * The month's recording coverage: meetings recorded over meetings scheduled
   * (section 12, decisions 0202 and 0225).
   *
   * **Present at every scope, unlike the buckets.** Decision 0202 settles that unique
   * people, classification and coverage are the whole of an aggregate view and that
   * coverage *leads* it — the buckets are absent above Cell scope because `N` belongs to
   * a Cell, and coverage has no such problem: its denominator is derived from the
   * schedule rather than self-reported, which is section 12's own reason for putting it
   * first.
   *
   * **Two figures, never divided** (section 13). Field names match the Cells index, so
   * one concept keeps one field name across endpoints (section 22); they differ from the
   * DCC line's `met` and `owed` because they are a different figure, counting scheduled
   * meetings rather than obligations.
   *
   * **A Cell that scheduled nothing contributes zero to both terms** (decision 0225), and
   * that is the whole of what these two figures can carry. It produces no scheduled pair
   * at all, so it is not *in* the set this is computed over — which is arithmetically
   * indistinguishable from being in it and contributing zero, and is why nothing here can
   * tell the two apart. **Decision 0225's other half is not implemented and is not
   * implementable in a two-figure aggregate**: it asks that the denominator's
   * *membership* name every Cell a leader holds rather than every Cell that happened to
   * have a schedule. Decision 0225 states the reason separately, under what it rejected:
   * "A figure and the list that explains it must be over the same set."
   * There is no list here. The first per-Cell breakdown placed beside this figure is what
   * owes that, and it is the surface that will have to name such a Cell explicitly.
   */
  coverage: CellCoverage;
}

/** Meetings recorded over meetings scheduled (section 12). Never divided. */
export interface CellCoverage {
  recorded: number;
  scheduled: number;
}

/**
 * A Cell monthly report, shaped so that section 12's one hard structural rule cannot be
 * broken by a caller: **bucket views exist at Cell scope only**.
 *
 * The aggregate arm carries no `n` and no `buckets` at all, rather than carrying empty
 * ones. Section 12 gives the reason at length — `N` belongs to a Cell, so an aggregate
 * `Completed` would mean "attended everything their own Cell happened to record" and is
 * inflated by exactly the Cells that recorded least — and decision 0202 settles that
 * nothing replaces them: unique people, classification and coverage are the whole of an
 * aggregate view, and all three ship. Coverage is the one that view leads with, and it is
 * the only one of the three that survives having no `N` to measure against.
 */
export type CellMonthlyReport =
  | (CellMonthlyCommon & {
      scope: Extract<CellReportScope, { kind: 'CELL' }>;
      /** The meetings actually recorded for this Cell in the month (section 12). */
      n: number;
      buckets: AttendanceBucket[];
    })
  | (CellMonthlyCommon & {
      scope: Exclude<CellReportScope, { kind: 'CELL' }>;
    });

/**
 * Composes what the owning modules compute (decision 0206).
 *
 * `reporting` owns `report_snapshots` and `notifications` and roots no query anywhere
 * else, so every figure here arrives through another module's service interface. What
 * this class contributes is the bucketing and the section 20 identities — arithmetic over
 * numbers already counted, not a second query.
 */
@Injectable()
export class ReportingService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly dccFigures: DccFiguresService,
    private readonly dccCoverage: DccCoverageService,
    private readonly cellFigures: CellFiguresService,
    /**
     * The two halves of section 12's coverage line, from the two modules that own them
     * (section 2): the denominator from `cells`, whose tables derive it, and the
     * numerator from `attendance`, which owns `cell_meetings`.
     */
    private readonly cells: CellsReadService,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
  ) {}

  /**
   * The DCC monthly report for a scope and a month (SKILL.md sections 9, 12 and 20).
   *
   * **Both views cover one population and both sum to it**, which is section 20's
   * reconciliation and Stage 5's exit criterion. That holds by construction rather than by
   * arithmetic that happens to agree, and the construction is now two things rather than
   * one. `n` and the population still come from a single statement, so they cannot describe
   * two states of the calendar. *A first version took them with `Promise.all` on a pooled
   * connection, which is two snapshots: a Sunday removed between them yields a person whose
   * `timesInMonth` exceeds `n` and who then falls outside every bucket. The docblocks
   * asserted "by construction" over code that did not have it.*
   *
   * **And the whole report is one `READ ONLY REPEATABLE READ` transaction** (decision 0210),
   * which is what carries the identity *between* modules. A leader-scoped report is two
   * statements by construction — section 2 puts the tree walk in `hierarchy` and the figures
   * in `attendance`, and neither may root a query in the other's tables — and at section 24's
   * `READ COMMITTED` each statement takes its own snapshot even inside a transaction. So a
   * reassignment committing between the walk and the count would give a population and a set
   * of figures describing two trees. The isolation level is set **per transaction**; changing
   * `default_transaction_isolation` would break the three lock-then-decide mechanisms section
   * 24 names, and this must never be read as licence to do that.
   *
   * **Where the month holds no applicable events the population is empty and there are no
   * buckets.** Section 12 refuses a `Completed (0/0)` bucket on the ground that a bucket
   * every person satisfies is not a bucket, and the same reasoning governs a month with no
   * events: nobody could attend, so there is nothing to bucket rather than a row of zeroes.
   */
  async dccMonthly(scope: DccReportScope, period: string): Promise<DccMonthlyReport> {
    return this.overPeriod(period, async (trx, { start, end }) => {
      // **Each narrower scope is computed by the module that owns the rows it reads**
      // (section 2, decision 0206): `hierarchy` walks the placement graph for a leader,
      // `networks` reads membership for a Network. `reporting` composes and roots no query
      // of its own.
      //
      // `undefined` rather than a list is Whole Church, and the difference from an empty
      // list is load-bearing: a scope holding nobody reports zero, which is not the same
      // question as "everybody".
      //
      // **A Network takes `end` and not the period**, because its population is membership
      // at an instant rather than a graph collapsed over a span (decision 0219). The two
      // arguments differ in kind for that reason, not by oversight.
      const personIds =
        scope.kind === 'LEADER'
          ? await this.hierarchy.reportingSubtree(trx, scope.person_id, start, end)
          : scope.kind === 'NETWORK'
            ? await this.networks.peopleInNetworkAsOf(trx, scope.network, end)
            : undefined;

      const figures = await this.dccFigures.monthFigures(period, { executor: trx, personIds });

      // **Coverage takes the scope rather than `personIds`, and that is section 20 rather
      // than an inconsistency.** The population above is the placement graph collapsed
      // over the period, which is where a *person* is counted; a coverage denominator is
      // a subtree walked at each event date, which is where an *obligation* sits. Handing
      // `personIds` here would measure this month's obligations against the tree as it
      // stood at the period's end, and a leader assigned in the third week would owe
      // records for the first two.
      const coverage = await this.dccCoverage.monthCoverage(period, coverageScopeOf(scope), {
        executor: trx,
      });

      return {
        scope,
        period,
        open: figures.open,
        n: figures.n,
        removed_events: figures.removed,
        unique_people: figures.people.length,
        classification: classify(figures.people),
        buckets: bucket(figures.people, figures.n),
        coverage,
      };
    });
  }

  /**
   * The Cell monthly report for a scope and a month (SKILL.md sections 12 and 20).
   *
   * **Its population is attributed differently from the DCC report beside it, and that is
   * section 20 rather than an implementation choice.** DCC attributes by the *person*,
   * placed in the tree as of the period's end. A Cell figure attributes by "the meeting's
   * responsible leader, frozen as of the meeting date" — so a leader-scoped Cell report
   * selects the *meetings* run by anyone in their subtree, and then counts whoever attended
   * those meetings, whatever each attendee's own pastoral placement is. Section 12 states
   * the same rule from the other side: a Cell report "is not resolved through the pastoral
   * leader of each individual member, who may differ".
   *
   * The consequence is worth naming because it looks like a bug: a leader's Cell report can
   * contain people who are in no part of that leader's subtree. That is correct. Cell
   * membership need not mirror pastoral assignment (section 10), and the report is about
   * the meetings that leader is answerable for.
   *
   * **Both section 20 identities hold, and the second only at Cell scope.** Classification
   * sums to the unique-people total at every scope, because it carries no denominator.
   * The buckets sum to it only where they exist, which is Cell scope — the return type
   * carries that rather than a comment, since an aggregate arm with no `n` cannot be
   * bucketed by anybody.
   *
   * **One `READ ONLY REPEATABLE READ` transaction, through the same seam** (decision 0210):
   * a leader-scoped report walks the tree in `hierarchy` and counts in `attendance`, which
   * is two statements by construction (section 2), and at section 24's `READ COMMITTED`
   * they would otherwise describe two states of the database.
   */
  async cellMonthly(scope: CellReportScope, period: string): Promise<CellMonthlyReport> {
    return this.overPeriod(period, async (trx, { start, end }) => {
      // **The owning module computes and `reporting` composes** (section 2, decision 0206).
      // `hierarchy` walks the placement graph for a leader; the Cell and Whole Church
      // scopes need no walk at all, because `cell_meetings` carries both the Cell and the
      // frozen responsible leader as its own columns.
      //
      // **The subtree is handed over as `RESPONSIBLE_LEADERS` rather than as a population**,
      // which is the whole difference from `dccMonthly` above: the same walk, feeding a
      // different key.
      //
      // **Cell scope returns from its own branch** rather than from a check on what came
      // back, so `n` and the buckets exist exactly where the scope asked for them. The
      // figures service is overloaded on the population, which is what makes that a
      // compiler guarantee rather than a convention here.
      if (scope.kind === 'CELL') {
        const figures = await this.cellFigures.monthFigures(
          period,
          { kind: 'CELL', cellId: scope.cell_id },
          { executor: trx },
        );

        return {
          scope,
          period,
          open: figures.open,
          n: figures.n,
          unique_people: figures.people.length,
          classification: classify(figures.people),
          buckets: bucket(figures.people, figures.n),
          coverage: await this.cellCoverage(trx, period, scope),
        };
      }

      const population: Exclude<CellFiguresPopulation, { kind: 'CELL' }> =
        scope.kind === 'LEADER'
          ? {
              kind: 'RESPONSIBLE_LEADERS',
              personIds: await this.hierarchy.reportingSubtree(trx, scope.person_id, start, end),
            }
          : { kind: 'EVERY_CELL' };

      const figures = await this.cellFigures.monthFigures(period, population, { executor: trx });

      return {
        scope,
        period,
        open: figures.open,
        unique_people: figures.people.length,
        classification: classify(figures.people),
        // Decision 0202: coverage is the figure an aggregate view leads with, and the
        // only one of the three that survives having no `N` to measure against.
        coverage: await this.cellCoverage(trx, period, scope),
      };
    });
  }

  /**
   * The month's Cell coverage over a scope: meetings recorded over meetings scheduled
   * (SKILL.md sections 12, 13 and 20; decisions 0221 and 0225).
   *
   * **Composed rather than queried** (section 2, decision 0206). The denominator is
   * `cells`' — section 2 assigns it there by name, "whose every input (`cell_schedules`,
   * `cells`, `cell_leaderships`) it owns" — and the numerator is `attendance`'s, because
   * `cell_meetings` is its table. Neither module may root a query in the other's, so what
   * happens here is arithmetic over two sets, which is exactly what this class contributes.
   *
   * **Both terms are attributed by the same leader**, the one who led the Cell on the
   * scheduled date, and the numerator is an *intersection* with the denominator rather
   * than a second count. That is what makes `recorded` at most `scheduled` by
   * construction: two independent counts could disagree about which meetings they were
   * counting, and a coverage line whose numerator exceeded its denominator would be a
   * defect a reader meets as `5 of 4`.
   *
   * **The subtree is walked once per scheduled date, and that is section 20 rather than
   * an optimisation detail.** Coverage places its own party at its own instant — for a
   * Cell "the leader who led the Cell on the scheduled date" — and decision 0221
   * deliberately left that alone when it settled the neighbouring key. So this is
   * `subtreeAsOf`, not `reportingSubtree`: the latter is the placement graph collapsed
   * over the period, which is what the *unique people* figure in the same response uses.
   * Two different walks in one report is what section 20 requires in terms, and using the
   * period walk here would place a leader by where they ended the month rather than by
   * where they stood when the meeting was due.
   *
   * **A pair whose leader is null counts church-wide and in no subtree.** It should not
   * arise — a Cell's schedule and leadership open and close together — and it is carried
   * rather than dropped because dropping it would shrink the denominator, which section 12
   * says a coverage figure must never do. It is counted at `CELL` and `WHOLE_CHURCH`
   * scope and in no `LEADER` one.
   *
   * *No section 20 residual is cited for it, and an earlier version cited one. Section 20
   * generalised its two fallbacks to reach the responsible-leader key and then said in
   * terms that "coverage is not settled by that generalisation", touching "neither
   * instant, nor those fallbacks' application to either" — so borrowing a residual from
   * there is borrowing a rule that section declines to lend. What this branch rests on is
   * section 12 alone: never shrink the denominator.*
   */
  private async cellCoverage(
    trx: Transaction<Database>,
    period: string,
    scope: CellReportScope,
  ): Promise<CellCoverage> {
    // Sequential rather than `Promise.all`, matching the DCC line. The two reads are
    // inside the report's own transaction (decision 0210), which is one connection, so
    // there is nothing to win and the driver would serialise them anyway. The paragraph
    // above records what a `Promise.all` cost this module once, on a *pooled* connection
    // where it really was two snapshots; writing it the same way here would invite a
    // reader to check whether this is that mistake again.
    const pairs = await this.cells.scheduledMeetingsWithLeaderIn(trx, period);
    const recorded = await this.cellFigures.recordedScheduledDatesIn(trx, period);

    const inScope = await this.scheduledPairsInScope(trx, pairs, scope);

    return {
      scheduled: inScope.length,
      recorded: inScope.filter((pair) => recorded.has(`${pair.cellId}|${pair.scheduledDate}`))
        .length,
    };
  }

  /**
   * The scheduled meetings a scope reaches.
   *
   * `CELL` narrows by the Cell itself, which makes section 20's attribution vacuous —
   * every pair belongs to the one Cell asked for. `WHOLE_CHURCH` narrows nothing.
   * `LEADER` narrows by whether the scheduled-date leader stood in the actor's subtree
   * **on that date**, which is one walk per distinct date rather than one per pair.
   */
  private async scheduledPairsInScope(
    trx: Transaction<Database>,
    pairs: readonly { cellId: string; scheduledDate: string; leaderId: string | null }[],
    scope: CellReportScope,
  ): Promise<readonly { cellId: string; scheduledDate: string }[]> {
    if (scope.kind === 'CELL') {
      return pairs.filter((pair) => canonicalId(pair.cellId) === canonicalId(scope.cell_id));
    }

    if (scope.kind === 'WHOLE_CHURCH') {
      return pairs;
    }

    const subtrees = new Map<string, Set<string>>();
    for (const date of new Set(pairs.map((pair) => pair.scheduledDate))) {
      const members = await this.hierarchy.subtreeAsOf(trx, scope.person_id, endOfManilaDay(date));

      subtrees.set(date, new Set(members.map(canonicalId)));
    }

    return pairs.filter(
      (pair) =>
        pair.leaderId !== null &&
        (subtrees.get(pair.scheduledDate)?.has(canonicalId(pair.leaderId)) ?? false),
    );
  }

  /**
   * The one way a report reads the database, and the reason it is a seam rather than a
   * convention.
   *
   * **Every rule a report owes its period is applied here, once.** A report validates the
   * month's shape (decision 0185), refuses a period that has not begun (decision 0216), and
   * computes inside a single `READ ONLY REPEATABLE READ` transaction (decision 0210). Those
   * were three statements at the top of the one report that exists, which made each of them
   * a thing the *next* report route has to remember -- and section 22 names five report
   * routes, of which one is built. Nothing would have reddened for the second route
   * omitting any of the three: not a test, not a derivation, not a type.
   *
   * That is the one-rule-one-path shape `CLAUDE.md` records against this project more often
   * than any other, and it is closed by something that fails rather than by a convention:
   * `test/unit/reporting-transaction-seam.spec.ts` parses this module and asserts that
   * **every public member of every class in it that is not a `@Controller` calls this
   * method on its own body**, that the module opens one transaction and touches the pool
   * once, and that all three rules are applied here. Members rather than methods, and a
   * call rather than a mention: three earlier versions of that check missed an arrow-valued
   * field, a provider carrying no `@Injectable`, and a seam call appearing only in a
   * comment. It carries a fixture for each.
   *
   * **The public-surface claim is the load-bearing one**, and the transaction ones are not
   * enough on their own. The idiomatic second report method opens no transaction and names
   * no pool at all -- `reporting` composes what the owning modules compute (decision 0206),
   * so it calls a figures service whose executor is optional and defaults to the pool. Such
   * a method applies none of the three rules, compiles clean, and left the transaction
   * assertions green when `architecture-guardian` ran them against one.
   *
   * **What still is not reached**, so this is not read as wider than it is: a callback is
   * handed `trx` and nothing compels it to use it, for that same reason. A report ignoring
   * `trx` would take two snapshots and lose decision 0210's identity -- the defect that
   * shipped once already, under two docblocks claiming "by construction" over code that did
   * not have it.
   *
   * *Found by `architecture-guardian` on decision 0216, which shipped the rule with one call
   * site and nothing able to fail on a second; again on the fix, which claimed a report
   * "cannot" bypass the seam while nothing stopped one; again on the check written to close
   * that, which only ever saw a report that opened a transaction; and again on the check
   * written to close **that**, which asked whether the method's text contained the seam's
   * name. Four passes, each finding the previous fix had reproduced the shape it removed.*
   *
   * The bounds are handed to the callback rather than re-derived inside it, which keeps this
   * method and its callback from drifting apart. It buys nothing against the **guard**, which
   * never receives them: the guard calls `reportingPeriodBounds` itself, on its own
   * connection, before this transaction opens. What makes those two the same instant is that
   * both import one function from `common/time` -- which is what decision 0214 means by
   * **the same** being a property of sharing one derivation rather than of two agreeing.
   *
   * *A first version of this sentence credited the hand-off with the guard's agreement. Had
   * the callback re-derived the bounds with the same helper, the value would be identical.*
   */
  private async overPeriod<T>(
    period: string,
    compute: (trx: Transaction<Database>, bounds: ReportingPeriod) => Promise<T>,
  ): Promise<T> {
    // **Refused before anything is derived from it.** `reportingPeriodBounds` validates
    // nothing and will happily build `2020-14-01` out of `2020-13-01`, so a malformed month
    // reaching it is answered by the *date* helper, naming a field the caller never sent and
    // quoting a month it never wrote. Section 22 requires the refusal to name the field a
    // client needs in order to fix it, and that field is `period`.
    assertReportingMonth(period);

    const bounds = reportingPeriodBounds(period);

    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        // **First in the transaction, before anything is walked** (decision 0216). A period
        // that has not begun can hold no attendance record (section 9), and answering it
        // would return a complete report saying nobody attended anything -- the calendar
        // runs thirteen months ahead, so `n` and the coverage denominator are real. The
        // clock is the database's, which is where every month boundary in this system is
        // decided. Authorization has already run in the guard, so a scope the actor does
        // not hold is still answered `SCOPE_DENIED` first (section 7, decision 0193).
        await assertReportingPeriodHasBegun(trx, period);

        return compute(trx, bounds);
      });
  }
}

/**
 * A report's DCC selector as the coverage denominator narrows by (decision 0230).
 *
 * **A translation rather than a shared type**, because the two mean different things by
 * the same three words. A report's selector is resolved once, for authorization, at the
 * period's end; a coverage scope is resolved again at every event date. Writing this out
 * is what keeps the second resolution visible instead of implied by a cast.
 *
 * **Exhaustive, so a fourth report scope cannot reach coverage without deciding what it
 * narrows.** That is not hypothetical: `NETWORK` reached this route with the person key
 * settled and its coverage narrowing unstated, which is the gap decision 0230 was
 * escalated to fill. The `never` binding makes the compiler ask the question next time.
 */
function coverageScopeOf(scope: DccReportScope): DccCoverageScope {
  switch (scope.kind) {
    case 'WHOLE_CHURCH':
      return { kind: 'WHOLE_CHURCH' };
    case 'NETWORK':
      return { kind: 'NETWORK', network: scope.network };
    case 'LEADER':
      return { kind: 'LEADER', personId: scope.person_id };
    default: {
      const unreached: never = scope;

      return unreached;
    }
  }
}

/**
 * Section 9's classification, from lifetime attendance standing at the end of the month.
 *
 * Every person in the population has attended at least once, so `lifetimeThroughMonth` is
 * never zero and no sixth bucket is reachable — which is what makes the five sum to the
 * total rather than merely tend to.
 */
function classify(figures: readonly { lifetimeThroughMonth: number }[]): Classification {
  const counts: Classification = {
    vip: 0,
    second_timer: 0,
    third_timer: 0,
    fourth_timer: 0,
    regular: 0,
  };

  for (const person of figures) {
    switch (person.lifetimeThroughMonth) {
      case 1:
        counts.vip += 1;
        break;
      case 2:
        counts.second_timer += 1;
        break;
      case 3:
        counts.third_timer += 1;
        break;
      case 4:
        counts.fourth_timer += 1;
        break;
      default:
        counts.regular += 1;
    }
  }

  return counts;
}

/**
 * Section 9's monthly-attendance buckets, derived from N.
 *
 * **Buckets run 1..N and are emitted whether or not anybody is in them**, because the
 * shape of the view is a property of the month rather than of who turned up: a reader
 * comparing October against November needs the same columns in both.
 *
 * **Nobody in the population falls outside the range**, which is what makes the buckets sum
 * to it. The lower bound is that they attended at least once. The upper bound is
 * `dcc_attendance_one_live`, which permits one live row per person per event, so a person's
 * count of applicable events in the month cannot exceed the number the month holds — and
 * that reasoning only holds because both figures are read in one statement.
 */
function bucket(figures: readonly { timesInMonth: number }[], n: number): AttendanceBucket[] {
  if (n === 0) {
    return [];
  }

  const buckets: AttendanceBucket[] = [];
  for (let times = 1; times <= n; times += 1) {
    buckets.push({
      times,
      people: figures.filter((person) => person.timesInMonth === times).length,
      completed: times === n,
    });
  }

  return buckets;
}
