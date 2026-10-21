'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { BranchCountsPanel } from '@/components/branch-people';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * *Number of Cell Groups* (SKILL.md section 19): the Cells running on a month's last day, by
 * category. A whole-church reader sees the whole church and each root's direct leaders
 * (decision 0326); a Full view leader sees their own branch (decision 0380).
 */
export default function NumberOfCellsPage() {
  return (
    <AppShell>
      <NumberOfCells />
    </AppShell>
  );
}

function NumberOfCells() {
  const params = useSearchParams();
  const month = params.get('month');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="The Cell Groups running, month by month." />
      <ReportsTabs current="number-of-cells" month={monthFromQuery(month)}>
        {me.data === undefined ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : holdsWholeChurch(me.data, 'reports.view_subtree') ? (
          <ChurchCountsPanel figure="CELLS" month={month} />
        ) : (
          <BranchCountsPanel
            figure="CELLS"
            readerId={me.data.person_id}
            leader={params.get('leader')}
            month={month}
          />
        )}
      </ReportsTabs>
    </main>
  );
}
