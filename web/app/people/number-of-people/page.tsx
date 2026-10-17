'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { BranchPeoplePanel } from '@/components/branch-people';
import { ChurchCountsPanel } from '@/components/church-counts';
import { PeopleTabs } from '@/components/people-tabs';
import { getMe, holdsWholeChurch } from '@/lib/me';

/**
 * *# of People* under People (decision 0364), in Branch's place: everyone in a branch, month by
 * month. A reader of the whole church's reports, the Admin, sees the Senior Pastors' figure, the
 * whole church and both roots' tables; a Full view leader sees their own branch and can open a
 * leader beneath them.
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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-muted text-sm">Everyone in each branch, month by month.</p>
      </div>
      <PeopleTabs current="/people/number-of-people">
        {me.data === undefined ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : wholeChurch ? (
          <ChurchCountsPanel figure="PEOPLE" month={month} />
        ) : (
          <BranchPeoplePanel readerId={me.data.person_id} leader={leader} month={month} />
        )}
      </PeopleTabs>
    </main>
  );
}
