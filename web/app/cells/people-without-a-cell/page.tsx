'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { MoveCellDialog } from '@/components/move-cell-dialog';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { peopleWithoutACell, type PersonWithoutACell } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * People in the viewer's scope holding no active Cell membership (SKILL.md sections
 * 10, 15 and 19; decision 0233).
 *
 * **Section 10 fills this list and section 15 requires it.** Closing a Cell must not
 * complete without deciding where its members go, and it may leave them unassigned by
 * explicit choice — so this is where those people stay visible instead of being lost
 * between one Cell and the next.
 *
 * **Each entry offers the action that resolves it** (section 15): Add to a Cell, the same
 * dialog as on the person's profile, which sends one request and leaves the refusal to
 * the server.
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
  const [placing, setPlacing] = useState<PersonWithoutACell | null>(null);

  const people = useQuery({
    queryKey: ['people-without-a-cell', cursor ?? null],
    queryFn: ({ signal }) => peopleWithoutACell({ cursor }, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="mb-4">
        <Link href="/cells" className={`${LINK} text-accent text-sm font-medium`}>
          Back to Cells
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

      {/*
        One dialog for the page, told which person it is for. A Cell is chosen inside it,
        so the leader choosing is the one who knows which.
      */}
      <MoveCellDialog
        open={placing !== null}
        onClose={() => setPlacing(null)}
        personId={placing?.id ?? ''}
        personName={placing?.full_name ?? ''}
        current={null}
      />

      {people.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : people.data ? (
        <>
          {people.data.data.length === 0 ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              Everyone in your scope is in a Cell.
            </p>
          ) : (
            <>
              <Table caption="People without a Cell" className="mt-6 hidden lg:block">
                <thead>
                  <tr>
                    <HeaderCell>Person</HeaderCell>
                    <HeaderCell>
                      <span className="sr-only">Add to a Cell</span>
                    </HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {people.data.data.map((person) => (
                    <tr key={person.id} className={rowClasses}>
                      <td className="px-3 py-3">
                        <PersonName person={person} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button variant="secondary" onClick={() => setPlacing(person)}>
                          Add to a Cell
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <ul className="mt-6 flex flex-col gap-3 lg:hidden">
                {people.data.data.map((person) => (
                  <li
                    key={person.id}
                    className="border-line flex flex-wrap items-center justify-between gap-3 border p-4"
                  >
                    <div>
                      <PersonName person={person} />
                    </div>
                    <Button variant="secondary" onClick={() => setPlacing(person)}>
                      Add to a Cell
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {people.data.next_cursor !== null ? (
            <p className="mt-4">
              <Button
                variant="secondary"
                onClick={() => setCursor(people.data.next_cursor ?? undefined)}
              >
                Show more
              </Button>
            </p>
          ) : null}

          {cursor !== undefined ? (
            <p className="mt-4">
              <button
                type="button"
                onClick={() => setCursor(undefined)}
                className={`${LINK} text-muted min-h-11 text-sm`}
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

function PersonName({ person }: { person: PersonWithoutACell }) {
  return (
    <>
      <h2 className="text-base font-medium">
        <Link href={`/people/${person.id}`} className={LINK}>
          {person.full_name}
        </Link>
      </h2>
      <p className="text-muted text-xs">{person.member_id}</p>
    </>
  );
}
