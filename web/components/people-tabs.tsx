'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useAwaitingLeader } from '@/components/awaiting-lists';
import { TAB_PANE, TAB_ROW, countClasses, tabClasses } from '@/components/ui/frame';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * The tabs of the People item: People, then Awaiting Leader Assignment (decision 0381) and
 * Family Tree (decision 0341) on Full view screens alone. *# of People* is a report and is under Reports (decision 0376). Each is its own
 * address, so Back, a reload and every existing link keep working. The chosen tab opens into
 * the pane that holds everything of it (owner's choice of 2026-10-05).
 */
const TABS = [
  // Named for what the tab is for (owner, 2026-10-15, decision 0354); the sidebar item stays People.
  { href: '/people', label: 'Add People', name: undefined, fullOnly: false },
  // Moved here from Record (decision 0381), with its count.
  { href: '/people/awaiting-leader', label: 'Awaiting Leader Assignment', name: undefined, fullOnly: true },
  { href: '/family-tree', label: 'Family Tree', name: undefined, fullOnly: true },
] as const;

export function PeopleTabs({
  current,
  within = false,
  children,
}: {
  /** `/network`, Branch, is still reached by its address and marks no tab (decision 0364). */
  current: (typeof TABS)[number]['href'] | '/network';
  /** A page reached from the tab rather than the tab itself: shown chosen, not the current page. */
  within?: boolean;
  children: ReactNode;
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const awaiting = useAwaitingLeader(me.data?.screens === 'FULL');

  // **The recording screens have the People tab alone** (decision 0323), as one tab in the same
  // frame (owner, 2026-10-19); Family Tree is the Full view screens' (decision 0341), keyed
  // on the screens the server names and never on a
  // capability. No tabs until the server names the screens either, so no tab flashes (owner,
  // 2026-10-11). The pane stays where it is either way, so the screen inside it is not
  // remounted when the answer arrives and nothing typed into it is lost.
  const tabbed = !me.isPending;

  return (
    <>
      {tabbed ? (
        <nav aria-label="People" className={cn('mt-6 flex', TAB_ROW)}>
          {TABS.filter((tab) => !tab.fullOnly || me.data?.screens === 'FULL').map((tab) => {
            const active = tab.href === current;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active && !within ? 'page' : undefined}
                aria-label={tab.name}
                className={cn(tabClasses(active), 'inline-flex items-center gap-2')}
              >
                {tab.label}
                {/* Its count, as it had on Record; a 0 shows no box (decision 0349). */}
                {tab.href === '/people/awaiting-leader' &&
                awaiting.count !== null &&
                awaiting.count !== '0' ? (
                  <span className={countClasses(active)}>{awaiting.count}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>{children}</div>
    </>
  );
}
