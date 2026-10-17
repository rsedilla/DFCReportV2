'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * The tabs of the People item: People, then *# of People* in Branch's place (decision 0364) for a
 * reader of reports, and Family Tree on Full view screens alone (decision 0341). Each is its own address, so Back, a reload and every
 * existing link keep working. The chosen tab opens into the pane that holds everything of it
 * (owner's choice of 2026-10-05).
 */
const TABS = [
  // Named for what the tab is for (owner, 2026-10-15, decision 0354); the sidebar item stays People.
  { href: '/people', label: 'Add People', name: undefined, fullOnly: false },
  // A `#` label keeps its words as the link's name (section 23), as Reports' do.
  { href: '/people/number-of-people', label: '# of People', name: 'Number of People', fullOnly: true },
  { href: '/family-tree', label: 'Family Tree', name: undefined, fullOnly: true },
] as const;

export function PeopleTabs({
  current,
  children,
}: {
  /** `/network`, Branch, is still reached by its address and marks no tab (decision 0364). */
  current: (typeof TABS)[number]['href'] | '/network';
  children: ReactNode;
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // **The recording screens have the People tab alone** (decision 0323), and *# of People* is a
  // report, so only a reader of reports is offered it (decision 0364). No tabs until the server
  // names the screens either, so no tab flashes (owner,
  // 2026-10-11). The pane stays where it is either way, so the screen inside it is not
  // remounted when the answer arrives and nothing typed into it is lost.
  const tabbed = !me.isPending && me.data?.screens !== 'RECORDING';

  return (
    <>
      {tabbed ? (
        <nav aria-label="People" className={cn('mt-6 flex', TAB_ROW)}>
          {TABS.filter((tab) => !tab.fullOnly || me.data?.screens === 'FULL').filter(
            (tab) =>
              tab.href !== '/people/number-of-people' ||
              (me.data?.capabilities ?? []).some((grant) => grant.capability === 'reports.view_subtree'),
          ).map((tab) => {
            const active = tab.href === current;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                aria-label={tab.name}
                className={tabClasses(active)}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>{children}</div>
    </>
  );
}
