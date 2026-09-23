'use client';

import { useSyncExternalStore } from 'react';

/**
 * How many rows a list shows at a time, by the width of the screen (owner's choice,
 * 2026-09-24): 15 on a laptop, 12 on a tablet, 10 on a phone, so a page ends before a
 * long scroll does. The breakpoints are the application's own `sm` and `lg`.
 */
const LAPTOP = '(min-width: 1024px)';
const TABLET = '(min-width: 640px)';

function current(): number {
  if (window.matchMedia(LAPTOP).matches) {
    return 15;
  }
  return window.matchMedia(TABLET).matches ? 12 : 10;
}

function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(LAPTOP), window.matchMedia(TABLET)];
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

export function usePageSize(): number {
  // A phone's size before the screen is known, so a first render never asks for more.
  return useSyncExternalStore(subscribe, current, () => 10);
}
