'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { getPerson } from './people';

/**
 * A report opened for a leader whose record was merged away shows the record kept's report
 * (SKILL.md section 3, decision 0408, point 22). The leader in the address is read as a person:
 * where it was merged, the address is replaced with the record kept, and the retired Member ID
 * travels in `merged` (with `merged_into` naming the leader it belongs to) so the page can say
 * what happened. The API decides who may read either;
 * a leader the reader may not open is left to the report's own refusal.
 *
 * Returns the retired Member ID once the address names the record kept, or null.
 */
export function useKeptLeader(leader: string | null): string | null {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const person = useQuery({
    queryKey: ['person', leader],
    queryFn: ({ signal }) => getPerson(leader!, signal),
    enabled: leader !== null,
    retry: false,
  });

  const into = person.data?.merged?.into ?? null;
  const memberId = person.data?.member_id ?? null;

  useEffect(() => {
    if (into === null || memberId === null) {
      return;
    }
    const params = new URLSearchParams(search.toString());
    params.set('leader', into.id);
    params.set('merged', memberId);
    params.set('merged_into', into.id);
    router.replace(`${pathname}?${params.toString()}`);
  }, [into, memberId, pathname, router, search]);

  // Only for the leader it was replaced with: choosing another leader keeps nothing of it.
  return leader !== null && search.get('merged_into') === leader ? search.get('merged') : null;
}
