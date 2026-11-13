'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets } from '@/components/attendance-figures';
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
import { networkLabel } from '@/lib/people';
import { useKeptLeader } from '@/lib/merged-leader';
import { getDccTwelve, type ReportNetwork } from '@/lib/reports';
import { useReportPeriod } from '@/lib/report-period';
import { keepPreviousPeriod } from '@/lib/keep-previous-page';
import { rangeLabel } from '@/lib/report-range';
import { dayLabel } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { cn } from '@/lib/utils';
import { useAsOfToday } from '@/lib/use-as-of-today';

/**
 * The DCC report (SKILL.md sections 9, 13, 17, 19 and 20; decisions 0216, 0224, 0257, 0292
 * and 0294).
 *
 * **The Cell Groups report's layout, attributed by the person** (decision 0294): Weekly and
 * Monthly, each the people who came to DCC in the period, once each, at the stage they had
 * reached by its last day, as a table of the reader's direct disciples, then the reader, then
 * the total. Yearly is the last 12 months, a screen of its own (decision 0443).
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
 * **A whole-church reader's rows name the pastor, and Figures for keeps the Networks**
 * (decision 0294). A Network's DCC figure is its membership (decision 0219), which differs
 * from its root's 12, so a row is labelled by whose 12 it is, and choosing a Network shows the
 * Network's own total, as sections 17 and 18 require.
 */
export default function DccReportPage() {
  return (
    <>
      <DccReport />
    </>
  );
}

export function DccReport() {
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
  const networkParam = search.get('network');
  const network: ReportNetwork | null =
    networkParam === 'MENS' || networkParam === 'WOMENS' ? networkParam : null;
  // A Full view leader reads their branch in the Senior Pastors' layout (decision 0340).
  const branchReader = isBranchReader(me.data);
  // A Network narrows a whole-church grant and never widens a leader's (section 19).
  const subject = leader
    ? ({ kind: 'LEADER', person_id: leader } as const)
    : network !== null && wholeChurch
      ? ({ kind: 'NETWORK', network } as const)
      : own;

  const twelveKey = ['dcc-twelve', kind, start, subject] as const;
  const twelve = useQuery({
    queryKey: twelveKey,
    // A change of period keeps the figures shown, faded, until the new ones arrive (owner,
    // 2026-11-06); another leader still shows Loading.
    placeholderData: keepPreviousPeriod(twelveKey, [1, 2]),
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

  const options = (ownTwelve.data?.rows ?? []).filter((row) => row.leader !== null);
  const subjectName = leader ? (opened.data?.person.full_name ?? 'This leader') : null;
  const what = kind === 'WEEK' ? 'in the week' : 'in the month';

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Who came to DCC (Doulos Cell Celebration), and where they are in their journey." />
      <ReportsTabs current="dcc" month={guardMonth}>
        {/* Weekly, Monthly and Yearly on the line beside Cell Group and DCC, for every reader
            (decision 0443). */}
        {/* A Full view leader's sits in the bar beside the month (decision 0483). */}
        {branchReader ? null : (
          <ReportViewSwitch tab="dcc" value={kind} onPeriod={period.choosePeriodKind} />
        )}

        {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
        <div className={cn(branchReader ? 'mt-4' : 'mt-6', CONTROL_BAR, branchReader && 'items-center')}>
          {branchReader ? (
            <ReportViewSwitch tab="dcc" value={kind} onPeriod={period.choosePeriodKind} inBar />
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
              The Senior Pastors' is All, Men's and Women's, a Primary opening by name (0486). */}
          {branchReader ? null : seniorPastor ? (
            <FiguresForSwitch
              network={network}
              leaderOpen={leader !== null}
              onChange={(next) => go({ network: next, leader: null })}
            />
          ) : (
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
              className="border-edge bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">
                {wholeChurch
                  ? 'Whole Church'
                  : ownNetwork !== null
                    ? networkLabel(ownNetwork)
                    : 'People you oversee'}
              </option>
              {wholeChurch ? (
                <>
                  <option value="MENS">{networkLabel('MENS')}</option>
                  <option value="WOMENS">{networkLabel('WOMENS')}</option>
                </>
              ) : null}
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
          {/* A Full view leader's note under the controls (decision 0363): whether the period's
              records are still open, in two words, and any Sunday with no service (section 9).
              Once its records have closed, a period with every Sunday held says nothing (decision
              0451, which took out the count of Sundays, the closing time and "Closed."). */}
          {branchReader && twelve.data && !twelve.isPlaceholderData ? (
            (() => {
              const note = [
                twelve.data.open ? asOfToday : null,
                twelve.data.removed_events.length > 0
                  ? // Counted, never "no service": DCC is held every Sunday (decision 0483).
                    `${twelve.data.removed_events.map((date) => dayLabel(date)).join(', ')} not counted`
                  : null,
              ].filter((part) => part !== null);
              return note.length === 0 ? null : (
                <p className="text-muted basis-full text-sm">{note.join(' · ')}</p>
              );
            })()
          ) : null}
        </div>

        {leader ? (
          <LeaderDrill
            personId={leader}
            report="dcc"
            month={guardMonth}
            backHref={`/reports/dcc?${periodParams({})}`}
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
            {/* Coverage leads, as one line (decision 0224); who is behind is on Record's Recording
                Progress (decision 0340). The Senior Pastors read it there instead (owner,
                2026-10-09), and see only a Sunday with no service, which section 9 names. A Full
                view leader reads it there too, and their Sundays are in the note (decision 0363). */}
            {branchReader ? null : (
              <div className="text-sm">
                {seniorPastor ? null : (
                  <p>
                    <span className="font-bold tabular-nums">
                      {twelve.data.coverage.met} of {twelve.data.coverage.owed}
                    </span>{' '}
                    records filed {what}
                  </p>
                )}
                {/* Section 9: a removed Sunday is named rather than left as a smaller number. */}
                {seniorPastor ? (
                  twelve.data.removed_events.length > 0 ? (
                    <p className="text-muted">
                      {twelve.data.removed_events.map((date) => dayLabel(date)).join(', ')} not counted
                    </p>
                  ) : null
                ) : (
                  <p className="text-muted mt-1">
                    {twelve.data.n} {twelve.data.n === 1 ? 'Sunday' : 'Sundays'} counted
                    {twelve.data.removed_events.length > 0
                      ? ` · ${twelve.data.removed_events.map((date) => dayLabel(date)).join(', ')} not counted`
                      : ''}
                  </p>
                )}
              </div>
            )}

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
            ) : subject?.kind === 'ROOT_LEADERS' ? (
              <RootLeadersTwelve
                twelve={twelve.data}
                kind={kind}
                where="DCC"
                openHref={(id) => `/reports/dcc?${periodParams({ leader: id })}`}
              />
            ) : branchReader ? (
              <BranchTwelve twelve={twelve.data} kind={kind} subjectName={subjectName} />
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
                    ? 'One Sunday counted this month.'
                    : `${n} Sundays counted this month.`
                }
              />
            ) : null}
          </div>
        ) : null}
        </KeptFigures>
      </ReportsTabs>
    </main>
  );
}
