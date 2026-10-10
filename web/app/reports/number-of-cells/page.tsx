'use client';

import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * The Senior Pastors' *Number of Cells* (SKILL.md section 19, decision 0326): the Cells running
 * on a month's last day, by category, and the people leading them, for the whole church and
 * each root's direct leaders.
 */
export default function NumberOfCellsPage() {
  return (
    <AppShell>
      <NumberOfCells />
    </AppShell>
  );
}

function NumberOfCells() {
  const month = useSearchParams().get('month');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="The Cells running, month by month." />
      <ReportsTabs current="number-of-cells" month={monthFromQuery(month)}>
        <ChurchCountsPanel figure="CELLS" month={month} />
      </ReportsTabs>
    </main>
  );
}
