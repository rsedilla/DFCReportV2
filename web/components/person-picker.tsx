'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { describeFailure } from '@/lib/messages';
import { getMe, holdsWholeChurch } from '@/lib/me';
import {
  MINIMUM_CHURCH_WIDE_SEARCH_LENGTH,
  MINIMUM_SEARCH_LENGTH,
  searchPeople,
  type Network,
  type Person,
  type PersonPage,
} from '@/lib/people';

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
 * first caller until a second arrived. What it does is search the people the searcher
 * oversees (decision 0389) and hand back one person; who that person may be is a different
 * question on every screen that uses it — a pastoral leader here, a Cell member
 * there — and each of those is settled by the API on submission rather than by
 * this component.
 *
 * **Two pickers are narrowed to one Network** (decision 0299): adding a Cell member and
 * naming a new pastoral leader, where section 10 and section 5 refuse any other. The
 * caller names the Network of the Cell or person acted on and the API filters by it; the
 * picker says so above the results.
 *
 * **The search is the searcher's own scope, which the API decides** (decision 0389); for a
 * Whole Church reader that is the church. Naming who ran a Cell meeting adds the leaders
 * above the searcher (`upline`). Whom the operation then accepts is still the server's
 * question, answered on submission (section 1, principle 4).
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
  upline = false,
  network = null,
  networkReason = null,
  excludeIds = [],
  describeWhenChosen = false,
}: {
  /**
   * Only this Network's people (decision 0299), where the operation's same-Network rule
   * refuses any other. Keyed on the Cell or person acted on, never on the searcher.
   */
  network?: Network | null;
  /** Why only that Network, said after "because": "this Cell is in the Men's Network". */
  networkReason?: string | null;
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
  /**
   * Also offer the leaders above the searcher (decision 0389), for naming who ran a Cell
   * meeting, where an upline leader who stepped in is outside the searcher's own scope.
   */
  upline?: boolean;
  /**
   * People never offered here, though the search returns them: the searcher, where an
   * operation refuses naming yourself (decision 0369). A convenience only; the server refuses.
   */
  excludeIds?: readonly string[];
  /** Keep the description under the legend once somebody is chosen (owner, 2026-10-25). */
  describeWhenChosen?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  // A Whole Church reader's pickers ask for the directory itself, so decision 0303's page bound
  // and audit entry still apply to them (decision 0389); below that it would be refused.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const churchWide = holdsWholeChurch(me.data, 'people.view_subtree');

  // The rest of a long list is reached with Show more rather than a bigger page.
  const pages = useInfiniteQuery<PersonPage>({
    queryKey: ['leader-search', submitted, upline, network, churchWide],
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? null,
    // **Every picker searches the people the searcher oversees** (SKILL.md section 8,
    // decision 0389), as the People screen does; who ran a Cell meeting adds the leaders above
    // them. A Network narrows the Cell member, pastoral leader and new Cell member pickers
    // (decisions 0299 and 0369), because their operation refuses any other Network anyway.
    queryFn: ({ pageParam, signal }) =>
      searchPeople(submitted, pageParam as string | null, signal, { upline, network, churchWide }),
    enabled: submitted.trim().length > 0,
  });
  const results = {
    isPending: pages.isPending,
    // A failed Show more keeps the people already shown; only a failed first page
    // replaces the list with the notice.
    isError: pages.isError && !pages.isFetchNextPageError,
    data: (pages.data?.pages.flatMap((page) => page.data) ?? []).filter(
      (person) => !excludeIds.includes(person.id),
    ),
  };
  const minimum = churchWide ? MINIMUM_CHURCH_WIDE_SEARCH_LENGTH : MINIMUM_SEARCH_LENGTH;

  // Show more disappears on the last page while it holds focus, so focus moves to the
  // first person it loaded rather than falling to the top of the page (section 23).
  const list = useRef<HTMLUListElement>(null);
  const focusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = focusFrom.current;
    if (from !== null && results.data.length > from) {
      focusFrom.current = null;
      list.current?.querySelectorAll<HTMLButtonElement>('button')[from]?.focus();
    }
  }, [results.data.length]);

  if (selectedId && selectedName) {
    return (
      <div className="border-line rounded-md border p-4">
        <p className="field-label">{legend}</p>
        {describeWhenChosen ? (
          <p className="text-muted mt-1 text-sm leading-relaxed">{description}</p>
        ) : null}
        <p className="mt-1 text-sm">{selectedName}</p>
        <Button variant="secondary" className="mt-3" onClick={() => onSelect(null)}>
          Choose someone else
        </Button>
      </div>
    );
  }

  return (
    <div className="border-line rounded-md border p-4">
      <p className="field-label">{legend}</p>
      <p className="text-muted mt-1 text-sm leading-relaxed">
        {description}
      </p>
      {network !== null && networkReason !== null ? (
        <p className="mt-2 text-sm">
          Showing the {network === 'MENS' ? 'Men’s' : 'Women’s'} Network only, because{' '}
          {networkReason}.
        </p>
      ) : null}

      {/* Stacked on a phone, inline from `sm` up — as on the people search. */}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" data-picker-search>
        <Field
          label={searchLabel}
          type="search"
          name="leader_q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        {/* Named apart from the Cell picker's Search, which can share the page (2.4.6). */}
        <Button
          variant="secondary"
          aria-label="Search people"
          disabled={term.trim().length < minimum}
          onClick={() => setSubmitted(term)}
        >
          Search
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
        <FailureNotice failure={pages.isError ? describeFailure(pages.error) : null} />
      </div>

      {submitted.trim().length === 0 ? null : results.isPending ? (
        <p className="text-muted mt-3 text-sm">Searching…</p>
      ) : results.isError ? null : results.data.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody matches “{submitted}”.</p>
      ) : (
        <>
          <ul ref={list} className="divide-line mt-3 divide-y">
            {results.data.map((person: Person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
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
          {pages.hasNextPage ? (
            <Button
              variant="secondary"
              className="mt-3"
              disabled={pages.isFetchingNextPage}
              onClick={() => {
                focusFrom.current = results.data.length;
                void pages.fetchNextPage();
              }}
            >
              {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
