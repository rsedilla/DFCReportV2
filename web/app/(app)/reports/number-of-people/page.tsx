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
 * *# of People* under Reports for every reader that has it (SKILL.md sections 16 and 19;
 * decisions 0326 and 0376): everyone in a branch on a month's last day, whether or not they
 * attended. A whole-church reader, the Senior Pastors and the Admin, sees the whole church and
 * each root's direct leaders; a Full view leader sees their own branch, its names plain text
 * (decision 0364's figure, moved here from People; decision 0380). **The Senior Pastors also
 * choose Men, Women or Both, and open a Primary's 12 from their name** (decision 0490), which is
 * the Full view leader's view of that Primary's branch, with the way back to People.
 */
export default function NumberOfPeoplePage() {
  return (
    <>
      <NumberOfPeople />
    </>
  );
}

function NumberOfPeople() {
  const params = useSearchParams();
  const month = params.get('month');
  const leader = params.get('leader');
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const wholeChurch =
    holdsWholeChurch(me.data, 'reports.view_subtree') ||
    holdsNetwork(me.data, 'reports.view_subtree') !== null;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <ReportsHeading current="number-of-people" line="Everyone in your care, month by month." />
      <ReportsTabs current="number-of-people" month={monthFromQuery(month)}>
        {me.data === undefined ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : wholeChurch && leader !== null && me.data.screens === 'SENIOR_PASTOR' ? (
          // A Senior Pastor opens a Primary's 12 from their name (decision 0490).
          <BranchCountsPanel
            figure="PEOPLE"
            readerId={me.data.person_id}
            leader={leader}
            month={month}
            backLabel="Back to People"
            backNetwork={params.get('network')}
            // Down another level, keeping the month and the Network chosen (decision 0490).
            drill={(id) =>
              `/reports/number-of-people?${new URLSearchParams({
                leader: id,
                ...(month && monthFromQuery(month) !== monthFromQuery(null) ? { month } : {}),
                ...(params.get('network') ? { network: params.get('network')! } : {}),
              }).toString()}`
            }
          />
        ) : wholeChurch ? (
          <ChurchCountsPanel figure="PEOPLE" month={month} />
        ) : (
          <BranchCountsPanel figure="PEOPLE" readerId={me.data.person_id} leader={leader} month={month} />
        )}
      </ReportsTabs>
    </main>
  );
}
