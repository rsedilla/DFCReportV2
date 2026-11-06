'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The one-time code an emailed link carries (SKILL.md section 6, decision 0447): activation,
 * password reset and email confirmation.
 *
 * Read once from the address, then taken out of it and out of this page's history entry, so
 * the code is not left in the browser's history for the next person at a shared computer.
 * It is kept in this tab alone (`sessionStorage`, one key per page) so that a reload still
 * works, and forgotten when the link has been used or the tab is closed. Storage that is
 * refused keeps nothing: the page still works until it is reloaded.
 *
 * `ready` is false only while a page opened without a code in its address has not yet
 * looked in the tab, so it does not flash "missing its token" before finding one.
 */
const KEY_PREFIX = 'dfc.link_token:';

// The tab's storage changes only through this page, so nothing needs to be told of it.
const noSubscription = () => () => {};

function keptIn(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null; // Unreadable or refused: nothing kept.
  }
}

export function useLinkToken(): { token: string | null; ready: boolean; forget: () => void } {
  const fromAddress = useSearchParams().get('token');
  const pathname = usePathname();
  const key = KEY_PREFIX + pathname;
  // The code the page opened with, held after the address is cleaned, so a tab that could not
  // store it keeps the one it read.
  const [opened] = useState(fromAddress);
  // `undefined` while rendering on the server, where there is no tab to look in.
  const kept = useSyncExternalStore(noSubscription, () => keptIn(key), () => undefined);

  useEffect(() => {
    if (fromAddress === null) return;
    try {
      window.sessionStorage.setItem(key, fromAddress);
    } catch {
      // Nothing kept: a reload will ask for a new link.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [fromAddress, key]);

  function forget() {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Nothing to forget.
    }
  }

  return { token: fromAddress ?? opened ?? kept ?? null, ready: kept !== undefined, forget };
}
