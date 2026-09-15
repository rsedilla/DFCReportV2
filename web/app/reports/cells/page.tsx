'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AttendanceBuckets, ClassificationFigures } from '@/components/attendance-figures';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { CoverageByCell } from '@/components/report-coverage';
import { ReportsSwitch } from '@/components/reports-switch';
import { FailureNotice } from '@/components/ui/failure-notice';
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
  const [cellId, setCellId] = useState<string>('');

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
  const scope: Exclude<ReportScope, { kind: 'NETWORK' }> | null =
    cellId !== ''
      ? { kind: 'CELL', cell_id: cellId }
      : wholeChurch
        ? { kind: 'WHOLE_CHURCH' }
        : me.data
          ? { kind: 'LEADER', person_id: me.data.person_id }
          : null;

  const report = useQuery({
    queryKey: ['cell-report', month, scope],
    queryFn: ({ signal }) => getCellMonthlyReport(month, scope as Exclude<ReportScope, { kind: 'NETWORK' }>, signal),
    enabled: scope !== null,
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <ReportsSwitch current="cells" month={month} />
      <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
        What your Cells recorded this month. Recording coverage comes first, because it is
        the one figure that cannot be improved by recording less.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={report.data?.open} />

      <div className="mt-4">
        <label htmlFor="cell-scope" className="field-label block">
          Figures for
        </label>
        <select
          id="cell-scope"
          value={cellId}
          onChange={(event) => setCellId(event.target.value)}
          className="border-line focus-visible:outline-accent mt-2 min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
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
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          How often people came is shown for a single Cell only. Across several Cells it would
          mean &ldquo;attended everything their own Cell happened to record&rdquo;, which reads
          best for the Cells that recorded least.
        </p>
      </div>

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
            <h2 id="coverage-heading" className="field-label">
              Recording coverage
            </h2>
            <p className="mt-2">
              <CoverageFigure
                recorded={report.data.coverage.recorded}
                scheduled={report.data.coverage.scheduled}
                unit="meetings recorded"
              />
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Out of the meetings the schedule says these Cells were due to hold. A Cell that
              scheduled nothing this month counts as none of each and is not left out.
            </p>
          </section>

          <section aria-labelledby="people-heading">
            <h2 id="people-heading" className="field-label">
              People who attended
            </h2>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {report.data.unique_people}
            </p>
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Counted once each, however many meetings they came to.
            </p>
          </section>

          {/* Side by side from `lg`, one under the other below it. */}
          <div className="grid gap-10 lg:grid-cols-2">
            <ClassificationFigures classification={report.data.classification} />

            {hasBuckets(report.data) ? (
              report.data.n === 0 ? (
                // Section 12: where N is zero the view shows the coverage line alone
                // and no buckets — a bucket every person satisfies is not a bucket.
                <p className="text-muted max-w-2xl text-sm leading-relaxed">
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

          {/* One row per Cell is the aggregate broken down, so it has no place once one Cell is chosen. */}
          {cellId === '' ? <CoverageByCell month={month} /> : null}
        </div>
      ) : null}
    </main>
  );
}
