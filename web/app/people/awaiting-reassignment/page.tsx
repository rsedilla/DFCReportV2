'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
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
 * **The empty state says what the query established and not more.** It used to say that
 * everyone in the reader's scope had a leader still in place, which is false in exactly
 * the case this screen exists for: the broken edge that puts somebody here also drops
 * them out of their upline's subtree walk, so an ordinary leader is answered empty while
 * people beneath them wait. That is an open Stop Condition rather than a defect of this
 * screen, and it is open in both directions: decision 0214 refuses to let section 20's
 * placement graph authorize an aggregate report, and section 7 says in terms that a
 * per-person view — which this list is — "is a different question and is not settled by
 * this". So the sentence names the limit instead of asserting past it.
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
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);

  const people = useQuery({
    queryKey: ['awaiting-reassignment', cursors[page]],
    queryFn: ({ signal }) =>
      awaitingReassignment({ cursor: cursors[page] ?? undefined }, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href="/dashboard"
          className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to the dashboard
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">People needing a leader</h1>
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
              Nobody in your scope is waiting for a leader. Somebody whose own leader
              holds no assignment can fall outside your branch as they go, so a reader with
              a wider scope may see them.
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

          {/* Previous and Next rather than "show more": a cursor names one page, and
              section 22 returns no total to count pages against. */}
          <nav aria-label="People awaiting reassignment" className="mt-6 flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={!people.data.next_cursor}
              onClick={() => {
                const next = people.data.next_cursor;
                if (!next) {
                  return;
                }
                setCursors((current) => [...current.slice(0, page + 1), next]);
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </nav>
        </>
      ) : null}
    </main>
  );
}
