'use client';

import { useSyncExternalStore } from 'react';

/**
 * Below `lg`, where a report's tables take their phone form (decision 0451): short column
 * headings, short names where a table has several figures, and a one-line period bar. The same
 * width `lg:` styles switch at, so the two never disagree about which form is showing.
 */
const PHONE = '(max-width: 1023.98px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches;
}

/**
 * Whether the screen is phone-width. False while the page is prerendered, so the server's
 * markup is the wide form; every report reads its figures after mounting, by which time this
 * has its real answer, so no table is drawn twice.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}
