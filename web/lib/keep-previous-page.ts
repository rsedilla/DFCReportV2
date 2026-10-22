import type { QueryKey } from '@tanstack/react-query';

/**
 * Keeps a list's previous page on screen while the next page of the same list loads.
 *
 * Only a page turn: the previous answer is kept when its query key differs from this one at
 * the cursor alone. A new search, view or month is a different list, and showing the old one
 * under it, even for a moment, would say something false; that still shows Loading.
 * The screen fades the kept rows while `isPlaceholderData` is true, so they are not read as
 * the new page.
 */
export function keepPreviousPage(key: QueryKey, cursorIndex: number) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: QueryKey }): T | undefined => {
    if (previous === undefined || previousQuery === undefined) {
      return undefined;
    }

    const before = previousQuery.queryKey;
    const sameList =
      before.length === key.length &&
      key.every(
        (part, index) =>
          index === cursorIndex || JSON.stringify(part) === JSON.stringify(before[index]),
      );

    return sameList ? previous : undefined;
  };
}

/** The fade on a kept page, and the busy state a screen reader announces. */
export function pageTurnProps(turning: boolean): { className?: string; 'aria-busy'?: true } {
  return turning ? { className: 'opacity-60 transition-opacity', 'aria-busy': true } : {};
}
