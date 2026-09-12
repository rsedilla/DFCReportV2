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
 * **It is a person picker rather than a leader picker**, and was named for its
 * first caller until a second arrived. What it does is search the church-wide
 * directory and hand back one person; who that person may be is a different
 * question on every screen that uses it — a pastoral leader here, a Cell member
 * there — and each of those is settled by the API on submission rather than by
 * this component.
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
export function PersonPicker({
  legend,
  description,
  searchLabel,
  selectedId,
  selectedName,
  onSelect,
}: {
  /**
   * What this person is being chosen *as*, and why.
   *
   * **Required rather than defaulted**, because the wording is the part that
   * differs between callers and a default is the part nobody changes. This
   * component said "Pastoral leader — who will pastor this person?" on a screen
   * that was adding a Cell member, which is a different question with a
   * different answer, and it read as a bug to anybody using it.
   */
  legend: string;
  description: string;
  searchLabel: string;
  selectedId: string | null;
  selectedName: string | null;
  onSelect: (person: { id: string; full_name: string } | null) => void;
}) {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');

  const results = useQuery({
    queryKey: ['leader-search', submitted],
    // **The pickers keep the church, and the People screen does not** (SKILL.md
    // section 8, decision 0244). Each of the three surfaces using this component —
    // Add a Person, Add a Cell member, and naming a new pastoral leader on a
    // reassignment — names one specific person for one operation rather than
    // offering a place to look around. Section 10 makes Cell membership independent of pastoral assignment,
    // so a Cell legitimately holds members its leader does not pastor: narrowing
    // here would make exactly those people unaddable.
    queryFn: ({ signal }) => searchPeople(submitted, null, signal, { churchWide: true }),
    enabled: submitted.trim().length > 0,
  });

  if (selectedId && selectedName) {
    return (
      <div className="border-line rounded-md border p-4">
        <p className="text-sm font-medium">{legend}</p>
        <p className="mt-1 text-sm">{selectedName}</p>
        <Button variant="secondary" className="mt-3" onClick={() => onSelect(null)}>
          Choose someone else
        </Button>
      </div>
    );
  }

  return (
    <div className="border-line rounded-md border p-4">
      <p className="text-sm font-medium">{legend}</p>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        {description}
      </p>

      {/* Stacked on a phone, inline from `sm` up — as on the people search. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label={searchLabel}
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

      {/*
        Mounted always, contents conditional — which is what `FailureNotice`'s
        own docblock requires and what rendering it inside an `isError` branch
        defeats. A live region inserted at the same moment as its text is
        frequently not announced, so the message becomes invisible to exactly the
        person who most needs it, and neither a screenshot nor axe can see that.
      */}
      <div className="mt-3">
        <FailureNotice failure={results.isError ? describeFailure(results.error) : null} />
      </div>

      {submitted.trim().length === 0 ? null : results.isPending ? (
        <p className="text-muted mt-3 text-sm">Searching…</p>
      ) : results.isError ? null : results.data.data.length === 0 ? (
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
