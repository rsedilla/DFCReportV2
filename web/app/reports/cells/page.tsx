'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { MovedNotice, NextOpens, NotYetOffered } from '@/components/finished-periods';
import { LeaderDrill } from '@/components/leader-drill';
import {
  BranchTwelve,
  PeriodTabs,
  RangeNavigator,
  RootLeadersTwelve,
  TwelveTable,
} from '@/components/my-twelve';
import { YearTable } from '@/components/report-year';
import { isBranchReader, ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
import { describeFailure } from '@/lib/messages';
import { getBranch } from '@/lib/network';
import { getCellTwelve } from '@/lib/reports';
import { useReportPeriod } from '@/lib/report-period';
import { rangeEndOf } from '@/lib/report-range';
import { useScreenAddress } from '@/lib/screen-address';
import { periodStillOpenNote } from '@/lib/weekly-deadline';

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
 * better. Who is behind is on Record's Recording Progress (decision 0340).
 *
 * **My 12 is the reader's direct disciples, then their own Cell groups, then the total**,
 * in first-name order, never numbered, sorted by a figure or coloured (section 13). Opening a
 * name shows that leader's 12, one generation down; Figures for offers the same names. A
 * whole-church reader's rows are the Network roots, where the Network screen starts them
 * (decision 0268), each named by the pastor with their Network beside (decision 0294).
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

export function CellReport() {
  const search = useSearchParams();
  // Every control lives in the address, so Back steps back through the period, the leader
  // and the length, and a reload opens the same figures.
  const go = useScreenAddress();
  const period = useReportPeriod('cell-twelve', getCellTwelve);
  const { kind, current, me, wholeChurch, seniorPastor, finishedKind, chosen, reach } = period;
  const { periodReady, start, guardMonth, own, probe, periodParams } = period;
  const leader = search.get('leader');
  // A Full view leader reads their branch in the Senior Pastors' layout (decision 0340).
  const branchReader = isBranchReader(me.data);
  const subject = leader ? ({ kind: 'LEADER', person_id: leader } as const) : own;

  const twelve = useQuery({
    queryKey: ['cell-twelve', kind, start, subject],
    queryFn: ({ signal }) => getCellTwelve(kind, start, guardMonth, subject!, signal),
    enabled: subject !== null && periodReady,
  });
  // The reader's own rows, which Figures for offers whichever leader is open.
  const ownTwelve = useQuery({
    queryKey: ['cell-twelve', kind, start, own],
    queryFn: ({ signal }) => getCellTwelve(kind, start, guardMonth, own!, signal),
    enabled: own !== null && periodReady,
  });
  const opened = useQuery({
    queryKey: ['branch', leader],
    queryFn: ({ signal }) => getBranch(leader!, undefined, signal),
    enabled: leader !== null,
  });

  const options = (ownTwelve.data?.rows ?? []).filter((row) => row.leader !== null);
  const subjectName = leader ? (opened.data?.person.full_name ?? 'This leader') : null;
  const what = { WEEK: 'in the week', MONTH: 'in the month', QUARTER: 'in the quarter', YEAR: 'in the year' }[kind];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Who came to a Cell, and where they are in their journey." />
      <ReportsTabs current="cells" month={guardMonth}>
        {seniorPastor || branchReader ? null : (
          <PeriodTabs
            value={kind}
            onChange={period.choosePeriodKind}
          />
        )}

        {finishedKind !== null && chosen?.ready && chosen.moved !== null ? (
          <MovedNotice kind={finishedKind} asked={chosen.asked} moved={chosen.moved} />
        ) : null}

        {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
        <div className={`mt-6 ${CONTROL_BAR}`}>
          {/* The Senior Pastors' controls in one row: period, month, Figures for (owner, 2026-10-09). */}
          {seniorPastor ? (
            <PeriodTabs
              inBar
              value={kind}
              onChange={period.choosePeriodKind}
            />
          ) : null}
          {/* A Full view leader's period, labelled, in one row with the others (decision 0363). */}
          {branchReader ? (
            <div>
              <p className="field-label">Show</p>
              <PeriodTabs labelled value={kind} onChange={period.choosePeriodKind} />
            </div>
          ) : null}
          {reach?.kind === 'none' ? null : (
            <RangeNavigator
              kind={kind}
              start={start}
              current={reach?.kind === 'open' ? reach.latest : current}
              earliest={reach?.kind === 'open' ? reach.earliest : undefined}
              open={twelve.data?.open}
              quiet={seniorPastor}
              labelled={branchReader}
              onChange={period.choosePeriodStart}
            />
          )}
          <div>
            <label htmlFor="cell-scope" className="field-label block">
              Figures for
            </label>
            <select
              id="cell-scope"
              value={leader ?? ''}
              onChange={(event) => go({ leader: event.target.value === '' ? null : event.target.value })}
              className="border-line bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">{wholeChurch ? 'Whole Church' : 'People you oversee'}</option>
              <optgroup label={wholeChurch ? 'The pastors’ 12' : 'My 12'}>
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
          {/* A Full view leader's note under the controls (decision 0363): whether it is still open. */}
          {branchReader && twelve.data ? (
            <p className="text-muted basis-full text-sm">
              {twelve.data.open ? `${periodStillOpenNote(rangeEndOf(kind, start))}.` : 'Closed.'}
            </p>
          ) : null}
        </div>

        {finishedKind !== null && reach?.kind === 'open' && start === reach.latest ? (
          <NextOpens kind={finishedKind} start={start} />
        ) : null}

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
                : probe.isError
                  ? describeFailure(probe.error)
                  : me.isError
                    ? describeFailure(me.error)
                    : null
            }
          />
        </div>

        {finishedKind !== null && reach?.kind === 'none' ? (
          <NotYetOffered kind={finishedKind} reach={reach} />
        ) : twelve.isPending || subject === null ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : twelve.data ? (
          <div className="mt-6 flex flex-col gap-4">
            {/* Coverage leads, as one line (decision 0202); who is behind is on Record's Recording
                Progress (decision 0340). The Senior Pastors read it there instead (owner, 2026-10-09),
                and so does a Full view leader (decision 0363). */}
            {seniorPastor || branchReader ? null : (
              <p className="text-sm">
                <span className="font-bold tabular-nums">
                  {twelve.data.coverage.recorded} of {twelve.data.coverage.scheduled}
                </span>{' '}
                meetings recorded {what}
                {kind !== 'MONTH' && twelve.data.coverage.through < twelve.data.end
                  ? `, due through ${new Date(`${twelve.data.coverage.through}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
                  : ''}
              </p>
            )}

            {subject?.kind === 'ROOT_LEADERS' ? (
              <RootLeadersTwelve
                twelve={twelve.data}
                kind={kind}
                openHref={(id) => `/reports/cells?${periodParams({ leader: id })}`}
              />
            ) : branchReader ? (
              <BranchTwelve
                twelve={twelve.data}
                kind={kind}
                subjectName={subjectName}
                openHref={(id) => `/reports/cells?${periodParams({ leader: id })}`}
              />
            ) : (
              <TwelveTable
                twelve={twelve.data}
                kind={kind}
                subjectName={subjectName}
                openHref={(id) => `/reports/cells?${periodParams({ leader: id })}`}
              />
            )}

            {/* Not the month-by-month table for the Senior Pastors (owner, 2026-10-09). */}
            {kind === 'YEAR' && !seniorPastor ? (
              <YearTable
                key={`${start}-${JSON.stringify(subject)}`}
                report="cells"
                year={Number(start.slice(0, 4))}
                scope={subject.kind === 'ROOT_LEADERS' ? { kind: 'WHOLE_CHURCH' } : subject}
              />
            ) : null}
          </div>
        ) : null}
      </ReportsTabs>
    </main>
  );
}
