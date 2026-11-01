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
 * Bold (decision 0416): header cells are labels, small, bold, uppercase and tracked, in
 * white on a solid accent row, and every other body row is the pale accent tint. Body rows
 * are divided by the decorative `line`.
 *
 * **From `lg` the header row stays pinned to the top of the window while the rows scroll**
 * (owner's choice of 2026-09-15). Two things make that work, and removing either silently
 * stops it. The frame stops being a scroll container at `lg`, because a sticky element
 * sticks to its nearest scrolling ancestor, and a frame that scrolls sideways is one; the
 * accessibility suite's no-sideways-scroll check at 1024 and 1440 is what now catches a
 * table too wide for its column. And the rule under the header is an inset shadow at `lg`
 * rather than a border, because a collapsed table border stays behind when its cell sticks.
 * Below `lg` these tables are cards, and a table shown there keeps its sideways scroll.
 */
export function Table({
  caption,
  className,
  tableClassName,
  children,
}: {
  caption: string;
  className?: string;
  /** On the `<table>` itself, such as `table-fixed` where the columns are given shares. */
  tableClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('overflow-x-auto lg:overflow-visible', className)}>
      <table className={cn('w-full border-collapse text-left text-sm', tableClassName)}>
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
        'border-edge text-surface bg-accent border-b-2 px-3 py-2 text-xs font-bold tracking-[0.08em] uppercase',
        'lg:sticky lg:top-0 lg:z-10 lg:border-b-0 lg:shadow-[inset_0_-2px_0_var(--color-edge)]',
        className,
      )}
      {...props}
    />
  );
}

/** A body row, divided from the next by the decorative rule, every other one tinted. */
export const rowClasses = 'border-line even:bg-accent-tint border-b last:border-b-0';
