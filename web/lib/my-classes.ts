import { useQuery } from '@tanstack/react-query';

import { listMyClasses, listMyPeople } from './equipping';
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
 * Whether the reader's People access is over their own branch, a leader's (decision 0504): the
 * one reading the cards of their people in the school are for. A wider reader, the Admin or a
 * Senior Pastor, keeps the screens they have.
 */
export function readsOwnBranch(me: SessionDescription | undefined): boolean {
  return (
    mayHoldAClass(me) &&
    me!.capabilities.some(
      (grant) =>
        grant.capability === 'people.view_subtree' &&
        (grant.scope_type === 'OWN_SUBTREE' || grant.scope_type === 'SUBTREE_EXCL_SELF'),
    )
  );
}

/**
 * **The classes the reader teaches or guides, and their people in the school** (decision 0501,
 * point 21), which decide whether their *Equipping* is drawn: only while there is one of either.
 * Hiding it is the menu alone; the server gives a leader only their own classes and people
 * either way.
 */
export function useMyClasses() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const classes = useQuery({
    queryKey: ['equipping', 'my-classes'],
    queryFn: ({ signal }) => listMyClasses(signal),
    enabled: mayHoldAClass(me.data),
    staleTime: 60_000,
  });
  const ownBranch = readsOwnBranch(me.data);
  const people = useQuery({
    queryKey: ['equipping', 'my-people'],
    queryFn: ({ signal }) => listMyPeople(signal),
    enabled: ownBranch,
    staleTime: 60_000,
  });
  const teaches = (classes.data?.data.length ?? 0) > 0;
  return {
    classes: classes.data?.data ?? [],
    people: people.data?.data ?? [],
    teaches,
    /** Whether *Equipping* is drawn: a class of their own, or one of their people enrolled. */
    shows: teaches || (people.data?.data.length ?? 0) > 0,
    // Not yet answered: a page says nothing rather than "you teach no class" while it loads.
    loading:
      (classes.data === undefined && !classes.isError) ||
      (ownBranch && people.data === undefined && !people.isError),
  };
}
