'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { PAGE_WIDTH } from '@/components/app-shell';
import { LeaderDrill } from '@/components/leader-drill';
import {
  BranchTwelve,
  RangeNavigator,
  RootLeadersTwelve,
  TwelveTable,
} from '@/components/my-twelve';
import {
  isBranchReader,
  ReportsHeading,
  ReportsTabs,
  ReportViewSwitch,
} from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
import { describeFailure } from '@/lib/messages';
import { getBranch } from '@/lib/network';
import { useKeptLeader } from '@/lib/merged-leader';
import { getCellTwelve } from '@/lib/reports';
import { useReportPeriod } from '@/lib/report-period';
import { rangeEndOf } from '@/lib/report-range';
import { useScreenAddress } from '@/lib/screen-address';
import { periodStillOpenNote } from '@/lib/weekly-deadline';

/**
 * The Cell Groups report (SKILL.md sections 12, 13, 17, 19 and 20; decisions 0202, 0216,
 * 0257, 0292 and 0293).
 *
 * **Weekly and Monthly are one rule on two lengths** (decision 0293): the people who came to
 * a Cell in the period, once each, at the stage they had reached by its last day. A period
 * still running says so and shows the stage so far; a period that has not begun is not
 * offered (decision 0216). Yearly is the last 12 months, a screen of its own (decision 0443).
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
 */
export default function CellReportPage() {
  return (
    <>
      <CellReport />
    </>
  );
}

export function CellReport() {
  const search = useSearchParams();
  // Every control lives in the address, so Back steps back through the period, the leader
  // and the length, and a reload opens the same figures.
  const go = useScreenAddress();
  const period = useReportPeriod();
  const { kind, current, me, wholeChurch, seniorPastor } = period;
  const { start, guardMonth, own, periodParams } = period;
  const leader = search.get('leader');
  // A leader merged away opens the record kept's report (decision 0408, point 22).
  const mergedFrom = useKeptLeader(leader);
  // A Full view leader reads their branch in the Senior Pastors' layout (decision 0340).
  const branchReader = isBranchReader(me.data);
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

  const options = (ownTwelve.data?.rows ?? []).filter((row) => row.leader !== null);
  const subjectName = leader ? (opened.data?.person.full_name ?? 'This leader') : null;
  const what = kind === 'WEEK' ? 'in the week' : 'in the month';

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Who came to a Cell, and where they are in their journey." />
      <ReportsTabs current="cells" month={guardMonth}>
        {/* Weekly, Monthly and Yearly on the line beside Cell Group and DCC, for every reader
            (decision 0443). */}
        <ReportViewSwitch tab="cells" value={kind} onPeriod={period.choosePeriodKind} />

        {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
        <div className={`mt-6 ${CONTROL_BAR}`}>
          {/* The month, then Figures for (owner, 2026-10-09). */}
          <RangeNavigator
            kind={kind}
            start={start}
            current={current}
            open={twelve.data?.open}
            quiet={seniorPastor}
            labelled={branchReader || seniorPastor ? 'bare' : false}
            onChange={period.choosePeriodStart}
          />
          {/* A Full view leader reads their own branch only, with no Figures for (decision 0380). */}
          {branchReader ? null : (
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
          )}
          {/* A Full view leader's note under the controls (decision 0363): whether it is still open. */}
          {branchReader && twelve.data ? (
            <p className="text-muted basis-full text-sm">
              {twelve.data.open ? `${periodStillOpenNote(rangeEndOf(kind, start))}.` : 'Closed.'}
            </p>
          ) : null}
        </div>

        {leader ? (
          <LeaderDrill
            personId={leader}
            report="cells"
            month={guardMonth}
            backHref={`/reports/cells?${periodParams({})}`}
          />
        ) : null}

        {leader && mergedFrom ? (
          <p className="border-accent mt-6 border p-4 text-sm leading-relaxed">
            <strong>{mergedFrom} was merged into this record.</strong> These are {subjectName}
            &rsquo;s figures, the record kept.
          </p>
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
              <BranchTwelve twelve={twelve.data} kind={kind} subjectName={subjectName} />
            ) : (
              <TwelveTable
                twelve={twelve.data}
                kind={kind}
                subjectName={subjectName}
                openHref={(id) => `/reports/cells?${periodParams({ leader: id })}`}
              />
            )}
          </div>
        ) : null}
      </ReportsTabs>
    </main>
  );
}
