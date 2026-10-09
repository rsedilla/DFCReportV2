'use client';

import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * The Senior Pastors' *Number of people* (SKILL.md sections 16 and 19, decision 0326): every
 * current person on a month's last day, for the whole church and each root's direct leaders,
 * a row counting that leader and everyone beneath them, whether or not they attended.
 */
export default function NumberOfPeoplePage() {
  return (
    <AppShell>
      <NumberOfPeople />
    </AppShell>
  );
}

function NumberOfPeople() {
  const month = useSearchParams().get('month');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Everyone in each branch, month by month." />
      <ReportsTabs current="number-of-people" month={monthFromQuery(month)}>
        <ChurchCountsPanel figure="PEOPLE" month={month} />
      </ReportsTabs>
    </main>
  );
}
