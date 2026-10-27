'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PeopleTabs } from '@/components/people-tabs';
import { TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { getMe } from '@/lib/me';
import { useOffered } from '@/lib/screen-guard';
import { cn } from '@/lib/utils';

/** The sidebar section a page opened from another one belongs to. */
export type Section = 'people' | 'cells' | 'record' | 'account';

/**
 * A page reached from inside a section, framed as that section's own pages are (owner,
 * 2026-10-20): the section's name, its tab row with the tab the page was reached from
 * shown chosen, and the pane holding the page. Without it these pages floated on the white
 * page beside every framed one.
 *
 * **The section's name is not a heading.** The page's own title stays its one `h1`, first
 * inside the pane after the way back, so a screen reader still hears the page it is on; the
 * name above the tabs is where the reader is, as the sidebar says too.
 *
 * **The chosen tab is not this page.** It links back to the list the page was reached from
 * and carries no `aria-current`, which stays with the sidebar entry alone.
 */
export function SectionFrame({ section, children }: { section: Section; children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // The recording screens reach a Cell's pages from My Cell (decision 0323), and the others
  // from the Cells list.
  const recording = me.data?.screens === 'RECORDING';
  const frame: Record<Exclude<Section, 'people'>, { name: string; tab: string; href: string }> = {
    cells: recording
      ? { name: 'My Cell', tab: 'My Cell', href: '/my-cell' }
      : { name: 'Cells', tab: 'Active Cells', href: '/cells' },
    record: { name: 'Record', tab: 'Update Records', href: '/dashboard?list=awaiting' },
    account: { name: 'Account', tab: 'Account and session', href: '/session' },
  };
  const chosen = section === 'people' ? null : frame[section];
  // A tab whose page is not on this account's screens is not offered (decision 0379): the
  // Senior Pastors reach a Cell's pages from Record and have no Cells list.
  const offered = useOffered();
  const tabShown = chosen !== null && offered(chosen.href);

  return (
    <>
      <p className="text-2xl font-semibold tracking-tight">
        {section === 'people' ? 'People' : chosen!.name}
      </p>
      {section === 'people' ? (
        <PeopleTabs current="/people" within>
          <div className="pt-4">{children}</div>
        </PeopleTabs>
      ) : (
        <>
          {tabShown ? (
            <nav aria-label={chosen!.name} className={cn('mt-6 flex', TAB_ROW)}>
              <Link href={chosen!.href} className={tabClasses(true)}>
                {chosen!.tab}
              </Link>
            </nav>
          ) : null}
          <div className={tabShown ? cn(TAB_PANE, 'pt-4') : 'mt-6'}>{children}</div>
        </>
      )}
    </>
  );
}
