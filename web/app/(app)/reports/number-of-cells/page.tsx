'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { PAGE_WIDTH } from '@/components/app-shell';
import { BranchCountsPanel } from '@/components/branch-people';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { getMe, holdsNetwork, holdsWholeChurch } from '@/lib/me';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * *Number of Cell Groups* (SKILL.md section 19): the Cells running on a month's last day, by
 * category. A whole-church reader sees the whole church and each root's direct leaders
 * (decision 0326); a Full view leader sees their own branch (decision 0380). **The Senior
 * Pastors choose Men, Women or Both, and open a Primary's 12 from their name** (decision 0491),
 * as on *People* (decision 0490), with the way back to *Cells*.
 */
export default function NumberOfCellsPage() {
  return (
    <>
      <NumberOfCells />
    </>
  );
}

function NumberOfCells() {
  const params = useSearchParams();
  const month = params.get('month');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading current="number-of-cells" line="The Cell Groups running, month by month." />
      <ReportsTabs current="number-of-cells" month={monthFromQuery(month)}>
        {me.data === undefined ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : params.get('leader') !== null && me.data.screens === 'SENIOR_PASTOR' ? (
          // A Senior Pastor opens a Primary's 12 from their name, and goes down a level at a
          // time (decisions 0490 and 0491).
          <BranchCountsPanel
            figure="CELLS"
            readerId={me.data.person_id}
            leader={params.get('leader')}
            month={month}
            backLabel="Back to Cells"
            backNetwork={params.get('network')}
            drill={(id) =>
              `/reports/number-of-cells?${new URLSearchParams({
                leader: id,
                ...(month && monthFromQuery(month) !== monthFromQuery(null) ? { month } : {}),
                ...(params.get('network') ? { network: params.get('network')! } : {}),
              }).toString()}`
            }
          />
        ) : holdsWholeChurch(me.data, 'reports.view_subtree') ||
          holdsNetwork(me.data, 'reports.view_subtree') !== null ? (
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
