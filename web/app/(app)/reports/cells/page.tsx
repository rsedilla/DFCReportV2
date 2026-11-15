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
import { FiguresForSwitch } from '@/components/figures-for-switch';
import { KeptFigures } from '@/components/kept-figures';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR } from '@/components/ui/frame';
import { describeFailure } from '@/lib/messages';
import { getBranch } from '@/lib/network';
import { useKeptLeader } from '@/lib/merged-leader';
import { getCellTwelve, type ReportNetwork } from '@/lib/reports';
import { useOwnRootNetwork } from '@/lib/own-network';
import { getPerson, networkLabel } from '@/lib/people';
import { useReportPeriod } from '@/lib/report-period';
import { keepPreviousPeriod } from '@/lib/keep-previous-page';
import { rangeLabel } from '@/lib/report-range';
import { useScreenAddress } from '@/lib/screen-address';
import { cn } from '@/lib/utils';
import { useAsOfToday } from '@/lib/use-as-of-today';

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
  // "As of today, 12 Nov" (decision 0478).
  const asOfToday = useAsOfToday();
  const period = useReportPeriod();
  const { kind, current, me, wholeChurch, ownNetwork, seniorPastor } = period;
  const { start, guardMonth, own, periodParams } = period;
  const leader = search.get('leader');
  // A leader merged away opens the record kept's report (decision 0408, point 22).
  const mergedFrom = useKeptLeader(leader);
  // A Full view leader reads their branch in the Senior Pastors' layout (decision 0340).
  const branchReader = isBranchReader(me.data);
  // The Senior Pastors' switch chooses a Network, counted by the Cell's Network (section 20,
  // decision 0469); it narrows a whole-church grant and never widens one. **It opens on the
  // reader's own Network** (decision 0491), so the page waits until that is known.
  const networkParam = search.get('network');
  const ownRoot = useOwnRootNetwork(seniorPastor);
  const network: ReportNetwork | null = !seniorPastor
    ? null
    : networkParam === 'MENS' || networkParam === 'WOMENS'
      ? networkParam
      : networkParam === 'BOTH'
        ? null
        : ownRoot.network;
  const waiting = seniorPastor && networkParam === null && leader === null && !ownRoot.settled;
  // **The way back goes up one level** (decision 0491): the leaders opened on the way here.
  const trail = (search.get('trail') ?? '').split(',').filter(Boolean);
  const parentId = trail.length > 0 ? trail[trail.length - 1] : null;
  const parent = useQuery({
    queryKey: ['person', parentId],
    queryFn: ({ signal }) => getPerson(parentId!, signal),
    enabled: parentId !== null,
  });
  const subject = waiting
    ? null
    : leader
      ? ({ kind: 'LEADER', person_id: leader } as const)
      : network !== null && wholeChurch
        ? ({ kind: 'NETWORK', network } as const)
        : own;
  // A name opened from inside a leader's 12 remembers that leader, for the way back.
  const openHref = (id: string) =>
    `/reports/cells?${periodParams({
      leader: id,
      ...(leader ? { trail: [...trail, leader].join(',') } : {}),
      ...(networkParam ? { network: networkParam } : {}),
    })}`;

  const twelveKey = ['cell-twelve', kind, start, subject] as const;
  const twelve = useQuery({
    queryKey: twelveKey,
    // A change of period keeps the figures shown, faded, until the new ones arrive (owner,
    // 2026-11-06); another leader still shows Loading.
    placeholderData: keepPreviousPeriod(twelveKey, [1, 2]),
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
      <ReportsHeading
        current="cells"
        line="Who came to a Cell, and where they are in their journey."
      />
      <ReportsTabs current="cells" month={guardMonth}>
        {/* Weekly, Monthly and Yearly on the line beside Cell Group and DCC, for every reader
            (decision 0443). */}
        {/* A Full view leader's sits in the bar beside the month (decision 0483). */}
        {branchReader ? null : (
          <ReportViewSwitch tab="cells" value={kind} onPeriod={period.choosePeriodKind} />
        )}

        {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
        <div className={cn(branchReader ? 'mt-4' : 'mt-6', CONTROL_BAR, branchReader && 'items-center')}>
          {branchReader ? (
            <ReportViewSwitch tab="cells" value={kind} onPeriod={period.choosePeriodKind} inBar />
          ) : null}
          {/* The month, then Figures for (owner, 2026-10-09). */}
          <RangeNavigator
            kind={kind}
            start={start}
            current={current}
            open={twelve.isPlaceholderData ? undefined : twelve.data?.open}
            quiet={seniorPastor}
            labelled={branchReader || seniorPastor ? 'bare' : false}
            asOfToday
            onChange={period.choosePeriodStart}
          />
          {/* A Full view leader reads their own branch only, with no Figures for (decision 0380).
              The Senior Pastors' is Men, Women and Both, their own Network first, a Primary opening
              by name (decisions 0486 and 0491). */}
          {branchReader ? null : seniorPastor ? (
            <FiguresForSwitch
              network={network}
              leaderOpen={leader !== null}
              own={ownRoot.network}
              onChange={(next) => go({ network: next, leader: null, trail: null })}
            />
          ) : (
          <div>
            <label htmlFor="cell-scope" className="field-label block">
              Figures for
            </label>
            <select
              id="cell-scope"
              value={leader ?? ''}
              onChange={(event) => go({ leader: event.target.value === '' ? null : event.target.value })}
              className="border-edge bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">
                {wholeChurch
                  ? 'Whole Church'
                  : ownNetwork !== null
                    ? networkLabel(ownNetwork)
                    : 'People you oversee'}
              </option>
              <optgroup label={wholeChurch || ownNetwork !== null ? 'The pastors’ 12' : 'My 12'}>
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
          {/* A Full view leader's note under the controls (decision 0363): a period whose records
              are still open says so in two words, and one whose records have closed says
              nothing (decision 0451, replacing its closing time and "Closed."), dated by
              decision 0478. */}
          {branchReader && twelve.data && !twelve.isPlaceholderData && twelve.data.open ? (
            <p className="text-muted basis-full text-sm">{asOfToday}</p>
          ) : null}
        </div>

        {leader ? (
          <LeaderDrill
            personId={leader}
            report="cells"
            month={guardMonth}
            backHref={`/reports/cells?${periodParams(
              parentId
                ? {
                    leader: parentId,
                    ...(trail.length > 1 ? { trail: trail.slice(0, -1).join(',') } : {}),
                    ...(networkParam ? { network: networkParam } : {}),
                  }
                : networkParam
                  ? { network: networkParam }
                  : {},
            )}`}
            backLabel={parentId ? `Back to ${parent.data?.full_name ?? 'the leader above'}` : undefined}
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

        <KeptFigures kept={twelve.isPlaceholderData} loading={rangeLabel(kind, start)}>
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
                openHref={openHref}
              />
            ) : seniorPastor && subject?.kind === 'NETWORK' ? (
              // A Network laid out as Both is, its root's table alone (decision 0491).
              <RootLeadersTwelve
                title={networkLabel(subject.network)}
                twelve={twelve.data}
                kind={kind}
                openHref={openHref}
              />
            ) : branchReader ? (
              <BranchTwelve twelve={twelve.data} kind={kind} subjectName={subjectName} />
            ) : (
              <TwelveTable
                twelve={twelve.data}
                kind={kind}
                subjectName={subjectName}
                title={subject?.kind === 'NETWORK' ? networkLabel(subject.network) : undefined}
                openHref={openHref}
              />
            )}
          </div>
        ) : null}
        </KeptFigures>
      </ReportsTabs>
    </main>
  );
}
