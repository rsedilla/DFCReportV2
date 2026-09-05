import { Injectable } from '@nestjs/common';

import { DccFiguresService, type DccPersonFigures } from '../attendance/dcc-figures.service';

/**
 * Which population a report covers. Section 20 enumerates four; this is the one that
 * needs no tree walk, and the rest arrive with decision 0206's fallback.
 */
export type ReportScope = { kind: 'WHOLE_CHURCH' };

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
  period: string;
  n: number;
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
  constructor(private readonly dccFigures: DccFiguresService) {}

  /**
   * The DCC monthly report for a scope and a month (SKILL.md sections 9, 12 and 20).
   *
   * **Both views cover one population and both sum to it**, which is section 20's
   * reconciliation and Stage 5's exit criterion. That holds by construction here rather
   * than by arithmetic that happens to agree: the population is computed once, and each
   * view places every member of it in exactly one bucket.
   *
   * **Where the month holds no applicable events the population is empty and there are no
   * buckets.** Section 12 refuses a `Completed (0/0)` bucket on the ground that a bucket
   * every person satisfies is not a bucket, and the same reasoning governs a month with no
   * events: nobody could attend, so there is nothing to bucket rather than a row of zeroes.
   */
  async dccMonthly(scope: ReportScope, period: string): Promise<DccMonthlyReport> {
    const [n, figures] = await Promise.all([
      this.dccFigures.applicableEvents(period),
      this.dccFigures.monthlyFigures(period),
    ]);

    return {
      scope,
      period,
      n,
      uniquePeople: figures.length,
      classification: classify(figures),
      buckets: bucket(figures, n),
    };
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
 * comparing October against November needs the same columns in both. Nobody in the
 * population can fall outside the range — they attended at least once, and cannot attend
 * more events than the month holds — so the buckets sum to the population by construction.
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
