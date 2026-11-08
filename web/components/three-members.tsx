'use client';

import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { PersonPicker } from '@/components/person-picker';
import { InfoToggle } from '@/components/ui/info-toggle';
import { getMe } from '@/lib/me';
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
 * picker searches the searcher's own scope and not the church (decision 0369), narrowed to
 * the leader's Network, and leaves the searcher out; the server decides who qualifies.
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
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const searcher = me.data?.person_id ?? null;
  const chosen = members.flatMap((member) => (member === null ? [] : [member.id]));
  const titleId = useId();

  // Short words, and what happens to somebody already in a Cell behind an ⓘ (decision 0457).
  // The group is named by its title rather than a `legend`, so the ⓘ beside it is not read as
  // part of the group's name. The ⓘ shows on a phone too: without it a leader cannot tell why
  // somebody new is not found.
  return (
    <fieldset aria-labelledby={titleId} className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={titleId} className="field-label">
            Members
          </span>
          <InfoToggle label="About the members" small inline>
            Someone already in a Cell moves to the new one once it is approved. Someone new is
            added first, under Add People.
          </InfoToggle>
        </div>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          3 people from the leader&rsquo;s Network.
        </p>
      </div>
      {[0, 1, 2].map((slot) => (
        <PersonPicker
          key={slot}
          legend={`Member ${slot + 1}`}
          searchLabel={
            <>
              Search by name<span className="sr-only"> for member {slot + 1}</span>
            </>
          }
          selectedId={members[slot]?.id ?? null}
          selectedName={members[slot]?.full_name ?? null}
          excludeIds={searcher === null ? [] : [searcher]}
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
