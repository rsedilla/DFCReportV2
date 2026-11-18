'use client';

import { useEffect } from 'react';

/**
 * Keeps the offline page on the device (SKILL.md section 23, decision 0497), by registering
 * `public/sw.js` once the page has loaded. It draws nothing.
 *
 * **Not in `next dev`**, where a kept helper would outlive the server it was served from and
 * answer for whatever runs on that port next. A browser without the feature, or one that
 * refuses the registration, is left as it was: the application works the same without it.
 */
export function OfflineHelper() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
