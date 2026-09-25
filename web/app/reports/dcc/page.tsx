'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets } from '@/components/attendance-figures';
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
import { getDccTwelve, type ReportNetwork } from '@/lib/reports';
import { rangeGuardMonth, rangeStartOf, type RangeKind } from '@/lib/report-range';
import { dayLabel, monthFromQuery, todayInManila } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * The DCC report (SKILL.md sections 9, 13, 17, 19 and 20; decisions 0216, 0224, 0257, 0292
 * and 0294).
 *
 * **The Cell Groups report's layout, attributed by the person** (decision 0294): Weekly,
 * Monthly, Quarterly and Year, each the people who came to DCC in the period, once each, at
 * the stage they had reached by its last day, as a table of the reader's direct disciples,
 * then the reader, then the total.
 *
 * **Coverage leads, as one line** (decision 0224): records filed over records owed, summed
 * across the period's Sundays that have come. **The Sundays counted follow it**, naming any
 * Sunday that carried no service, because section 9 requires a removal to be visible on any
 * report covering it.
 *
 * **"How often people came" is Monthly only**, because section 9 defines its buckets over a
 * month's N. It is shown beside the stages rather than folded into them: section 20 keeps the
 * two views separate, and both add up to the same people.
 *
 * **Year keeps its month-by-month table** (decision 0257) beneath its 12.
 *
 * **A whole-church reader's rows name the pastor, and Figures for keeps the Networks**
 * (decision 0294). A Network's DCC figure is its membership (decision 0219), which differs
 * from its root's 12, so a row is labelled by whose 12 it is, and choosing a Network shows the
 * Network's own total, as sections 17 and 18 require.
 */
export default function DccReportPage() {
  return (
    <AppShell>
      <DccReport />
    </AppShell>
  );
}

const PERIOD_PARAM: Record<string, RangeKind> = {
  week: 'WEEK',
  quarter: 'QUARTER',
  year: 'YEAR',
};

export function DccReport() {
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
  const networkParam = search.get('network');
  const network: ReportNetwork | null =
    networkParam === 'MENS' || networkParam === 'WOMENS' ? networkParam : null;

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');

  const own = wholeChurch
    ? ({ kind: 'WHOLE_CHURCH' } as const)
    : me.data
      ? ({ kind: 'LEADER', person_id: me.data.person_id } as const)
      : null;
  // A Network narrows a whole-church grant and never widens a leader's (section 19).
  const subject = leader
    ? ({ kind: 'LEADER', person_id: leader } as const)
    : network !== null && wholeChurch
      ? ({ kind: 'NETWORK', network } as const)
      : own;

  const twelve = useQuery({
    queryKey: ['dcc-twelve', kind, start, subject],
    queryFn: ({ signal }) => getDccTwelve(kind, start, guardMonth, subject!, signal),
    enabled: subject !== null,
  });
  // The reader's own rows, which Figures for offers whichever leader is open.
  const ownTwelve = useQuery({
    queryKey: ['dcc-twelve', kind, start, own],
    queryFn: ({ signal }) => getDccTwelve(kind, start, guardMonth, own!, signal),
    enabled: own !== null,
  });
  const opened = useQuery({
    queryKey: ['branch', leader],
    queryFn: ({ signal }) => getBranch(leader!, undefined, signal),
    enabled: leader !== null,
  });

  const periodParams = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(kind === 'MONTH' ? { month: start } : { period: kind.toLowerCase(), start }),
      ...extra,
    }).toString();

  const options = (ownTwelve.data?.rows ?? []).filter((row) => row.leader !== null);
  const subjectName = leader ? (opened.data?.person.full_name ?? 'This leader') : null;
  const what = { WEEK: 'in the week', MONTH: 'in the month', QUARTER: 'in the quarter', YEAR: 'in the year' }[kind];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportsHeading line="Who came to DCC, and where they are in their journey." />
        <HowTheseAreCounted report="dcc" />
      </div>
      <ReportsTabs current="dcc" month={guardMonth} />
      <PeriodTabs
        value={kind}
        onChange={(value) =>
          go({
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
          onChange={(value) => go(kind === 'MONTH' ? { month: value } : { start: value })}
        />
        <div>
          <label htmlFor="dcc-scope" className="field-label block">
            Figures for
          </label>
          <select
            id="dcc-scope"
            value={leader ?? (wholeChurch && network !== null ? network : '')}
            onChange={(event) => {
              const value = event.target.value;
              go(
                value === 'MENS' || value === 'WOMENS'
                  ? { network: value, leader: null }
                  : { network: null, leader: value === '' ? null : value },
              );
            }}
            className="border-line bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">{wholeChurch ? 'The whole church' : 'Everyone you oversee'}</option>
            {wholeChurch ? (
              <>
                <option value="MENS">{networkLabel('MENS')}</option>
                <option value="WOMENS">{networkLabel('WOMENS')}</option>
              </>
            ) : null}
            <optgroup label={wholeChurch ? 'The pastors’ 12' : 'Your direct 12'}>
              {options.map((row) => (
                <option key={row.leader!.id} value={row.leader!.id}>
                  {row.leader!.full_name}
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
          report="dcc"
          month={guardMonth}
          backHref={`/reports/dcc?${periodParams({})}`}
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
          {/* Coverage leads, as one line (decision 0224); its rows are under Filed reports. */}
          <div className="text-sm">
            <p>
              <span className="font-bold tabular-nums">
                {twelve.data.coverage.met} of {twelve.data.coverage.owed}
              </span>{' '}
              records filed {what}
              {kind === 'MONTH' ? (
                <>
                  {' · '}
                  <Link
                    href={`/reports/filed?${new URLSearchParams({
                      month: guardMonth,
                      kind: 'dcc',
                      ...(leader ? { leader, by: 'leader' } : {}),
                      ...(!leader && subject?.kind === 'NETWORK' ? { network: subject.network } : {}),
                    }).toString()}`}
                    className="text-accent focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    see Filed reports
                  </Link>
                </>
              ) : null}
            </p>
            {/* Section 9: a removed Sunday is named rather than left as a smaller number. */}
            <p className="text-muted mt-1">
              {twelve.data.n} {twelve.data.n === 1 ? 'Sunday' : 'Sundays'} counted
              {twelve.data.removed_events.length > 0
                ? ` · no service on ${twelve.data.removed_events.map((date) => dayLabel(date)).join(', ')}`
                : ''}
            </p>
          </div>

          {subject?.kind === 'NETWORK' ? (
            // A Network's own total, by membership (decision 0219); its rows are the pastors'.
            <TwelveTable
              twelve={{ ...twelve.data, rows: [], own: null, overlap: 0, elsewhere: 0 }}
              kind={kind}
              subjectName={null}
              where="DCC"
              title={networkLabel(subject.network)}
              openHref={(id) => `/reports/dcc?${periodParams({ leader: id })}`}
            />
          ) : (
            <TwelveTable
              twelve={twelve.data}
              kind={kind}
              subjectName={subjectName}
              where="DCC"
              openHref={(id) => `/reports/dcc?${periodParams({ leader: id })}`}
            />
          )}

          {twelve.data.buckets !== null && twelve.data.n > 0 ? (
            <AttendanceBuckets
              buckets={twelve.data.buckets}
              n={twelve.data.n}
              // Section 9: N is the applicable DCC events, the Sundays the calendar carries a
              // service on, and never a count of records filed.
              summary={(n) =>
                n === 1
                  ? 'One Sunday carried a service this month.'
                  : `${n} Sundays carried a service this month.`
              }
            />
          ) : null}

          {kind === 'YEAR' ? (
            <YearTable
              key={`${start}-${JSON.stringify(subject)}`}
              report="dcc"
              year={Number(start.slice(0, 4))}
              scope={subject}
            />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
