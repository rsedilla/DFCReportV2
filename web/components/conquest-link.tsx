import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The way to Conquest, as a link above a tab row rather than a tab of it (decision 0406), on
 * Reports and on Growth. On the Conquest page itself it is marked as the current page and
 * carries no arrow, and the tabs beside it lead back.
 */
export function ConquestLink({ href, current }: { href: string; current: boolean }) {
  return (
    // A landmark of its own, so a screen reader finds it beside the tab row's (section 23).
    <nav aria-label="Conquest" className="mt-6 flex justify-end">
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'text-accent focus-visible:outline-accent inline-flex min-h-11 items-center text-sm font-bold',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          current ? 'no-underline' : 'underline underline-offset-4',
        )}
      >
        Conquest goals
        {current ? null : <span aria-hidden="true">&nbsp;→</span>}
      </Link>
    </nav>
  );
}
