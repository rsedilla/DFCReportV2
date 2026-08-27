'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { describeFailure } from '@/lib/messages';
import { MINIMUM_SEARCH_LENGTH, searchPeople, type Person } from '@/lib/people';

/**
 * Choosing the pastoral leader a new Person is placed under (SKILL.md sections 5
 * and 9).
 *
 * **It is required, and it is what the request is authorized against.** Section 9
 * captures the leader at registration, and the capability guard resolves this
 * endpoint's scope against *them* rather than against the person being created —
 * which is what stops a leader placing somebody into a branch they do not
 * oversee. A request without one has no target to authorize.
 *
 * **The search is church-wide, and the refusal comes from the server.** This
 * picker does not filter the list to people the viewer may place under, because
 * that would be the client deciding an authorization question section 7 reserves
 * to the API (section 1, principle 4). Choosing somebody out of scope is answered
 * with `SCOPE_DENIED` on submission, which is the honest place for it.
 *
 * Section 4 assigns Network from sex and section 5 forbids a cross-Network edge,
 * so some choices are refused for that reason too. Again by the server, and again
 * with its own message.
 */
export function LeaderPicker({
  selectedId,
  selectedName,
  onSelect,
}: {
  selectedId: string | null;
  selectedName: string | null;
  onSelect: (person: { id: string; full_name: string } | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');

  const results = useQuery({
    queryKey: ['leader-search', submitted],
    queryFn: ({ signal }) => searchPeople(submitted, null, signal),
    enabled: submitted.trim().length > 0,
  });

  if (selectedId && selectedName) {
    return (
      <div className="border-line rounded-md border p-4">
        <p className="text-sm font-medium">Pastoral leader</p>
        <p className="mt-1 text-sm">{selectedName}</p>
        <Button variant="secondary" className="mt-3" onClick={() => onSelect(null)}>
          Choose someone else
        </Button>
      </div>
    );
  }

  return (
    <div className="border-line rounded-md border p-4">
      <p className="text-sm font-medium">Pastoral leader</p>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        Who will pastor this person? Required, and it decides who can see and edit their
        details.
      </p>

      {/* Stacked on a phone, inline from `sm` up — as on the people search. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label="Search for a leader by name"
          type="search"
          name="leader_q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <Button
          variant="secondary"
          disabled={term.trim().length < MINIMUM_SEARCH_LENGTH}
          onClick={() => setSubmitted(term)}
        >
          Find
        </Button>
      </div>

      {submitted.trim().length === 0 ? null : results.isPending ? (
        <p className="text-muted mt-3 text-sm">Searching…</p>
      ) : results.isError ? (
        <FailureNotice failure={describeFailure(results.error)} />
      ) : results.data.data.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody matches “{submitted}”.</p>
      ) : (
        <ul className="divide-line mt-3 divide-y">
          {results.data.data.map((person: Person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                {person.full_name}{' '}
                <span className="text-muted font-mono">{person.member_id}</span>
              </span>
              <Button
                variant="secondary"
                onClick={() => onSelect({ id: person.id, full_name: person.full_name })}
              >
                Choose
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
