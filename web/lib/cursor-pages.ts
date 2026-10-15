'use client';

import { useState } from 'react';

/**
 * Which page of a cursor-paged list is showing (SKILL.md section 22): the cursors of the
 * pages already reached, so Previous returns to one without asking the server for a cursor
 * it never gives.
 *
 * **Paging is deliberately not in the address**: a cursor belongs to one set of rows, and an
 * address carrying one would break as soon as the rows behind it changed. So any change to
 * what the list asks for — `resetKey` — starts it again, including one arrived at by pressing
 * Back. Adjusted while rendering rather than in an effect, which is React's own answer for
 * state that follows something from outside: an effect would render the old page once first.
 *
 * It was written out on each list until 2026-10-14, every copy alike.
 */
export function useCursorPages(resetKey: string): {
  /** The cursor of the page showing, null for the first. */
  cursor: string | null;
  /** Zero for the first page. */
  page: number;
  previous: () => void;
  /** Moves to the page `nextCursor` names; nothing where there is none. */
  next: (nextCursor: string | null | undefined) => void;
} {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [lastKey, setLastKey] = useState(resetKey);

  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setCursors([null]);
    setPage(0);
  }

  return {
    cursor: cursors[page] ?? null,
    page,
    previous: () => setPage((current) => Math.max(0, current - 1)),
    next: (nextCursor) => {
      if (!nextCursor) {
        return;
      }
      setCursors((current) => [...current.slice(0, page + 1), nextCursor]);
      setPage((current) => current + 1);
    },
  };
}
