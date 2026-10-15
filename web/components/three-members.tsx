'use client';

import { useQuery } from '@tanstack/react-query';

import { PersonPicker } from '@/components/person-picker';
import { getPerson, networkLabel, networkOfPerson } from '@/lib/people';

export type ChosenMember = { id: string; full_name: string } | null;

/** Three empty choices, the start of every new-Cell request. */
export const NO_MEMBERS: readonly ChosenMember[] = [null, null, null];

/**
 * Whether three members are chosen as a new-Cell request needs them (decision 0353): three
 * different people, none of them the leader. The server checks the rest.
 */
export function membersReady(members: readonly ChosenMember[], leaderId: string | null): boolean {
  const chosen = members.flatMap((member) => (member === null ? [] : [member.id]));
  return chosen.length === 3 && new Set(chosen).size === 3 && !chosen.includes(leaderId ?? '');
}

/**
 * The three members a new-Cell request names, besides its leader (decision 0353). Each
 * picker searches the leader's Network, because section 10 refuses a member of the other
 * one; the server decides who qualifies.
 */
export function ThreeMembers({
  leaderId,
  members,
  onChange,
}: {
  leaderId: string | null;
  members: readonly ChosenMember[];
  onChange: (members: ChosenMember[]) => void;
}) {
  const leader = useQuery({
    queryKey: ['person', leaderId],
    queryFn: ({ signal }) => getPerson(leaderId as string, signal),
    enabled: leaderId !== null,
  });
  const network = leader.data ? networkOfPerson(leader.data) : null;
  const chosen = members.flatMap((member) => (member === null ? [] : [member.id]));

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="field-label">Three members</legend>
      <p className="text-muted text-sm leading-relaxed">
        Three people who will be in the Cell, besides its leader. Each must be in the
        leader&rsquo;s Network and not already in a Cell.
      </p>
      {[0, 1, 2].map((slot) => (
        <PersonPicker
          key={slot}
          legend={`Member ${slot + 1}`}
          description="In the leader’s Network, and in no Cell."
          searchLabel={`Search for member ${slot + 1} by name`}
          selectedId={members[slot]?.id ?? null}
          selectedName={members[slot]?.full_name ?? null}
          churchWide
          network={network}
          networkReason={network === null ? null : `the leader is in the ${networkLabel(network)}`}
          onSelect={(person) =>
            onChange(members.map((member, at) => (at === slot ? person : member)))
          }
        />
      ))}
      {chosen.length === 3 && !membersReady(members, leaderId) ? (
        <p className="text-sm">Choose three different people, none of them the leader.</p>
      ) : null}
    </fieldset>
  );
}
