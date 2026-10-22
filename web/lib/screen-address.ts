'use client';

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
 * **The browser's own history, not the router.** Every screen is drawn in the browser
 * from the address and the API, so the server has nothing to add when a control changes.
 * A router navigation asked it anyway: the control did not move until it answered, and
 * when that request failed, under load or after a deploy, the framework loaded the whole
 * page again and the click was lost (`e2e/screen-address.spec.ts`). Next keeps
 * `useSearchParams` in step with `history.pushState`, and the address changes at once, so
 * a second choice made straight after the first reads the first.
 *
 * An empty value drops its key, so the plain report has a plain address.
 */
export function useScreenAddress(): (changes: Record<string, string | null>) => void {
  return (changes) => {
    // Read at the click rather than from the render, which may be a choice behind.
    const url = new URL(currentAddress(), window.location.origin);
    const params = url.searchParams;

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    // The scroll position is left where it is: changing a control must not throw the
    // reader back to the top of the page they are already reading.
    window.history.pushState(null, '', query === '' ? url.pathname : `${url.pathname}?${query}`);
  };
}
