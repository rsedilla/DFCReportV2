import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The two tabs of the People item, People and Network (decision 0288). Each is its own
 * address, so Back, a reload and every existing link keep working; the two screens are
 * otherwise as they were.
 */
const TABS = [
  { href: '/people', label: 'People' },
  { href: '/network', label: 'Network' },
] as const;

export function PeopleTabs({ current }: { current: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="People" className="border-line mt-6 flex border-b">
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
  );
}
