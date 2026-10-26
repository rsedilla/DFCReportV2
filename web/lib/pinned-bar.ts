'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps the page's bottom scroll padding clear of a pinned Save bar, however tall it grows
 * (2.4.11 Focus Not Obscured).
 *
 * `app/layout.tsx` pads the bottom by a fixed amount sized for the bar as it usually is.
 * A refusal, a reason box or a Reload makes the bar taller, and a control then focused
 * could scroll into view underneath it. While the bar is mounted this measures it and
 * raises the padding to the bar's height plus the distance it sits above the bottom (the
 * tab bar below `lg`), and never lowers it below the fixed amount. Unmounting puts the
 * fixed amount back.
 *
 * Returns a callback ref, because the bar comes and goes as editing starts and stops.
 */
export function usePinnedBarPadding<T extends HTMLElement>(): (bar: T | null) => void {
  const [bar, setBar] = useState<T | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!bar || typeof ResizeObserver === 'undefined') {
      return;
    }

    const update = () => {
      root.style.scrollPaddingBottom = '';
      const fixed = parseFloat(getComputedStyle(root).scrollPaddingBottom) || 0;
      const offset = parseFloat(getComputedStyle(bar).bottom) || 0;
      // A little room above the bar, as the fixed amount leaves.
      const needed = bar.offsetHeight + offset + 16;
      root.style.scrollPaddingBottom = needed > fixed ? `${needed}px` : '';
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    window.addEventListener('resize', update);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      root.style.scrollPaddingBottom = '';
    };
  }, [bar]);

  return setBar;
}
