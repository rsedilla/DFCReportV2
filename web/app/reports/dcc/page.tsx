'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets, ClassificationFigures } from '@/components/attendance-figures';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { FailureNotice } from '@/components/ui/failure-notice';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { getDccMonthlyReport, type ReportScope } from '@/lib/reports';
import { dayLabel, reportingMonthOf } from '@/lib/reporting-month';

/**
 * DCC attendance figures for a month (SKILL.md sections 9, 12, 13, 17 and 20;
 * decisions 0216 and 0224).
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
 */
export default function DccReportPage() {
  return (
    <AppShell>
      <DccReport />
    </AppShell>
  );
}

export function DccReport() {
  const [month, setMonth] = useState(() => reportingMonthOf());

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // A Whole Church grant is read as Whole Church, for the reason the Cell report
  // beside this one gives: an administrator holding one need not be in the
  // pastoral tree, and section 20 then places them in no subtree at all.
  const scope: Exclude<ReportScope, { kind: 'CELL' }> | null = holdsWholeChurch(
    me.data,
    'reports.view_subtree',
  )
    ? { kind: 'WHOLE_CHURCH' }
    : me.data
      ? { kind: 'LEADER', person_id: me.data.person_id }
      : null;

  const report = useQuery({
    queryKey: ['dcc-report', month, scope],
    queryFn: ({ signal }) =>
      getDccMonthlyReport(month, scope as Exclude<ReportScope, { kind: 'CELL' }>, signal),
    enabled: scope !== null,
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">DCC Figures</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        What the people you oversee recorded for this month&rsquo;s Sundays, and how many of
        the leaders who owed a record filed one.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={report.data?.open} />

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

      {report.isPending || scope === null ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : report.data ? (
        <div className="mt-8 flex flex-col gap-10">
          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="text-lg font-medium">
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
              Counted across every Sunday of the month. A leader owes one record for each
              Sunday they were responsible for somebody, and a Sunday that has not happened
              owes nobody anything.
            </p>
          </section>

          <section aria-labelledby="month-heading">
            <h2 id="month-heading" className="text-lg font-medium">
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
                {report.data.removed_events.length === 1 ? ' that Sunday is' : ' those Sundays are'}{' '}
                not counted.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="people-heading">
            <h2 id="people-heading" className="text-lg font-medium">
              People who attended
            </h2>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {report.data.unique_people}
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Counted once each, however many Sundays they came to.
            </p>
          </section>

          <ClassificationFigures
            classification={report.data.classification}
            total={report.data.unique_people}
          />

          {report.data.n === 0 ? (
            <p className="text-muted max-w-2xl text-sm leading-relaxed">
              No Sundays were counted this month, so there is nothing to break down.
            </p>
          ) : (
            <AttendanceBuckets buckets={report.data.buckets} n={report.data.n} />
          )}
        </div>
      ) : null}
    </main>
  );
}
