import { useQuery } from '@tanstack/react-query';

import { listMyClasses } from './equipping';
import { getMe, type SessionDescription } from './me';

/**
 * Whether an account may hold a class of its own: `equipping.class` at any scope, which every
 * Leader holds (decision 0503). A Registrar's screens are the school's steps and nothing else.
 */
export function mayHoldAClass(me: SessionDescription | undefined): boolean {
  return (
    me !== undefined &&
    me.screens !== 'EQUIPPING' &&
    me.capabilities.some((grant) => grant.capability === 'equipping.class')
  );
}

/**
 * **The classes the reader teaches or guides** (decision 0501, point 21), which decide whether
 * their *Equipping* is drawn: only while there is one. Hiding it is the menu alone; the server
 * gives a leader only their own classes either way.
 */
export function useMyClasses() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const classes = useQuery({
    queryKey: ['equipping', 'my-classes'],
    queryFn: ({ signal }) => listMyClasses(signal),
    enabled: mayHoldAClass(me.data),
    staleTime: 60_000,
  });
  return {
    classes: classes.data?.data ?? [],
    teaches: (classes.data?.data.length ?? 0) > 0,
    // Not yet answered: a page says nothing rather than "you teach no class" while it loads.
    loading: classes.data === undefined && !classes.isError,
  };
}
