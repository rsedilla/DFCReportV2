'use client';

import { useQuery } from '@tanstack/react-query';

import { getMe } from '@/lib/me';
import { getChurchCounts, type ReportNetwork } from '@/lib/reports';
import { monthFromQuery } from '@/lib/reporting-month';

/**
 * Which Network is a Senior Pastor's own, for the *Men* · *Women* · *Both* switch that puts it
 * first and opens on it (decisions 0490 and 0491). It is read from which root the reader is: the
 * church's counts name the roots, so the current month's are read once, under the key *Both*
 * itself uses on *People*, so a month change does not unsettle the choice. A reader who is
 * neither root, or a month whose tables cannot be shown (section 20), has none.
 *
 * `settled` is false until that answer is known, so a page waits rather than opening on *Both*
 * and then jumping to the reader's Network.
 */
export function useOwnRootNetwork(enabled: boolean): {
  network: ReportNetwork | null;
  settled: boolean;
} {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const current = monthFromQuery(null);
  const counts = useQuery({
    queryKey: ['church-counts', current, null],
    queryFn: ({ signal }) => getChurchCounts(current, signal),
    enabled,
  });

  return {
    network:
      counts.data?.tables?.find((table) => table.root.id === me.data?.person_id)?.network ?? null,
    settled: !enabled || counts.isFetched,
  };
}

/** The switch's three choices, the reader's own Network first (decision 0490). */
export function networkChoices(own: ReportNetwork | null) {
  return [
    ...((own === 'WOMENS' ? ['WOMENS', 'MENS'] : ['MENS', 'WOMENS']) as ReportNetwork[]).map(
      (key) => ({
        key,
        label: key === 'MENS' ? 'Men' : 'Women',
        name: key === 'MENS' ? 'Men’s Network' : 'Women’s Network',
      }),
    ),
    { key: 'BOTH' as const, label: 'Both', name: 'Both Networks, the whole church' },
  ];
}
