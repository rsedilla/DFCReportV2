'use client';

import { AbsentPanel } from '@/components/absent-lists';
import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PeopleTabs } from '@/components/people-tabs';

/**
 * *Absent 3+ Months* (SKILL.md sections 3 and 19, decision 0397), the fourth tab of `People`
 * on the Full view screens, after Family Tree. The route decides who is listed; only the Admin
 * archives and restores.
 */
export default function AbsentPage() {
  return (
    <AppShell>
      <main id="main" className={PAGE_WIDTH.INDEX}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        </div>

        <PeopleTabs current="/people/absent">
          <AbsentPanel />
        </PeopleTabs>
      </main>
    </AppShell>
  );
}
