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
 * *Number of Cell Leaders* (SKILL.md section 19): the people leading a Cell on a month's last
 * day. A whole-church reader sees the whole church and each root's direct leaders (decision
 * 0326); a Full view leader sees their own branch (decision 0380).
 */
export default function NumberOfCellLeadersPage() {
  return (
    <AppShell>
      <NumberOfCellLeaders />
    </AppShell>
  );
}

function NumberOfCellLeaders() {
  const params = useSearchParams();
  const month = params.get('month');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="The Cell Leaders, month by month." />
      <ReportsTabs current="number-of-cell-leaders" month={monthFromQuery(month)}>
        {me.data === undefined ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : holdsWholeChurch(me.data, 'reports.view_subtree') ? (
          <ChurchCountsPanel figure="CELL_LEADERS" month={month} />
        ) : (
          <BranchCountsPanel
            figure="CELL_LEADERS"
            readerId={me.data.person_id}
            leader={params.get('leader')}
            month={month}
          />
        )}
      </ReportsTabs>
    </main>
  );
}
