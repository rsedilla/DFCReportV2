'use client';

import { ViewSwitch } from '@/components/ui/view-switch';
import { networkChoices } from '@/lib/own-network';
import type { ReportNetwork } from '@/lib/reports';

type Choice = 'BOTH' | ReportNetwork;

/**
 * The two Senior Pastors' Network switch on *CG Attendance* and *Services*, *Men* · *Women* ·
 * *Both*, the reader's own Network first (decision 0491, which renamed decision 0486's *All*,
 * *Men's* and *Women's* and dropped its *Figures for* label). A Primary opens by their name in
 * the table; while one is open no button is pressed, and choosing one returns to a Network or
 * the whole church. It takes the bar's width on a phone, so its buttons sit side by side.
 */
export function FiguresForSwitch({
  network,
  leaderOpen,
  own,
  onChange,
}: {
  network: ReportNetwork | null;
  leaderOpen: boolean;
  /** The reader's own Network, which comes first (decision 0490). */
  own: ReportNetwork | null;
  onChange: (network: Choice) => void;
}) {
  const value = (leaderOpen ? 'NONE' : (network ?? 'BOTH')) as Choice;

  return (
    <div className="w-full lg:w-auto">
      <ViewSwitch<Choice>
        label="Which Network"
        className="mt-0 w-full lg:w-auto"
        options={networkChoices(own)}
        value={value}
        onChange={(next) => {
          if (next !== value) {
            onChange(next);
          }
        }}
      />
    </div>
  );
}
