'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { buttonClasses } from '@/components/ui/button';
import { hasNotBegun, monthLabel, shiftMonth } from '@/lib/reporting-month';
import { cn } from '@/lib/utils';

/**
 * Which month a screen is showing, and how to move between them (SKILL.md
 * sections 17, 19 and 20).
 *
 * **The period is on the screen, in words, always.** Section 19 requires every
 * figure to carry what it counts, its scope and its period; a coverage line with
 * no month beside it is a number a reader cannot check. So this is a heading
 * rather than a control that happens to show a value.
 *
 * **Whether the month is open is shown here too**, because section 17 requires it
 * and because it is what makes a mid-month figure readable: an open month's
 * coverage is still changing, and `2 of 4` on the tenth is not the claim `2 of 4`
 * makes on the eighth of the following month.
 *
 * **Forward is stopped at the current month where the caller says so.** Decision
 * 0216 refuses a period that has not begun, so a Cells screen that offered next
 * month would offer a request the API answers with a validation error. The DCC
 * calendar is deliberately different — section 9 runs it thirteen months ahead
 * and a leader may want to see a Sunday that has not happened — so this takes the
 * bound as a prop rather than assuming one.
 *
 * *The clock here is the browser's and the API's is the database's (decision
 * 0160). They can disagree by a day at a month boundary for a phone in another
 * zone, which is why this only ever disables a control: the refusal that matters
 * is the server's, and a client that guessed wrong shows a failure rather than a
 * wrong figure.*
 */
export function MonthPicker({
  month,
  onChange,
  open,
  allowFuture = false,
}: {
  month: string;
  onChange: (month: string) => void;
  /** Whether the month is still open for submission. Omitted while unknown. */
  open?: boolean;
  /** Whether the month after the current one may be selected. */
  allowFuture?: boolean;
}) {
  const next = shiftMonth(month, 1);
  const nextIsRefused = !allowFuture && hasNotBegun(next);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, -1))}
          // A name rather than an icon alone (4.1.2), and the icon is hidden from
          // the accessibility tree so it is not announced twice.
          aria-label={`Show ${monthLabel(shiftMonth(month, -1))}`}
          className={cn(buttonClasses('secondary'), 'px-3')}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onChange(next)}
          disabled={nextIsRefused}
          aria-label={`Show ${monthLabel(next)}`}
          className={cn(buttonClasses('secondary'), 'px-3')}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>

      {/*
        Announced when it changes, because the month is what every figure below is
        read against and moving it changes all of them at once. Polite rather than
        assertive: it is the result of the reader's own action.
      */}
      <p aria-live="polite" className="text-sm">
        <span className="font-medium">{monthLabel(month)}</span>
        {open === undefined ? null : (
          <span className="text-muted">
            {' — '}
            {open ? 'still open for submission' : 'closed for submission'}
          </span>
        )}
      </p>
    </div>
  );
}
