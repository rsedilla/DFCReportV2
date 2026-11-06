import type { QueryKey } from '@tanstack/react-query';

/**
 * Keeps a list's previous page on screen while the next page of the same list loads.
 *
 * Only a page turn: the previous answer is kept when its query key differs from this one at
 * the cursor alone. A new search, view or month is a different list, and showing the old one
 * under it, even for a moment, would say something false; that still shows Loading. A report's
 * period is the one exception, `keepPreviousPeriod` below.
 * The screen fades the kept rows while `isPlaceholderData` is true, so they are not read as
 * the new page.
 */
export function keepPreviousPage(key: QueryKey, cursorIndex: number) {
  return keepWhileOnlyChanging(key, [cursorIndex]);
}

/**
 * Keeps a report's figures on screen while another period of the same report loads (owner,
 * 2026-11-06), so stepping a month does not blank the page. It reverses the choice of 22 Oct to
 * leave report months out, and what made that choice is kept instead: the old figures are
 * faded under a line naming the period loading (`components/kept-figures.tsx`), and only a
 * change of period keeps them. Another leader, scope or figure is a different report and still
 * shows Loading, so nobody's figures sit under somebody else's name. A refusal ends the
 * placeholder, so a period that fails shows its failure and not the old figures.
 */
export function keepPreviousPeriod(key: QueryKey, periodIndexes: number[]) {
  return keepWhileOnlyChanging(key, periodIndexes);
}

function keepWhileOnlyChanging(key: QueryKey, changing: number[]) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: QueryKey }): T | undefined => {
    if (previous === undefined || previousQuery === undefined) {
      return undefined;
    }

    const before = previousQuery.queryKey;
    const sameList =
      before.length === key.length &&
      key.every(
        (part, index) =>
          changing.includes(index) || JSON.stringify(part) === JSON.stringify(before[index]),
      );

    return sameList ? previous : undefined;
  };
}

/** The fade on a kept page, and the busy state a screen reader announces. */
export function pageTurnProps(turning: boolean): { className?: string; 'aria-busy'?: true } {
  return turning ? { className: 'opacity-60 transition-opacity', 'aria-busy': true } : {};
}
