'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { BranchPeoplePanel } from '@/components/branch-people';
import { ChurchCountsPanel } from '@/components/church-counts';
import { ReportsHeading, ReportsTabs } from '@/components/reports-tabs';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * *# of People* under Reports for every reader that has it (SKILL.md sections 16 and 19;
 * decisions 0326 and 0376): everyone in a branch on a month's last day, whether or not they
 * attended. A whole-church reader, the Senior Pastors and the Admin, sees the whole church and
 * each root's direct leaders; a Full view leader sees their own branch and can open a leader
 * beneath them (decision 0364's figure, moved here from People).
 */
export default function NumberOfPeoplePage() {
  return (
    <AppShell>
      <NumberOfPeople />
    </AppShell>
  );
}

function NumberOfPeople() {
  const params = useSearchParams();
  const month = params.get('month');
  const leader = params.get('leader');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch = holdsWholeChurch(me.data, 'reports.view_subtree');

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading line="Everyone in each branch, month by month." />
      <ReportsTabs current="number-of-people" month={monthFromQuery(month)}>
        {me.data === undefined ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : wholeChurch ? (
          <ChurchCountsPanel figure="PEOPLE" month={month} />
        ) : (
          <BranchPeoplePanel readerId={me.data.person_id} leader={leader} month={month} />
        )}
      </ReportsTabs>
    </main>
  );
}
