'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';

/**
 * People whose own pastoral leader holds no assignment (SKILL.md sections 5, 15, 19
 * and 20; decision 0232).
 *
 * **Section 20 requires this list and calls it required rather than advisable.** The
 * placement graph continues a chain past a leader who has left so that a report still
 * adds up, and that reconstruction is precisely what removes the pressure to fix the
 * gap. This screen is what keeps the repair visible, so a state section 20 calls
 * transient stays transient.
 *
 * **It keys on the condition rather than on the archived flag** (decision 0232). A
 * leader holding no open assignment leaves the same gap however they came to hold
 * none, and section 5 gives three legitimate causes. The one exclusion is section 5's
 * own remedy: a leader holding an `ADMIN` account is outside the pastoral structure
 * deliberately, so their disciples are not waiting for anything.
 *
 * **An attention list on section 15's terms, and the constraint is what makes naming
 * people defensible.** Filtered to the actor's own scope, ordered by name, and
 * carrying no measure of how long a gap has stood — a list ordered by staleness is a
 * ranking of neglect whatever it is called (sections 13 and 17). There is no sort
 * control here for that reason, and no colour grading.
 *
 * **Each entry carries the action that resolves it** (section 19): the link goes to
 * the person's place in the tree, which is the screen that performs a reassignment.
 * Section 5 governs who may actually perform one, and appearing here confers nothing
 * — a viewer without that authority follows the link and is refused there, which is
 * the same answer they would get by any other route to it.
 */
export default function AwaitingReassignmentPage() {
  return (
    <AppShell>
      <AwaitingReassignmentList />
    </AppShell>
  );
}

function AwaitingReassignmentList() {
  // One page at a time, and the cursor is carried rather than accumulated: section 22
  // returns no total, so there is nothing to show a reader but the page they asked for
  // and whether another exists.
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const people = useQuery({
    queryKey: ['awaiting-reassignment', cursor ?? null],
    queryFn: ({ signal }) => awaitingReassignment({ cursor }, signal),
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

      <h1 className="text-2xl font-semibold tracking-tight">A leader to be found</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        People in your scope whose own pastoral leader no longer holds an assignment. Listed
        by name; nothing here counts or ranks how long anybody has been waiting.
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
              Everyone in your scope has a pastoral leader who is still in place.
            </p>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {people.data.data.map((person) => (
                <li key={person.id} className="border-line rounded-lg border p-4">
                  <h2 className="text-base font-medium">
                    <Link
                      href={`/people/${person.id}/network`}
                      className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {person.full_name}
                    </Link>
                  </h2>
                  <p className="text-muted mt-1 text-sm">{person.member_id}</p>
                  <p className="mt-2 text-sm leading-relaxed">
                    Was under {person.former_leader.full_name}
                    <span className="text-muted"> ({person.former_leader.member_id})</span>, who
                    no longer holds an assignment.
                  </p>
                </li>
              ))}
            </ul>
          )}

          {people.data.next_cursor !== null ? (
            <p className="mt-6">
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
