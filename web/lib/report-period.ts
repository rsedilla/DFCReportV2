'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { choosePeriod, latestFinished } from '@/lib/finished-periods';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { rangeGuardMonth, rangeStartOf, type RangeKind } from '@/lib/report-range';
import { monthFromQuery, todayInManila } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

const PERIOD_PARAM: Record<string, RangeKind> = {
  week: 'WEEK',
  quarter: 'QUARTER',
  year: 'YEAR',
};

/** Whose figures a report opens on: the reader's own scope (decisions 0294, 0326). */
export type OwnScope =
  | { kind: 'ROOT_LEADERS' }
  | { kind: 'WHOLE_CHURCH' }
  | { kind: 'LEADER'; person_id: string };

/**
 * Which period a My 12 report shows, shared by the Cell Groups and DCC reports, read from
 * the address so Back steps back through it and a reload opens the same figures.
 *
 * **Weekly, Monthly, Quarterly and Year are one rule on four lengths** (decision 0293). A
 * period that has not begun is not reported, so an address naming one opens the current
 * period instead (decision 0216). Without Reports at Whole Church, Quarterly and Year offer
 * finished periods only (decision 0310), so they wait to know who is reading, and read the
 * calendar's first Sunday from the reader's own last finished period: a leader they opened
 * may have left their branch since (decisions 0207 and 0214).
 *
 * Each report keeps its own figures, its own Figures for and its own tables. Until 2026-10-14
 * this was written out in both.
 */
export function useReportPeriod(
  report: 'cell-twelve' | 'dcc-twelve',
  probeFetch: (
    kind: RangeKind,
    start: string,
    guardMonth: string,
    own: OwnScope,
    signal: AbortSignal,
  ) => Promise<{ calendar_start: string | null }>,
) {
  const search = useSearchParams();
  const go = useScreenAddress();
  const today = todayInManila();

  const kind: RangeKind = PERIOD_PARAM[search.get('period') ?? ''] ?? 'MONTH';
  const current = rangeStartOf(kind, today);

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');
  // The two Senior Pastors' rows are both roots' direct leaders (decision 0326), named by the
  // server's screens and never by a role.
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const finishedKind = kind === 'QUARTER' || kind === 'YEAR' ? kind : null;
  const finishedOnly = finishedKind !== null && me.data !== undefined && !wholeChurch;
  const latest = latestFinished(kind, today);

  const own: OwnScope | null = seniorPastor
    ? { kind: 'ROOT_LEADERS' }
    : wholeChurch
      ? { kind: 'WHOLE_CHURCH' }
      : me.data
        ? { kind: 'LEADER', person_id: me.data.person_id }
        : null;

  const probe = useQuery({
    queryKey: [report, kind, latest, own],
    queryFn: ({ signal }) =>
      probeFetch(kind, latest, rangeGuardMonth(kind, latest, today), own!, signal),
    enabled: finishedOnly && own !== null,
  });
  const chosen =
    finishedKind === null
      ? null
      : me.data === undefined
        ? ({ ready: false } as const)
        : choosePeriod(
            finishedKind,
            today,
            search.get('start'),
            finishedOnly,
            finishedOnly ? probe.data?.calendar_start : null,
          );
  const reach = chosen?.ready ? chosen.reach : null;
  const periodReady = chosen === null || (chosen.ready && chosen.start !== null);
  const asked =
    kind === 'MONTH'
      ? monthFromQuery(search.get('month'))
      : rangeStartOf(kind, search.get('start') ?? current);
  const start =
    chosen === null
      ? asked > current
        ? current
        : asked
      : chosen.ready && chosen.start !== null
        ? chosen.start
        : latest;

  return {
    kind,
    current,
    me,
    wholeChurch,
    seniorPastor,
    finishedKind,
    chosen,
    reach,
    periodReady,
    start,
    guardMonth: rangeGuardMonth(kind, start, today),
    own,
    probe,
    /** The address of this period, with anything else the link adds. */
    periodParams: (extra: Record<string, string>) =>
      new URLSearchParams({
        ...(kind === 'MONTH' ? { month: start } : { period: kind.toLowerCase(), start }),
        ...extra,
      }).toString(),
    /** Another length, from its first period. */
    choosePeriodKind: (value: RangeKind) =>
      go({ period: value === 'MONTH' ? null : value.toLowerCase(), start: null, month: null }),
    /** Another period of the same length. */
    choosePeriodStart: (value: string) => go(kind === 'MONTH' ? { month: value } : { start: value }),
  };
}
