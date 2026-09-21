'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets, ClassificationFigures } from '@/components/attendance-figures';
import { CoverageFigure } from '@/components/coverage-figure';
import { HowTheseAreCounted } from '@/components/how-counted';
import { MonthPicker } from '@/components/month-picker';
import { CoverageBySunday } from '@/components/report-coverage';
import { CoverageByLeader, CoverageSwitch } from '@/components/report-coverage-by-leader';
import { PeriodSwitch, YearPicker, YearTable, currentYear } from '@/components/report-year';
import { LeaderDrill } from '@/components/leader-drill';
import { ReportsSwitch } from '@/components/reports-switch';
import { FailureNotice } from '@/components/ui/failure-notice';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { getDccMonthlyReport, type ReportNetwork, type ReportScope } from '@/lib/reports';
import { dayLabel, monthFromQuery } from '@/lib/reporting-month';

/**
 * DCC attendance figures for a month, one of the two reports under Reports (SKILL.md
 * sections 9, 12, 13, 17, 19 and 20; decisions 0216, 0224 and 0245).
 *
 * **Coverage here is obligations met over obligations owed** (decision 0224),
 * summed across the month's Sundays and never divided. It is a different figure
 * from the Cell one beside it: a Cell counts recorded meetings against scheduled
 * ones, and this counts leaders who filed against leaders who owed, which is why
 * the two carry different words.
 *
 * **A removed Sunday is named.** Section 9 requires a removal to be visible on any
 * report covering the month, "so that a month showing four events where the
 * calendar shows five is explained rather than merely odd". `N` on its own cannot
 * explain itself, so the dates are listed.
 *
 * **Buckets are shown here where a Cell report would not show them.** Section 12
 * puts the restriction on *Cell* buckets, because `N` belongs to a Cell; a DCC
 * event is church-wide, so one `N` covers everybody and an aggregate `Completed`
 * means the same thing for every person in it.
 *
 * **The open flag is load-bearing beside `N`** (section 17). `N` counts the calendar
 * rows the month holds whether or not their day has passed, so mid-month somebody
 * who came to both Sundays so far reads as two of three — and only the flag says
 * why.
 *
 * **Coverage by Sunday closes the report**, one row per Sunday from the DCC calendar,
 * a removed Sunday kept in its place. It is left out when a Network is chosen and
 * carries no total row; `components/report-coverage.tsx` says why.
 */
export default function DccReportPage() {
  return (
    <AppShell>
      <DccReport />
    </AppShell>
  );
}

export function DccReport() {
  const search = useSearchParams();
  const [month, setMonth] = useState(() => monthFromQuery(search.get('month')));
  // A month or a year of this report (decision 0257). The year is the month's own year.
  const [period, setPeriod] = useState<'month' | 'year'>(() =>
    search.get('period') === 'year' ? 'year' : 'month',
  );
  const [year, setYear] = useState(() => Math.min(Number(month.slice(0, 4)), currentYear()));

  // **Section 19's Senior Pastor scope selector.** Empty means the whole church; the
  // two Networks are the only other values section 4 defines. It is offered only to
  // a Whole Church holder, because that is the grant section 19 describes a Senior
  // Pastor by — a leader-scoped viewer has one scope and a control with one option
  // is a control that lies about having a choice.
  const [network, setNetwork] = useState<ReportNetwork | ''>('');
  // A leader opened from the By leader table (decision 0254), carried in the address so
  // the browser's Back returns to the report it was opened from.
  const leader = search.get('leader');
  const [coverageBy, setCoverageBy] = useState<'first' | 'leader'>('first');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');

  // A Whole Church grant is read as Whole Church, for the reason the Cell report
  // beside this one gives: an administrator holding one need not be in the
  // pastoral tree, and section 20 then places them in no subtree at all.
  //
  // **A Network narrows that grant and never widens a leader's**, which is why the
  // selector is gated above rather than the scope being chosen here: a leader-scoped
  // viewer reaches the `LEADER` branch whatever `network` holds.
  const scope: Exclude<ReportScope, { kind: 'CELL' }> | null = leader
    ? { kind: 'LEADER', person_id: leader }
    : wholeChurch
      ? network === ''
        ? { kind: 'WHOLE_CHURCH' }
        : { kind: 'NETWORK', network }
      : me.data
        ? { kind: 'LEADER', person_id: me.data.person_id }
        : null;

  const report = useQuery({
    queryKey: ['dcc-report', month, scope],
    queryFn: ({ signal }) =>
      getDccMonthlyReport(month, scope as Exclude<ReportScope, { kind: 'CELL' }>, signal),
    enabled: scope !== null && period === 'month',
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ReportsSwitch current="dcc" month={month} />
        <HowTheseAreCounted report="dcc" />
      </div>
      <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
        What the people you oversee recorded for{' '}
        {period === 'year' ? 'each month’s' : 'this month’s'} Sundays, and how many of the leaders
        who owed a record filed one.
      </p>

      <PeriodSwitch value={period} onChange={setPeriod} />

      {period === 'month' ? (
        <MonthPicker month={month} onChange={setMonth} open={report.data?.open} />
      ) : (
        <YearPicker year={year} onChange={setYear} />
      )}

      {leader ? <LeaderDrill personId={leader} report="dcc" month={month} /> : null}

      {wholeChurch && !leader ? (
        <div className="mt-4">
          <label htmlFor="dcc-scope" className="field-label block">
            Figures for
          </label>
          <select
            id="dcc-scope"
            value={network}
            onChange={(event) => setNetwork(event.target.value as ReportNetwork | '')}
            className="border-line focus-visible:outline-accent mt-2 min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">The whole church</option>
            <option value="MENS">Men&rsquo;s Network</option>
            <option value="WOMENS">Women&rsquo;s Network</option>
          </select>
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            A Network counts the people who belong to it. The people who attended in the two
            Networks normally add up to the whole church. Recording coverage doesn&rsquo;t split
            that way, because it counts records owed, not people.
          </p>
        </div>
      ) : null}

      <div className="mt-8">
        <FailureNotice
          failure={
            report.isError
              ? describeFailure(report.error)
              : me.isError
                ? describeFailure(me.error)
                : null
          }
        />
      </div>

      {period === 'year' ? (
        scope === null ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : (
          <YearTable
            key={`${year}-${JSON.stringify(scope)}`}
            report="dcc"
            year={year}
            scope={scope}
          />
        )
      ) : report.isPending || scope === null ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : report.data ? (
        <div className="mt-8 flex flex-col gap-10">
          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="field-label">
              Recording coverage
            </h2>
            <p className="mt-2">
              <CoverageFigure
                recorded={report.data.coverage.met}
                scheduled={report.data.coverage.owed}
                unit="records filed"
              />
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Counted across every Sunday of the month. A leader owes one record for each Sunday
              they were responsible for somebody, and a Sunday that has not happened owes nobody
              anything.
            </p>
          </section>

          {/* Two short figures, side by side from `sm`. */}
          <div className="grid gap-10 sm:grid-cols-2">
            <section aria-labelledby="month-heading">
              <h2 id="month-heading" className="field-label">
                The month
              </h2>
              <p className="mt-2 text-sm">
                <span className="text-xl font-semibold tabular-nums">{report.data.n}</span>
                <span className="text-muted">
                  {' '}
                  {report.data.n === 1 ? 'Sunday counted' : 'Sundays counted'}
                </span>
              </p>
              {report.data.removed_events.length > 0 ? (
                // Section 9: a removal records a decision, so it is named rather
                // than left as a smaller number nobody can explain.
                <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                  No service was held on{' '}
                  {report.data.removed_events.map((date) => dayLabel(date)).join(', ')}, so
                  {report.data.removed_events.length === 1
                    ? ' that Sunday is'
                    : ' those Sundays are'}{' '}
                  not counted.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="people-heading">
              <h2 id="people-heading" className="field-label">
                People who attended
              </h2>
              <p className="mt-2 text-xl font-semibold tabular-nums">{report.data.unique_people}</p>
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                Counted once each, however many Sundays they came to.
              </p>
            </section>
          </div>

          {/* Side by side from `lg`, one under the other below it. */}
          <div className="grid gap-10 lg:grid-cols-2">
            <ClassificationFigures classification={report.data.classification} />

            {report.data.n === 0 ? (
              <p className="text-muted max-w-2xl text-sm leading-relaxed">
                No Sundays were counted this month, so there is nothing to break down.
              </p>
            ) : (
              <AttendanceBuckets
                buckets={report.data.buckets}
                n={report.data.n}
                // Section 9: N is the applicable DCC events — the Sundays the calendar
                // carries a service on — and never a count of records filed.
                summary={(n) =>
                  n === 1
                    ? 'One Sunday carried a service this month.'
                    : `${n} Sundays carried a service this month.`
                }
              />
            )}
          </div>

          <section aria-labelledby="coverage-by-heading">
            <h2 id="coverage-by-heading" className="field-label">
              Row by row
            </h2>
            {/*
              By Sunday reads the calendar under the reader's own scope, so it is offered only
              where that is the report's scope too: not for a Network, and not for a leader
              opened from the list.
            */}
            <CoverageSwitch
              first={network === '' && !leader ? 'By Sunday' : null}
              value={network === '' && !leader ? coverageBy : 'leader'}
              onChange={setCoverageBy}
            />
            {network === '' && !leader && coverageBy === 'first' ? (
              <CoverageBySunday month={month} />
            ) : scope ? (
              <CoverageByLeader
                key={`${month}-${JSON.stringify(scope)}`}
                report="dcc"
                month={month}
                scope={scope}
                unit="records"
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
