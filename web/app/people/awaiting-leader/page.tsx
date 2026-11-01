'use client';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { AwaitingLeaderList } from '@/components/awaiting-lists';
import { PeopleTabs } from '@/components/people-tabs';

/**
 * *No Leader Yet* (SKILL.md sections 15, 19 and 20; decisions 0232 and 0356), a tab
 * of `People` since decision 0381: its remedy is moving a person to a leader, which is done from
 * the person's page, and it was not recording work. On the Full view screens alone, as Family
 * Tree is; the route decides who is listed.
 */
export default function AwaitingLeaderPage() {
  return (
    <AppShell>
      <main id="main" className={PAGE_WIDTH.INDEX}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        </div>

        <PeopleTabs current="/people/awaiting-leader">
          <AwaitingLeaderList />
        </PeopleTabs>
      </main>
    </AppShell>
  );
}
