'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TAB_PANE, TAB_ROW } from '@/components/ui/frame';
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
  if (me.data?.screens === 'RECORDING') {
    return <div className="mt-6">{children}</div>;
  }

  return (
    <>
      <nav aria-label="People" className={cn('mt-6 flex', TAB_ROW)}>
        {TABS.map((tab) => {
          const active = tab.href === current;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-visible:outline-accent inline-flex min-h-11 items-center border border-b-0 px-3 sm:px-4',
                'text-xs font-bold tracking-[0.08em] uppercase',
                'focus-visible:outline-2 focus-visible:-outline-offset-2',
                active
                  ? 'bg-accent text-surface border-accent'
                  : 'border-line text-ink hover:bg-raised',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className={TAB_PANE}>{children}</div>
    </>
  );
}
