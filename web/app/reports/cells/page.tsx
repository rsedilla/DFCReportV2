'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { HowTheseAreCounted } from '@/components/how-counted';
import { LeaderDrill } from '@/components/leader-drill';
import { PeriodTabs, RangeNavigator, TwelveTable } from '@/components/my-twelve';
import { YearTable } from '@/components/report-year';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { getBranch } from '@/lib/network';
import { networkLabel } from '@/lib/people';
import { getCellTwelve } from '@/lib/reports';
import {
  rangeGuardMonth,
  rangeStartOf,
  type RangeKind,
} from '@/lib/report-range';
import { monthFromQuery, todayInManila } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * The Cell Groups report (SKILL.md sections 12, 13, 17, 19 and 20; decisions 0202, 0216,
 * 0257, 0292 and 0293).
 *
 * **Weekly, Monthly, Quarterly and Year are one rule on four lengths** (decision 0293): the
 * people who came to a Cell in the period, once each, at the stage they had reached by its
 * last day. A period still running says so and shows the stage so far; a period that has
 * not begun is not offered (decision 0216).
 *
 * **Coverage leads, as one line** (decision 0202): meetings recorded over meetings due,
 * above the table, because it is the one figure that recording less makes worse rather than
 * better. The rows behind it are under Filed reports (decision 0292).
 *
 * **My 12 is the reader's direct disciples, then their own Cell groups, then the total**,
 * in surname order, never numbered, sorted by a figure or coloured (section 13). Opening a
 * name shows that leader's 12, one generation down; Figures for offers the same names. A
 * whole-church reader's rows are the Network roots, where the Network screen starts them
 * (decision 0268), labelled and ordered by their Network (decision 0293).
 *
 * **Year keeps its month-by-month table** (decision 0257) beneath its 12, because a year's
 * stage and its months answer different questions and are never added together.
 */
export default function CellReportPage() {
  return (
    <AppShell>
      <CellReport />
    </AppShell>
  );
}

const PERIOD_PARAM: Record<string, RangeKind> = {
  week: 'WEEK',
  quarter: 'QUARTER',
  year: 'YEAR',
};

export function CellReport() {
  const search = useSearchParams();
  // Every control lives in the address, so Back steps back through the period, the leader
  // and the length, and a reload opens the same figures.
  const go = useScreenAddress();
  const today = todayInManila();

  const kind: RangeKind = PERIOD_PARAM[search.get('period') ?? ''] ?? 'MONTH';
  const current = rangeStartOf(kind, today);
  const asked =
    kind === 'MONTH'
      ? monthFromQuery(search.get('month'))
      : rangeStartOf(kind, search.get('start') ?? current);
  // A period that has not begun is not reported (decision 0216), so an address naming one
  // opens the current period instead.
  const start = asked > current ? current : asked;
  const guardMonth = rangeGuardMonth(kind, start, today);
  const leader = search.get('leader');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');

  const own = wholeChurch
    ? ({ kind: 'WHOLE_CHURCH' } as const)
    : me.data
      ? ({ kind: 'LEADER', person_id: me.data.person_id } as const)
      : null;
  const subject = leader ? ({ kind: 'LEADER', person_id: leader } as const) : own;

  const twelve = useQuery({
    queryKey: ['cell-twelve', kind, start, subject],
    queryFn: ({ signal }) => getCellTwelve(kind, start, guardMonth, subject!, signal),
    enabled: subject !== null,
  });
  // The reader's own rows, which Figures for offers whichever leader is open.
  const ownTwelve = useQuery({
    queryKey: ['cell-twelve', kind, start, own],
    queryFn: ({ signal }) => getCellTwelve(kind, start, guardMonth, own!, signal),
    enabled: own !== null,
  });
  const opened = useQuery({
    queryKey: ['branch', leader],
    queryFn: ({ signal }) => getBranch(leader!, undefined, signal),
    enabled: leader !== null,
  });

  const address = (changes: Record<string, string | null>) => go(changes);
  const periodParams = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(kind === 'MONTH'
        ? { month: start }
        : { period: kind.toLowerCase(), start }),
      ...extra,
    }).toString();

  const options = (ownTwelve.data?.rows ?? []).filter((row) => row.leader !== null);
  const subjectName = leader ? (opened.data?.person.full_name ?? 'This leader') : null;
  const what = { WEEK: 'in the week', MONTH: 'in the month', QUARTER: 'in the quarter', YEAR: 'in the year' }[kind];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportsHeading line="Who came to a Cell, and where they are in their journey." />
        <HowTheseAreCounted report="cells" />
      </div>
      <ReportsTabs current="cells" month={guardMonth} />
      <PeriodTabs
        value={kind}
        onChange={(value) =>
          address({
            period: value === 'MONTH' ? null : value.toLowerCase(),
            start: null,
            month: null,
          })
        }
      />

      {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
      <div className={`mt-6 ${CONTROL_BAR}`}>
        <RangeNavigator
          kind={kind}
          start={start}
          current={current}
          open={twelve.data?.open}
          onChange={(value) => address(kind === 'MONTH' ? { month: value } : { start: value })}
        />
        <div>
          <label htmlFor="cell-scope" className="field-label block">
            Figures for
          </label>
          <select
            id="cell-scope"
            value={leader ?? ''}
            onChange={(event) => address({ leader: event.target.value === '' ? null : event.target.value })}
            className="border-line bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">{wholeChurch ? 'Everyone in your scope' : 'Everyone you oversee'}</option>
            <optgroup label={wholeChurch ? 'The Networks' : 'Your direct 12'}>
              {options.map((row) => (
                <option key={row.leader!.id} value={row.leader!.id}>
                  {row.network ? networkLabel(row.network) : row.leader!.full_name}
                </option>
              ))}
            </optgroup>
            {leader !== null && !options.some((row) => row.leader?.id === leader) ? (
              <option value={leader}>{subjectName}</option>
            ) : null}
          </select>
        </div>
      </div>

      {leader ? (
        <LeaderDrill
          personId={leader}
          report="cells"
          month={guardMonth}
          backHref={`/reports/cells?${periodParams({})}`}
        />
      ) : null}

      <div className="mt-8">
        <FailureNotice
          failure={
            twelve.isError
              ? describeFailure(twelve.error)
              : me.isError
                ? describeFailure(me.error)
                : null
          }
        />
      </div>

      {twelve.isPending || subject === null ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : twelve.data ? (
        <div className="mt-6 flex flex-col gap-4">
          {/* Coverage leads, as one line (decision 0202); its rows are under Filed reports. */}
          <p className="text-sm">
            <span className="font-bold tabular-nums">
              {twelve.data.coverage.recorded} of {twelve.data.coverage.scheduled}
            </span>{' '}
            meetings recorded {what}
            {kind !== 'MONTH' && twelve.data.coverage.through < twelve.data.end
              ? `, due through ${new Date(`${twelve.data.coverage.through}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
              : ''}
            {kind === 'MONTH' ? (
              <>
                {' · '}
                <Link
                  href={`/reports/filed?${new URLSearchParams({
                    month: guardMonth,
                    ...(leader ? { leader, by: 'leader' } : {}),
                  }).toString()}`}
                  className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  see Filed reports
                </Link>
              </>
            ) : null}
          </p>

          <TwelveTable
            twelve={twelve.data}
            kind={kind}
            subjectName={subjectName}
            openHref={(id) => `/reports/cells?${periodParams({ leader: id })}`}
          />

          {kind === 'YEAR' ? (
            <YearTable
              key={`${start}-${JSON.stringify(subject)}`}
              report="cells"
              year={Number(start.slice(0, 4))}
              scope={subject}
            />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
