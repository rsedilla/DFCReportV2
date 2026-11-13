'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { getMe, holdsNetwork, holdsWholeChurch } from '@/lib/me';
import { rangeGuardMonth, rangeStartOf, type RangeKind } from '@/lib/report-range';
import { monthFromQuery, todayInManila } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

/** The two lengths a report is read by; Yearly is its own screen (decision 0443). */
export type ReportKind = Extract<RangeKind, 'WEEK' | 'MONTH'>;

/** Whose figures a report opens on: the reader's own scope (decisions 0294, 0326). */
export type OwnScope =
  | { kind: 'ROOT_LEADERS' }
  | { kind: 'WHOLE_CHURCH' }
  | { kind: 'NETWORK'; network: 'MENS' | 'WOMENS' }
  | { kind: 'LEADER'; person_id: string };

/**
 * Which period a My 12 report shows, shared by the Cell Groups and DCC reports, read from
 * the address so Back steps back through it and a reload opens the same figures.
 *
 * **Weekly and Monthly, for every reader but the two Senior Pastors, who have Monthly alone**
 * (decisions 0443 and 0485): Yearly is the last 12 months, a
 * screen of its own, and the quarter and the calendar year are withdrawn, so an address naming
 * either, kept from before, opens the month instead. A period that has not begun is not
 * reported, so an address naming one opens the current period instead (decision 0216).
 *
 * Each report keeps its own figures, its own Figures for and its own tables. Until 2026-10-14
 * this was written out in both.
 */
export function useReportPeriod() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const today = todayInManila();

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');
  // A Network Admin's reports are the Admin's for their own Network (decision 0469).
  const ownNetwork = holdsNetwork(me.data, 'reports.view_subtree');
  // The two Senior Pastors' rows are both roots' direct leaders (decision 0326), named by the
  // server's screens and never by a role.
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  // The Senior Pastors read by month alone (decision 0485), so a week address kept from before
  // opens the month for them, as a quarter's does for everyone.
  const kind: ReportKind = search.get('period') === 'week' && !seniorPastor ? 'WEEK' : 'MONTH';
  const current = rangeStartOf(kind, today);

  const own: OwnScope | null = seniorPastor
    ? { kind: 'ROOT_LEADERS' }
    : wholeChurch
      ? { kind: 'WHOLE_CHURCH' }
      : ownNetwork !== null
        ? { kind: 'NETWORK', network: ownNetwork }
        : me.data
        ? { kind: 'LEADER', person_id: me.data.person_id }
        : null;

  const asked =
    kind === 'MONTH'
      ? monthFromQuery(search.get('month'))
      : rangeStartOf(kind, search.get('start') ?? current);
  const start = asked > current ? current : asked;

  return {
    kind,
    current,
    me,
    wholeChurch,
    ownNetwork,
    seniorPastor,
    start,
    guardMonth: rangeGuardMonth(kind, start, today),
    own,
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
