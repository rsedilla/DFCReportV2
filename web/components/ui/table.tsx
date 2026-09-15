import type { ReactNode, ThHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * A data table, with the two properties every one of them needs.
 *
 * **A caption, required.** It names what the rows are for a screen reader, which
 * otherwise meets a grid of cells with nothing saying what it is. It is visually
 * hidden by default because the heading above a table usually says the same thing.
 *
 * **Its own horizontal scroll.** A table is one of the few things allowed to be
 * wider than a 320px phone, and it scrolls inside this frame rather than making
 * the page scroll sideways, which `e2e/accessibility.spec.ts` fails on.
 *
 * Header cells are labels — small, bold, uppercase, tracked and in the accent, like a
 * field label — over a heavier rule, and body rows are divided by the decorative `line`.
 */
export function Table({
  caption,
  className,
  children,
}: {
  caption: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function HeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'border-edge text-accent border-b-2 px-3 py-2 text-xs font-bold tracking-[0.08em] uppercase',
        className,
      )}
      {...props}
    />
  );
}

/** A body row, divided from the next by the decorative rule. */
export const rowClasses = 'border-line border-b last:border-b-0';
