'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { peopleWithoutACell } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';

/**
 * People in the viewer's scope holding no active Cell membership (SKILL.md sections
 * 10, 15 and 19; decision 0233).
 *
 * **Section 10 fills this list and section 15 requires it.** Closing a Cell must not
 * complete without deciding where its members go, and it may leave them unassigned by
 * explicit choice — so this is where those people stay visible instead of being lost
 * between one Cell and the next.
 *
 * **An attention list on section 15's terms.** Filtered to the viewer's own scope,
 * ordered by name, and carrying no measure of how long anybody has been without a
 * Cell. That ordering would rank the leaders who have not yet placed people rather
 * than the people, which is the leaderboard sections 13 and 17 forbid.
 *
 * **It names no period**, unlike the Cells index it sits beside. Somebody placed last
 * week needs no action today, so the list asks about now.
 *
 * **A person leading an ACTIVE Cell is excluded** (decision 0233), which the server
 * decides. A leader holds no membership row, so the literal reading of section 15
 * would put every Cell Leader in the church on this list.
 */
export default function PeopleWithoutACellPage() {
  return (
    <AppShell>
      <WithoutACell />
    </AppShell>
  );
}

function WithoutACell() {
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const people = useQuery({
    queryKey: ['people-without-a-cell', cursor ?? null],
    queryFn: ({ signal }) => peopleWithoutACell({ cursor }, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href="/dashboard"
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to the dashboard
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">People without a Cell</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        People in your scope who are not in a Cell. Listed by name; nothing here counts or
        ranks how long anybody has been waiting. Somebody who leads a Cell is not listed.
      </p>

      <div className="mt-8">
        <FailureNotice failure={people.isError ? describeFailure(people.error) : null} />
      </div>

      {people.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : people.data ? (
        <>
          {people.data.data.length === 0 ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              Everyone in your scope is in a Cell.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {people.data.data.map((person) => (
                <li key={person.id} className="border-line rounded-lg border p-4">
                  {/*
                    The action that resolves an entry is adding the person to a Cell
                    (section 19), and that is done from the Cell's own roster — which is
                    why the link goes to the person rather than to a form here: the
                    leader choosing a Cell is the one who knows which.
                  */}
                  <h2 className="text-base font-medium">
                    <Link
                      href={`/people/${person.id}`}
                      className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {person.full_name}
                    </Link>
                  </h2>
                  <p className="text-muted mt-1 text-sm">{person.member_id}</p>
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            To place somebody, open the Cell that should have them and add them to its
            members.
          </p>

          {people.data.next_cursor !== null ? (
            <p className="mt-4">
              <button
                type="button"
                onClick={() => setCursor(people.data.next_cursor ?? undefined)}
                className="border-line focus-visible:outline-accent inline-flex min-h-11 items-center rounded-lg border px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Show more
              </button>
            </p>
          ) : null}

          {cursor !== undefined ? (
            <p className="mt-4">
              <button
                type="button"
                onClick={() => setCursor(undefined)}
                className="focus-visible:outline-accent text-muted inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Back to the first page
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
