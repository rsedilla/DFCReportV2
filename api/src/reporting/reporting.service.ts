import { Inject, Injectable } from '@nestjs/common';

import { DccFiguresService, type DccPersonFigures } from '../attendance/dcc-figures.service';
import { DATABASE, type Db } from '../database/database.module';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { reportingPeriodBounds } from './reporting-period';

/**
 * Which population a report covers. Section 20 enumerates four; two exist.
 *
 * `LEADER` names a Person, and the people it covers are that person's **placement**
 * subtree (decision 0206), not the tree in force at any one instant — which is a different
 * and wider set, and using the wrong one is a silent wrong total rather than an error.
 */
export type ReportScope = { kind: 'WHOLE_CHURCH' } | { kind: 'LEADER'; personId: string };

/** The five buckets of section 9's classification, in the order that section lists them. */
export interface DccClassification {
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
 * would be the mistake it warns about.
 */
export interface DccBucket {
  times: number;
  people: number;
  completed: boolean;
}

export interface DccMonthlyReport {
  scope: ReportScope;
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
  classification: DccClassification;
  buckets: DccBucket[];
}

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
    private readonly hierarchy: HierarchyService,
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
  async dccMonthly(scope: ReportScope, period: string): Promise<DccMonthlyReport> {
    const { start, end } = reportingPeriodBounds(period);

    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        // The placement graph, walked by the module that owns `pastoral_assignments`
        // (section 2, decision 0206). `undefined` rather than a list is Whole Church, and
        // the difference from an empty list is load-bearing: a leader with nobody beneath
        // them reports zero, which is not the same question as "everybody".
        const personIds =
          scope.kind === 'LEADER'
            ? await this.hierarchy.reportingSubtree(trx, scope.personId, start, end)
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
}

/**
 * Section 9's classification, from lifetime attendance standing at the end of the month.
 *
 * Every person in the population has attended at least once, so `lifetimeThroughMonth` is
 * never zero and no sixth bucket is reachable — which is what makes the five sum to the
 * total rather than merely tend to.
 */
function classify(figures: readonly DccPersonFigures[]): DccClassification {
  const counts: DccClassification = {
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
function bucket(figures: readonly DccPersonFigures[], n: number): DccBucket[] {
  if (n === 0) {
    return [];
  }

  const buckets: DccBucket[] = [];
  for (let times = 1; times <= n; times += 1) {
    buckets.push({
      times,
      people: figures.filter((person) => person.timesInMonth === times).length,
      completed: times === n,
    });
  }

  return buckets;
}
