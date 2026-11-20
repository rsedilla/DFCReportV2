'use client';

import { type ReactNode } from 'react';

import { PAGE_WIDTH } from '@/components/app-shell';
import { GrowthEquippingTabs, useGrowthCarriesEquipping } from '@/components/growth-controls';
import { TAB_PANE } from '@/components/ui/frame';

/**
 * **A Teacher's or Guide's *Equipping*** (decision 0501, point 21): its own item on the recording
 * screens, and for a Full view leader a tab of their *Growth* beside *SUYNL*.
 */
export function TeachFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  const tabbed = useGrowthCarriesEquipping();
  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted text-sm">{lead}</p>
      </div>
      {tabbed ? <GrowthEquippingTabs current="/equipping/teach" /> : null}
      <div className={tabbed ? TAB_PANE : 'mt-6'}>{children}</div>
    </main>
  );
}
