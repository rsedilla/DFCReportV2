'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { getPerson } from './people';

/**
 * A report opened for a leader whose record was merged away shows the record kept's report
 * (SKILL.md section 3, decision 0408, point 22). The API answers the report for the record kept
 * already; this moves the address to it too, so the page names the record kept and reads its
 * branch, and keeps the retired record's id in `merged_from` for the line saying what happened.
 *
 * **The line is the server's, not the address's**: the retired record is read back, and the
 * line shown only where the server says it was merged into the leader now in the address, so a
 * crafted link cannot make a report claim a merge that never happened. A reader the person read
 * refuses simply sees no line; the report itself is still the API's to admit or refuse.
 *
 * Returns the retired Member ID to name in that line, or null.
 */
export function useKeptLeader(leader: string | null): string | null {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mergedFrom = search.get('merged_from');

  // The leader in the address, while it may still be a record merged away.
  const named = useQuery({
    queryKey: ['person', leader],
    queryFn: ({ signal }) => getPerson(leader!, signal),
    enabled: leader !== null,
    retry: false,
  });
  // The retired record, once the address has moved to the record kept.
  const retired = useQuery({
    queryKey: ['person', mergedFrom],
    queryFn: ({ signal }) => getPerson(mergedFrom!, signal),
    enabled: mergedFrom !== null,
    retry: false,
  });

  const into = named.data?.merged?.into ?? null;

  useEffect(() => {
    if (into === null || leader === null) {
      return;
    }
    const params = new URLSearchParams(search.toString());
    params.set('leader', into.id);
    params.set('merged_from', leader);
    router.replace(`${pathname}?${params.toString()}`);
  }, [into, leader, pathname, router, search]);

  const confirmed = retired.data?.merged?.into.id;
  return confirmed !== undefined && leader !== null && confirmed.toLowerCase() === leader.toLowerCase()
    ? (retired.data?.member_id ?? null)
    : null;
}
