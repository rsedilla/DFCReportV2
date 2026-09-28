'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The address last asked for and the one it was asked from, until the page reaches it.
 *
 * A navigation reaches the address only once its server round trip returns, so a second
 * choice made before then would read the old address and drop the first. It builds on
 * this instead while the browser still stands where the first was asked from.
 */
let pending: { from: string; to: string } | null = null;

function currentAddress(): string {
  return window.location.pathname + window.location.search;
}

/**
 * Where a screen is looking, kept in the address rather than in component state.
 *
 * **So that the browser's Back steps back through it**, and so that a reload, a
 * bookmark or a pasted link opens the same figures. The month, the month-or-year
 * switch, the year, the Network or Cell chosen and the row-by-row tab each become a
 * history entry, exactly as opening a leader already did (decision 0254).
 *
 * `push` rather than `replace`: a leader stepping back three months and pressing Back
 * expects the month they came from, which is what a history entry is for.
 *
 * An empty value drops its key, so the plain report has a plain address.
 */
export function useScreenAddress(): (changes: Record<string, string | null>) => void {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // The page has reached the address last asked for, or left for another screen, so the
  // next choice reads the address itself again — including after Back to where the last
  // one was asked from.
  useEffect(() => {
    if (pending === null) return;
    const asked = new URL(pending.to, window.location.origin);
    if (currentAddress() === pending.to || window.location.pathname !== asked.pathname) {
      pending = null;
    }
  }, [pathname, search]);

  return (changes) => {
    // Read at the click rather than from the render, which may be a choice behind.
    const here = currentAddress();
    const base = pending !== null && pending.from === here ? pending.to : here;
    const url = new URL(base, window.location.origin);
    const params = url.searchParams;

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    const to = query === '' ? url.pathname : `${url.pathname}?${query}`;
    pending = { from: here, to };
    // `scroll: false`, because changing a control must not throw the reader back to
    // the top of the page they are already reading.
    router.push(to, { scroll: false });
  };
}
