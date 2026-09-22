'use client';

import { CircleHelp } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

/**
 * How each figure on a report is counted, in words a leader reads once and then trusts
 * (SKILL.md sections 9, 12 and 20; decisions 0170, 0224, 0225 and 0229).
 *
 * **One text per report, because the two domains count differently.** Cell coverage is
 * meetings recorded out of meetings scheduled; DCC coverage is records filed out of records
 * owed. A single explainer shared by both would be wrong for one of them, which is what the
 * design's two-line version was.
 *
 * **Every sentence restates a rule the specification already fixes**, and adds none. The
 * journey is the ladder in sections 9 and 12, evaluated at the end of the month; "all of
 * them" is the highest bucket, whose N is the meetings held and recorded for a Cell and the
 * Sundays that carried a service for DCC; the open month is the submission window, which
 * runs through the 7th.
 *
 * **Text, not a table** (owner's choice): there is nothing to compare across columns, and a
 * second column of sentences is a thin strip on a phone.
 */

type Term = { term: string; definition: string };

const OPEN_MONTH: Term = {
  term: 'An open month',
  definition:
    'Records can be added until the 7th of the next month, so the figures can still change until then.',
};

const TEXT: Record<'cells' | 'dcc', Term[]> = {
  cells: [
    {
      term: 'Recording coverage',
      definition:
        'Meetings with a record, out of the meetings each Cell’s schedule says it was due to hold. A Cell that scheduled nothing this month reads 0 of 0 and is still counted.',
    },
    {
      term: 'People who attended',
      definition: 'Each person once, however many meetings they came to.',
    },
    {
      term: 'Where people are in their journey',
      definition:
        'From every Cell meeting a person has ever attended, as it stood at the end of the month: the 1st makes them a VIP, then 2nd, 3rd and 4th Timer, and Regular from the 5th. A later meeting never changes a past month’s stage.',
    },
    {
      term: 'How often people came',
      definition:
        'Shown for one Cell at a time. “All of them” means every meeting that Cell held and recorded. A meeting that did not happen, or has no record yet, is not counted.',
    },
    OPEN_MONTH,
  ],
  dcc: [
    {
      term: 'Recording coverage',
      definition:
        'Records filed, out of records owed. A leader owes one record for each Sunday they were responsible for somebody. A Sunday that has not happened owes nobody anything.',
    },
    {
      term: 'People who attended',
      definition: 'Each person once, however many Sundays they came to.',
    },
    {
      term: 'Where people are in their journey',
      definition:
        'From every Sunday service a person has ever attended, as it stood at the end of the month: the 1st makes them a VIP, then 2nd, 3rd and 4th Timer, and Regular from the 5th. A later Sunday never changes a past month’s stage.',
    },
    {
      term: 'How often people came',
      definition:
        '“All of them” means every Sunday this month that had a service. A Sunday with no service is not counted.',
    },
    {
      term: 'A Network',
      definition:
        'Counts the people who belong to it, so the people who attended in the two Networks normally add up to the whole church. Recording coverage does not split that way, because it counts records owed, not people.',
    },
    OPEN_MONTH,
  ],
};

export function HowTheseAreCounted({ report }: { report: 'cells' | 'dcc' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* A button, because it opens a dialog rather than going anywhere. */}
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CircleHelp aria-hidden="true" strokeWidth={1.75} className="size-4" />
        How these are counted
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="How these are counted">
        <dl className="flex flex-col gap-3">
          {TEXT[report].map(({ term, definition }) => (
            <div key={term}>
              <dt className="field-label">{term}</dt>
              <dd className="mt-1 text-sm leading-relaxed">{definition}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-col gap-3 lg:flex-row">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>
    </>
  );
}
