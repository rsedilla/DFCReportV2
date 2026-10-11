'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { getMe } from '@/lib/me';
import { cn } from '@/lib/utils';

/**
 * The two tabs of the People item, People and Branch (decisions 0288 and 0318). Each is its own
 * address, so Back, a reload and every existing link keep working; the two screens are
 * otherwise as they were. The chosen tab opens into the pane that holds everything of it
 * (owner's choice of 2026-10-05).
 */
const TABS = [
  { href: '/people', label: 'People' },
  { href: '/network', label: 'Branch' },
] as const;

export function PeopleTabs({
  current,
  children,
}: {
  current: (typeof TABS)[number]['href'];
  children: ReactNode;
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // **The recording screens have the People tab alone, without Branch** (decision 0323).
  // No tabs until the server names the screens either, so Branch never flashes (owner,
  // 2026-10-11). The pane stays where it is either way, so the screen inside it is not
  // remounted when the answer arrives and nothing typed into it is lost.
  const tabbed = !me.isPending && me.data?.screens !== 'RECORDING';

  return (
    <>
      {tabbed ? (
        <nav aria-label="People" className={cn('mt-6 flex', TAB_ROW)}>
          {TABS.map((tab) => {
            const active = tab.href === current;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
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
