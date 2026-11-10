'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PeopleTabs } from '@/components/people-tabs';
import { TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
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
export function SectionFrame({
  section,
  children,
  bare = false,
}: {
  section: Section;
  children: ReactNode;
  /**
   * The pane alone, with no section name or tab above it (decision 0466): a page that opens on
   * its own way back, where the sidebar already says which section it is in.
   */
  bare?: boolean;
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // The recording screens reach a Cell's pages from My Cell (decision 0323), and the others
  // from the Cells list.
  const recording = me.data?.screens === 'RECORDING';
  const frame: Record<Exclude<Section, 'people'>, { name: string; tab: string; href: string }> = {
    cells: recording
      ? { name: 'Cells', tab: 'My Cell', href: '/my-cell' }
      : { name: 'Cells', tab: 'Active Cells', href: '/cells' },
    record: { name: 'Record', tab: 'Update Records', href: '/dashboard?list=awaiting' },
    account: { name: 'Account', tab: 'My Account', href: '/session' },
  };
  const chosen = section === 'people' ? null : frame[section];
  // A tab whose page is not on this account's screens is not offered (decision 0379): the
  // Senior Pastors reach a Cell's pages from Record and have no Cells list.
  const offered = useOffered();
  // **Account draws no tab row** (owner, 2026-11-02): one tab that names the page itself offers
  // no choice, as decision 0420 says of Growth. Cells and Record keep theirs, which lead back.
  const tabShown = chosen !== null && section !== 'account' && offered(chosen.href);

  if (bare) {
    return <div className={cn(TAB_PANE, 'rounded-xl border-t pt-4')}>{children}</div>;
  }

  return (
    <>
      <p className="text-2xl font-semibold tracking-tight">
        {section === 'people' ? 'People' : chosen!.name}
      </p>
      {section === 'people' ? (
        // No tab chosen: a person's page is no tab's, and "Add People" chosen read as adding one.
        <PeopleTabs current={null}>
          <div className="pt-4">{children}</div>
        </PeopleTabs>
      ) : (
        <>
          {tabShown ? (
            <nav aria-label={chosen!.name} className={cn('mt-6', TAB_GRID, TAB_ROW)}>
              <Link href={chosen!.href} className={tabClasses(true)}>
                {chosen!.tab}
              </Link>
            </nav>
          ) : null}
          <div
            className={
              tabShown
                ? cn(TAB_PANE, 'pt-4')
                : section === 'account'
                  ? cn(TAB_PANE, 'mt-6 border-t-2 pt-4')
                  : 'mt-6'
            }
          >
            {children}
          </div>
        </>
      )}
    </>
  );
}
