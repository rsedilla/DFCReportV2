'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Where a report is looking, kept in the address rather than in component state.
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
export function useReportAddress(): (changes: Record<string, string | null>) => void {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return (changes) => {
    const params = new URLSearchParams(search.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    // `scroll: false`, because changing a control must not throw the reader back to
    // the top of the page they are already reading.
    router.push(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
  };
}
