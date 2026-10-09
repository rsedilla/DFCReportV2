'use client';

import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * The Senior Pastors' *Number of Cell Leaders* (SKILL.md section 19, decision 0326): the people
 * leading a Cell on a month's last day, for the whole church and each root's direct leaders.
 */
export default function NumberOfCellLeadersPage() {
  return (
    <AppShell>
      <NumberOfCellLeaders />
    </AppShell>
  );
}

function NumberOfCellLeaders() {
  const month = useSearchParams().get('month');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="The Cell Leaders, month by month." />
      <ReportsTabs current="number-of-cell-leaders" month={monthFromQuery(month)}>
        <ChurchCountsPanel figure="CELL_LEADERS" month={month} />
      </ReportsTabs>
    </main>
  );
}
