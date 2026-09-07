import { Inject, Injectable } from '@nestjs/common';

import { CellFiguresService, type CellFiguresPopulation } from '../attendance/cell-figures.service';
import { DccFiguresService } from '../attendance/dcc-figures.service';
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
  | { kind: 'LEADER'; personId: string }
  /**
   * One Cell. The only scope at which section 12 permits monthly-attendance buckets, and
   * the reason that section exists in the shape it does.
   */
  | { kind: 'CELL'; cellId: string };

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
  secondTimer: number;
  thirdTimer: number;
  fourthTimer: number;
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
  removedEvents: string[];
  uniquePeople: number;
  classification: Classification;
  buckets: AttendanceBucket[];
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
  uniquePeople: number;
  classification: Classification;
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
 * aggregate view. Coverage is not computed yet and is the figure that view leads with, so
 * what ships here is two of the three.
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
    private readonly cellFigures: CellFiguresService,
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
          ? await this.hierarchy.reportingSubtree(trx, scope.personId, start, end)
          : scope.kind === 'NETWORK'
            ? await this.networks.peopleInNetworkAsOf(trx, scope.network, end)
            : undefined;

      const figures = await this.dccFigures.monthFigures(period, { executor: trx, personIds });

      return {
        scope,
        period,
        open: figures.open,
        n: figures.n,
        removedEvents: figures.removed,
        uniquePeople: figures.people.length,
        classification: classify(figures.people),
        buckets: bucket(figures.people, figures.n),
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
          { kind: 'CELL', cellId: scope.cellId },
          { executor: trx },
        );

        return {
          scope,
          period,
          open: figures.open,
          n: figures.n,
          uniquePeople: figures.people.length,
          classification: classify(figures.people),
          buckets: bucket(figures.people, figures.n),
        };
      }

      const population: Exclude<CellFiguresPopulation, { kind: 'CELL' }> =
        scope.kind === 'LEADER'
          ? {
              kind: 'RESPONSIBLE_LEADERS',
              personIds: await this.hierarchy.reportingSubtree(trx, scope.personId, start, end),
            }
          : { kind: 'EVERY_CELL' };

      const figures = await this.cellFigures.monthFigures(period, population, { executor: trx });

      return {
        scope,
        period,
        open: figures.open,
        uniquePeople: figures.people.length,
        classification: classify(figures.people),
      };
    });
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
 * Section 9's classification, from lifetime attendance standing at the end of the month.
 *
 * Every person in the population has attended at least once, so `lifetimeThroughMonth` is
 * never zero and no sixth bucket is reachable — which is what makes the five sum to the
 * total rather than merely tend to.
 */
function classify(figures: readonly { lifetimeThroughMonth: number }[]): Classification {
  const counts: Classification = {
    vip: 0,
    secondTimer: 0,
    thirdTimer: 0,
    fourthTimer: 0,
    regular: 0,
  };

  for (const person of figures) {
    switch (person.lifetimeThroughMonth) {
      case 1:
        counts.vip += 1;
        break;
      case 2:
        counts.secondTimer += 1;
        break;
      case 3:
        counts.thirdTimer += 1;
        break;
      case 4:
        counts.fourthTimer += 1;
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
