'use client';

import { useEffect, useState } from 'react';

import { asOfTodayLabel } from './reporting-month';

/**
 * "As of today, 12 Nov" (decision 0478), read again whenever the app comes back to the front,
 * so an installed app left open overnight does not go on saying yesterday's date. The figures
 * are fetched again at the same moment (TanStack Query refetches on focus).
 */
export function useAsOfToday(): string {
  const [label, setLabel] = useState(() => asOfTodayLabel());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        setLabel(asOfTodayLabel());
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return label;
}
