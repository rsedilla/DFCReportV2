'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';

import { TAB_GRID, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';

/** The two tabs, in order. */
const TABS = [
  { key: 'mine', label: 'My Cell', href: '/my-cell' },
  { key: 'new', label: 'Request New Cell', href: '/my-cell/new' },
] as const;

export type MyCellTab = (typeof TABS)[number]['key'];

/**
 * The recording screens' Cells (decision 0457): titled `Cells`, as the sidebar and the phone's
 * bottom bar name it, with two tabs, the reader's own Cells and asking for a new one. Asking
 * is a tab of its own address rather than a dialog over the list, so the form fills the page
 * on a phone and the phone's Back returns to My Cell.
 *
 * `onLeave` is offered the click on the other tab first, so a form with something typed in it
 * can ask before it is thrown away.
 */
export function MyCellTabs({
  current,
  onLeave,
  children,
}: {
  current: MyCellTab;
  onLeave?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  children: ReactNode;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Cells</h1>
      <nav aria-label="Cells" className={`mt-6 ${TAB_GRID} ${TAB_ROW}`}>
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? 'page' : undefined}
            className={tabClasses(tab.key === current)}
            onClick={tab.key === current ? undefined : (event) => onLeave?.(event, tab.href)}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className={TAB_PANE}>{children}</div>
    </>
  );
}
