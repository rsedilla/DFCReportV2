'use client';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { MyPeopleList } from '@/components/my-people-list';
import { PeopleTabs } from '@/components/people-tabs';

/**
 * *My People*, a second tab of People for a leader without Full view (SKILL.md section 19,
 * decision 0422): their people two levels down, as a plain list.
 */
export default function MyPeoplePage() {
  return (
    <AppShell>
      <main id="main" className={PAGE_WIDTH.INDEX}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        </div>
        <PeopleTabs current="/people/mine">
          <MyPeopleList />
        </PeopleTabs>
      </main>
    </AppShell>
  );
}
