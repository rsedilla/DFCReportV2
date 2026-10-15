'use client';

import { useState } from 'react';

import { MINIMUM_SEARCH_LENGTH } from '@/lib/people';

/**
 * A list's search box: what is being typed, against what was last asked.
 *
 * What is being typed is not yet what is being asked, so it is held here; it follows
 * `submitted` — the search in the address, which Back and a reload change underneath it —
 * adjusted while rendering rather than in an effect, which would show the old term once
 * first. An emptied box over a search in force offers to clear it (owner, 2026-10-13).
 *
 * Each screen keeps its own form and layout. Until 2026-10-14 this logic was written out on
 * four of them.
 */
export function useSearchTerm(submitted: string): {
  term: string;
  setTerm: (term: string) => void;
  trimmed: string;
  /** A term too short to send, which the Search button refuses. */
  tooShort: boolean;
  /** "Clear search" where the box is emptied over a search in force, else "Search". */
  buttonLabel: string;
} {
  const [term, setTerm] = useState(submitted);
  const [lastSubmitted, setLastSubmitted] = useState(submitted);

  if (lastSubmitted !== submitted) {
    setLastSubmitted(submitted);
    setTerm(submitted);
  }

  const trimmed = term.trim();

  return {
    term,
    setTerm,
    trimmed,
    tooShort: trimmed.length > 0 && trimmed.length < MINIMUM_SEARCH_LENGTH,
    buttonLabel: trimmed === '' && submitted !== '' ? 'Clear search' : 'Search',
  };
}
