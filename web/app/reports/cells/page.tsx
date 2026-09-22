'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets, ClassificationFigures } from '@/components/attendance-figures';
import { CoverageFigure } from '@/components/coverage-figure';
import { HowTheseAreCounted } from '@/components/how-counted';
import { MonthPicker } from '@/components/month-picker';
import { LeaderDrill } from '@/components/leader-drill';
import { CoverageByCell } from '@/components/report-coverage';
import { CoverageByLeader, CoverageSwitch } from '@/components/report-coverage-by-leader';
import { PeriodSwitch, YearPicker, YearTable, currentYear } from '@/components/report-year';
import { ReportsSwitch } from '@/components/reports-switch';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { listAllCells } from '@/lib/cells';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { getCellMonthlyReport, hasBuckets, type ReportScope } from '@/lib/reports';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * Cell attendance figures for a month, one of the two reports under Reports (SKILL.md
 * sections 12, 13, 17, 19 and 20; decisions 0202, 0216, 0225 and 0245).
 *
 * **Coverage leads, and that is decision 0202 rather than a layout preference.**
 * It is the first thing on the screen because its denominator is derived from the
 * Cell's schedule against the calendar rather than from anything a leader
 * submitted — so recording less makes it worse and never better, which is the one
 * figure here that cannot be improved by reporting less. Unique people and
 * classification follow it.
 *
 * **Buckets appear only when a single Cell is selected** (section 12). `N` belongs
 * to a Cell, so an aggregate `Completed` would mean "attended everything their own
 * Cell happened to record" and would be inflated by exactly the Cells that
 * recorded least. That is enforced by the report's own type rather than by a
 * condition here: the aggregate arm carries no `buckets` field at all.
 *
 * **The scope options are read from the account's own grants**, so a leader with no
 * church-wide grant is not offered a control that would only ever be refused. That
 * is courtesy and not authorization — the API decides on every request, and this
 * screen would show its refusal if the two ever disagreed.
 *
 * **The next month is not offered.** A report may not name a period that has not
 * begun (decision 0216), so a control leading there would only produce a
 * validation error.
 *
 * **Nothing is ranked or colour-graded** (sections 13, 17 and 19), and the Cell
 * picker lists Cells in the order the API returns them, which ranks nobody. The
 * section labels are red and every figure is not.
 *
 * **Coverage by Cell closes the aggregate view**, one row per Cell from the Cells
 * index, and is left out once a single Cell is chosen. It carries no total row;
 * `components/report-coverage.tsx` says why.
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
  const [month, setMonth] = useState(() => monthFromQuery(search.get('month')));
  // A month or a year of this report (decision 0257). The year is the month's own year.
  const [period, setPeriod] = useState<'month' | 'year'>(() =>
    search.get('period') === 'year' ? 'year' : 'month',
  );
  const [year, setYear] = useState(() => Math.min(Number(month.slice(0, 4)), currentYear()));
  const [cellId, setCellId] = useState<string>('');
  // A leader opened from the By leader table (decision 0254), carried in the address so
  // the browser's Back returns to the report it was opened from.
  const leader = search.get('leader');
  const [coverageBy, setCoverageBy] = useState<'first' | 'leader'>('first');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');

  // Every page of the index, not the first: a picker has to offer the whole list, and
  // the Coverage by Cell table below reads the same query.
  const cells = useQuery({
    queryKey: ['cells-all', month],
    queryFn: ({ signal }) => listAllCells(month, signal),
  });

  // The actor's own subtree by default: every leader can read it, and it is the
  // question a leader opening this screen is actually asking.
  // **A Whole Church grant is read as Whole Church**, and the option's label says
  // which. Keying on the actor's own subtree is right for a leader and wrong for
  // anybody holding a church-wide grant who is not in the pastoral tree — section
  // 5 permits that for an administrator, and section 20 then places them in no
  // subtree. The label said "Everyone in your scope" while the query asked about
  // one person, which is the disagreement this closes.
  // Narrower than `ReportScope`: this route refuses `NETWORK`, because what such a
  // figure narrows is unstated in section 20 and recorded as open. The type says so.
  const scope: Exclude<ReportScope, { kind: 'NETWORK' }> | null = leader
    ? { kind: 'LEADER', person_id: leader }
    : cellId !== ''
      ? { kind: 'CELL', cell_id: cellId }
      : wholeChurch
        ? { kind: 'WHOLE_CHURCH' }
        : me.data
          ? { kind: 'LEADER', person_id: me.data.person_id }
          : null;

  const report = useQuery({
    queryKey: ['cell-report', month, scope],
    queryFn: ({ signal }) =>
      getCellMonthlyReport(month, scope as Exclude<ReportScope, { kind: 'NETWORK' }>, signal),
    enabled: scope !== null && period === 'month',
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <HowTheseAreCounted report="cells" />
      </div>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        What your Cells recorded {period === 'year' ? 'each month' : 'this month'}.
      </p>

      {/* Every control in one bar, above every figure (owner's choice, 2026-09-22). */}
      <div className={`mt-6 ${CONTROL_BAR}`}>
        <ReportsSwitch current="cells" month={month} />
        <PeriodSwitch value={period} onChange={setPeriod} />
        {period === 'month' ? (
          <MonthPicker month={month} onChange={setMonth} open={report.data?.open} />
        ) : (
          <YearPicker year={year} onChange={setYear} />
        )}
        <div hidden={leader !== null}>
          <label htmlFor="cell-scope" className="field-label block">
            Figures for
          </label>
          <select
            id="cell-scope"
            value={cellId}
            onChange={(event) => setCellId(event.target.value)}
            className="border-line bg-surface focus-visible:outline-accent mt-2 min-h-11 max-w-full rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">
              {wholeChurch ? 'Everyone in your scope' : 'Everyone you oversee'}
            </option>
            {(cells.data ?? []).map((cell) => (
              <option key={cell.id} value={cell.id}>
                {cell.cell_id} — {cell.leader.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {leader ? <LeaderDrill personId={leader} report="cells" month={month} /> : null}

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
            report="cells"
            year={year}
            scope={scope}
          />
        )
      ) : report.isPending || scope === null ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : report.data ? (
        <div className="mt-6 flex flex-col gap-4">
          {/* Coverage first, because it cannot be improved by recording less (decision 0202). */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="coverage-heading" className={FRAME}>
              <h2 id="coverage-heading" className="field-label">
                Recording coverage
              </h2>
              <p className="mt-2">
                <CoverageFigure
                  recorded={report.data.coverage.recorded}
                  scheduled={report.data.coverage.scheduled}
                  unit="meetings recorded"
                  headline
                />
              </p>
              <p className="text-muted mt-2 text-sm leading-relaxed">
                Out of the meetings the schedule says were due.
              </p>
            </section>

            <section aria-labelledby="people-heading" className={FRAME}>
              <h2 id="people-heading" className="field-label">
                People who attended
              </h2>
              <p className="mt-2 text-xl font-semibold tabular-nums">{report.data.unique_people}</p>
              <p className="text-muted mt-2 text-sm leading-relaxed">
                Counted once, however many meetings.
              </p>
            </section>
          </div>

          {/* Side by side from `lg` where a single Cell has buckets; full width otherwise. */}
          <div className={`grid gap-4 ${hasBuckets(report.data) ? 'lg:grid-cols-2' : ''}`}>
            <ClassificationFigures classification={report.data.classification} />

            {hasBuckets(report.data) ? (
              report.data.n === 0 ? (
                // Section 12: where N is zero the view shows the coverage line alone
                // and no buckets — a bucket every person satisfies is not a bucket.
                <p className={`${FRAME} text-muted text-sm leading-relaxed`}>
                  This Cell recorded no meetings this month, so there is nobody to count and no
                  buckets to show. The coverage line above is what explains it.
                </p>
              ) : (
                <AttendanceBuckets
                  buckets={report.data.buckets}
                  n={report.data.n}
                  // Section 12: N is the meetings that actually took place and were
                  // recorded, which is not the coverage denominator beside it.
                  summary={(n) =>
                    n === 1
                      ? 'One meeting was recorded this month.'
                      : `${n} meetings were recorded this month.`
                  }
                />
              )
            ) : null}
          </div>

          <section aria-labelledby="coverage-by-heading" className={FRAME}>
            <h2 id="coverage-by-heading" className="field-label">
              Row by row
            </h2>
            {/*
              By Cell lists the reader's own Cells, so it is offered only where that is the
              report's scope: not once one Cell is chosen, and not for a leader opened from
              the list.
            */}
            <CoverageSwitch
              first={cellId === '' && !leader ? 'By Cell' : null}
              value={cellId === '' && !leader ? coverageBy : 'leader'}
              onChange={setCoverageBy}
            />
            {cellId === '' && !leader && coverageBy === 'first' ? (
              <CoverageByCell month={month} behindOnlyAtFirst={search.get('behind') === '1'} />
            ) : scope ? (
              <CoverageByLeader
                key={`${month}-${JSON.stringify(scope)}`}
                report="cells"
                month={month}
                scope={scope}
                unit="meetings"
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
