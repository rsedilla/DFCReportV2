'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { LeaderDrill } from '@/components/leader-drill';
import { MonthPicker } from '@/components/month-picker';
import { CoverageByCell, CoverageBySunday } from '@/components/report-coverage';
import { CoverageByLeader, CoverageSwitch } from '@/components/report-coverage-by-leader';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import {
  getCellMonthlyReport,
  getDccMonthlyReport,
  type ReportNetwork,
  type ReportScope,
} from '@/lib/reports';
import { monthFromQuery } from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';

/**
 * What has been filed, and by whom (SKILL.md sections 9, 12, 17 and 19; decision 0292).
 *
 * **The rows that used to close the Cell Groups and DCC reports**: By Cell or By Sunday, and
 * By leader, each under the coverage figure it breaks down. The figure also stays first on
 * its own report, because it is the one figure there that recording less cannot improve
 * (decision 0202), so an attendance figure is never read without it.
 *
 * **The scope is the report's own**, carried in the address from the report it came from:
 * Whole Church for a whole-church grant, otherwise the reader's own branch, or one leader, one
 * Cell or one Network where the report had narrowed to it. By Cell and By Sunday list the
 * reader's own Cells and calendar, so they are offered only at the reader's own scope.
 */
export default function FiledReportsPage() {
  return (
    <AppShell>
      <FiledReports />
    </AppShell>
  );
}

function FiledReports() {
  const search = useSearchParams();
  const go = useScreenAddress();
  const month = monthFromQuery(search.get('month'));
  const kind: 'cells' | 'dcc' = search.get('kind') === 'dcc' ? 'dcc' : 'cells';
  const leader = search.get('leader');
  // The narrower scopes each report offers: one Cell on Cell Groups, one Network on DCC.
  const cellId = kind === 'cells' ? (search.get('cell') ?? '') : '';
  const networkParam = search.get('network');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');
  // A Network narrows only a whole-church reader's figures, as on the DCC report, so an
  // address naming one is ignored rather than claimed for anybody else.
  const network: ReportNetwork | '' =
    kind === 'dcc' && wholeChurch && (networkParam === 'MENS' || networkParam === 'WOMENS')
      ? networkParam
      : '';
  const own: ReportScope | null = wholeChurch
    ? { kind: 'WHOLE_CHURCH' }
    : me.data
      ? { kind: 'LEADER', person_id: me.data.person_id }
      : null;
  const cellScope: Exclude<ReportScope, { kind: 'NETWORK' }> | null = leader
    ? { kind: 'LEADER', person_id: leader }
    : cellId !== ''
      ? { kind: 'CELL', cell_id: cellId }
      : (own as Exclude<ReportScope, { kind: 'NETWORK' }> | null);
  const dccScope: Exclude<ReportScope, { kind: 'CELL' }> | null = leader
    ? { kind: 'LEADER', person_id: leader }
    : network !== ''
      ? { kind: 'NETWORK', network }
      : (own as Exclude<ReportScope, { kind: 'CELL' }> | null);
  const scope: ReportScope | null = kind === 'cells' ? cellScope : dccScope;

  // By Cell and By Sunday list the reader's own Cells and calendar, so they are offered only
  // at the reader's own scope, exactly as they were on the two reports.
  const firstOffered = !leader && cellId === '' && network === '';
  const by: 'first' | 'leader' = firstOffered && search.get('by') !== 'leader' ? 'first' : 'leader';
  const behindOnly = search.get('behind') === '1';

  // The same keys as the two reports, so moving between them reads each figure once.
  const cells = useQuery({
    queryKey: ['cell-report', month, cellScope],
    queryFn: ({ signal }) => getCellMonthlyReport(month, cellScope!, signal),
    enabled: cellScope !== null && kind === 'cells',
  });
  const dcc = useQuery({
    queryKey: ['dcc-report', month, dccScope],
    queryFn: ({ signal }) => getDccMonthlyReport(month, dccScope!, signal),
    enabled: dccScope !== null && kind === 'dcc',
  });
  const report = kind === 'cells' ? cells : dcc;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="What has been filed, and by whom." />
      <ReportsTabs current="filed" month={month}>
        {/* Named for what is filed, so it never repeats the report tabs' names. */}
        <ViewSwitch
          label="Which records"
          options={[
            { key: 'cells', label: 'Cell meetings' },
            { key: 'dcc', label: 'DCC Sundays' },
          ]}
          value={kind}
          onChange={(key) => go({ kind: key === 'dcc' ? 'dcc' : null, cell: null, network: null })}
        />

        <div className={`mt-4 ${CONTROL_BAR}`}>
          <MonthPicker month={month} onChange={(value) => go({ month: value })} open={report.data?.open} />
        </div>

        {leader ? <LeaderDrill personId={leader} report={kind} month={month} /> : null}
        {!leader && network !== '' ? (
          <p className="text-muted mt-4 text-sm">
            Figures for the {network === 'MENS' ? 'Men’s' : 'Women’s'} Network.
          </p>
        ) : null}
        {!leader && cellId !== '' ? (
          <p className="text-muted mt-4 text-sm">Figures for one Cell.</p>
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

        <div className="mt-6 flex flex-col gap-4">
          <section aria-labelledby="coverage-heading" className={FRAME}>
            <h2 id="coverage-heading" className="field-label">
              Recording coverage
            </h2>
            <p className="mt-2">
              {cells.data && kind === 'cells' ? (
                <CoverageFigure
                  recorded={cells.data.coverage.recorded}
                  scheduled={cells.data.coverage.scheduled}
                  unit="meetings recorded"
                  headline
                />
              ) : dcc.data && kind === 'dcc' ? (
                <CoverageFigure
                  recorded={dcc.data.coverage.met}
                  scheduled={dcc.data.coverage.owed}
                  unit="records filed"
                  headline
                />
              ) : (
                <span className="text-muted text-sm">Loading&hellip;</span>
              )}
            </p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {kind === 'cells'
                ? 'Out of the meetings the schedule says were due.'
                : 'One per Sunday a leader was responsible for somebody.'}
            </p>
          </section>

          <section aria-labelledby="coverage-by-heading" className={FRAME}>
            <h2 id="coverage-by-heading" className="field-label">
              Row by row
            </h2>
            <CoverageSwitch
              first={firstOffered ? (kind === 'cells' ? 'By Cell' : 'By Sunday') : null}
              value={by}
              onChange={(value) => go({ by: value === 'leader' ? 'leader' : null })}
            />
            {by === 'first' ? (
              kind === 'cells' ? (
                <CoverageByCell
                  month={month}
                  behindOnly={behindOnly}
                  onBehindOnlyChange={(on) => go({ behind: on ? '1' : null })}
                />
              ) : (
                <CoverageBySunday month={month} />
              )
            ) : scope ? (
              <CoverageByLeader
                key={`${kind}-${month}-${JSON.stringify(scope)}`}
                report={kind}
                month={month}
                scope={scope}
                unit={kind === 'cells' ? 'meetings' : 'records'}
              />
            ) : null}
          </section>
        </div>
      </ReportsTabs>
    </main>
  );
}
