'use client';

import { ViewSwitch } from '@/components/ui/view-switch';
import type { ReportNetwork } from '@/lib/reports';

type Choice = 'ALL' | ReportNetwork;

/**
 * The two Senior Pastors' *Figures for*, three buttons, *All*, *Men's* and *Women's* (decision
 * 0486), in place of a list that also named every Primary: a Primary opens by their name in the
 * table, which leads to the same figures, and *Back to your report* returns. While a Primary is
 * open no button is pressed, and choosing one returns to the church or a Network.
 */
export function FiguresForSwitch({
  network,
  leaderOpen,
  onChange,
}: {
  network: ReportNetwork | null;
  leaderOpen: boolean;
  onChange: (network: ReportNetwork | null) => void;
}) {
  const value = (leaderOpen ? 'NONE' : (network ?? 'ALL')) as Choice;

  return (
    <div>
      <p className="field-label" aria-hidden="true">
        Figures for
      </p>
      <ViewSwitch<Choice>
        label="Figures for"
        className="mt-2"
        options={[
          { key: 'ALL', label: 'All', name: 'All, the whole church' },
          { key: 'MENS', label: 'Men’s', name: 'Men’s Network' },
          { key: 'WOMENS', label: 'Women’s', name: 'Women’s Network' },
        ]}
        value={value}
        onChange={(next) => {
          if (next !== value) {
            onChange(next === 'ALL' ? null : next);
          }
        }}
      />
    </div>
  );
}
