'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AddMemberDialog } from '@/components/add-member-dialog';
import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  cellName,
  cellSubtitle,
  listCellMeetings,
  listCellMembers,
  removeCellMember,
  type CellMember,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { dayLabel, reportingMonthOf } from '@/lib/reporting-month';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * A Cell's members, and adding or removing one (SKILL.md sections 5, 10 and 12).
 *
 * **Removing somebody ends their membership rather than deleting it.** Section 5
 * forbids removing a row of an effective-dated table and section 12 reads a month's
 * figures against the membership window, so somebody removed today still counts in
 * the months they were a member for. The screen says it in words rather than leaving a
 * leader to fear they have erased history.
 *
 * **Adding is a dialog, and who may be added is the server's question.** Section 10
 * requires a member and the Cell's leader to share a Network, refuses somebody archived
 * or merged, and refuses somebody already in the Cell; section 7 decides whether this
 * actor may act on this Cell at all.
 *
 * **A name opens the person's profile**, where Move to another Cell already lives, so
 * this page carries no move of its own.
 *
 * **The Cell is named the way every other Cells screen names it**, from this month's
 * meetings, which the Cell's own page asks for with the same key: the members route returns
 * people, not the Cell.
 *
 * **The leader is named on that line, and nothing puts them in the list below it.** The only
 * two inserters of `cell_memberships` are adding a member and a closure's dispersal, and
 * neither runs when a Cell is created or handed over, so a leader opening this screen would
 * otherwise look for themselves and find nothing. Adding a member does not refuse the
 * leader, so this is how the rows arise rather than a rule: whether a Cell's leader is a
 * member of their own Cell is undecided (`CLAUDE.md`, Open — awaiting a ruling), and the
 * line says who leads the Cell and claims nothing further.
 *
 * **The list is ordered by name and nothing here ranks anybody** (sections 13
 * and 15). It pages by cursor, because section 22 returns no total for a collection and a
 * page number would be invented. The count on the line above the list is the Cell's own
 * figure from the meetings read, which is a field of the Cell rather than a total of this
 * page.
 */
export default function CellMembersPage() {
  return (
    <AppShell>
      <CellMembers />
    </AppShell>
  );
}

function CellMembers() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const month = reportingMonthOf();
  const cell = useQuery({
    queryKey: ['cell-meetings', params.id, month],
    queryFn: ({ signal }) => listCellMeetings(params.id, month, signal),
  });

  const members = useQuery({
    queryKey: ['cell-members', params.id, cursors[page]],
    queryFn: ({ signal }) => listCellMembers(params.id, cursors[page], signal),
  });

  const remove = useMutation({
    mutationFn: (personId: string) =>
      removeCellMember(params.id, personId, idempotencyKeyFor('remove', params.id, personId)),
    onSuccess: async () => {
      setRemoving(null);
      // Both, because the line above the list carries the Cell's member count and this
      // screen is what changes it: the count comes from the meetings read, not from the
      // collection.
      await queryClient.invalidateQueries({ queryKey: ['cell-members', params.id] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', params.id] });
    },
  });

  const failure = members.isError
    ? describeFailure(members.error)
    : remove.isError
      ? describeFailure(remove.error)
      : null;

  const handle = cell.data?.cell_id ?? null;
  // Three states rather than two: a Cell whose read has not landed is not an open one,
  // and the button and the sentences below turn on knowing which.
  const closedOn = cell.data === undefined ? undefined : cell.data.cell_closed_on;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="mb-4">
        <Link href={`/cells/${params.id}/meetings`} className={`${LINK} text-accent text-sm font-medium`}>
          Back to this Cell&rsquo;s meetings
        </Link>
      </p>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {cell.data ? cellName(cell.data) : 'Members'}
          </h1>
          {cell.data ? (
            <p className="text-muted mt-1 text-sm">{cellSubtitle(cell.data)}</p>
          ) : null}
          {closedOn === undefined ? null : closedOn === null ? (
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              Who is in this Cell now. Removing somebody ends their membership from today; it
              does not erase the months they were part of, and past figures keep counting them.
            </p>
          ) : (
            <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
              This Cell is closed. Closing it ended every membership in it, and the months it
              was open keep counting the people who were in it.
            </p>
          )}
        </div>
        {/*
          A closed Cell is offered nothing to add: section 10 ends every membership at
          closure and the route refuses an addition, so the button would always fail.
        */}
        {closedOn === null ? (
          <Button
            onClick={() => {
              setAdded(null);
              setAdding(true);
            }}
          >
            Add a member
          </Button>
        ) : null}
      </div>

      <AddMemberDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={setAdded}
        cellId={params.id}
        cellHandle={handle}
      />

      {added ? (
        <p aria-live="polite" className="mt-6 text-sm font-medium">
          Added {added}.
        </p>
      ) : null}

      <div className="mt-8">
        <FailureNotice failure={failure} />
      </div>

      {members.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : members.data && members.data.data.length === 0 ? (
        <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
          {closedOn === undefined
            ? 'Nobody is in this Cell.'
            : closedOn !== null
              ? 'Closing this Cell ended every membership in it. The months it was open keep counting the people who were in it.'
              : 'This Cell has no members yet. A meeting can still be recorded as met with nobody to mark, which counts towards its coverage.'}
        </p>
      ) : members.data ? (
        <>
          <Table caption="Current members" className="mt-4 hidden lg:block">
            <thead>
              <tr>
                <HeaderCell>Member</HeaderCell>
                <HeaderCell>Member since</HeaderCell>
                <HeaderCell>
                  <span className="sr-only">Remove</span>
                </HeaderCell>
              </tr>
            </thead>
            <tbody>
              {members.data.data.map((member) => (
                <tr key={member.person_id} className={rowClasses}>
                  <td className="px-3 py-3 align-top">
                    <MemberName member={member} />
                  </td>
                  <td className="text-muted px-3 py-3 align-top">
                    {dayLabel(member.started_at.slice(0, 10))}
                  </td>
                  <td className="px-3 py-3 text-right align-top">
                    <RemoveControl
                      confirming={removing === member.person_id}
                      pending={remove.isPending && removing === member.person_id}
                      onAskRemove={() => setRemoving(member.person_id)}
                      onCancel={() => setRemoving(null)}
                      onConfirm={() => remove.mutate(member.person_id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <ul className="mt-4 flex flex-col gap-3 lg:hidden">
            {members.data.data.map((member) => (
              <li key={member.person_id} className="border-line border p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div>
                    <MemberName member={member} />
                    <p className="text-muted mt-1 text-sm">
                      A member since {dayLabel(member.started_at.slice(0, 10))}
                    </p>
                  </div>
                  <RemoveControl
                    confirming={removing === member.person_id}
                    pending={remove.isPending && removing === member.person_id}
                    onAskRemove={() => setRemoving(member.person_id)}
                    onCancel={() => setRemoving(null)}
                    onConfirm={() => remove.mutate(member.person_id)}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/*
            Cursor paging, with no page numbers and no total: section 22 returns
            neither, so both would be invented.
          */}
          <div className="mt-6 flex gap-3">
            {page > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
            ) : null}
            {members.data.next_cursor !== null ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCursors((current) => [...current.slice(0, page + 1), members.data.next_cursor]);
                  setPage((p) => p + 1);
                }}
              >
                Next
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

/**
 * A heading rather than a paragraph: each member is a section of the list with its own
 * controls, so a screen reader can move between them by heading.
 */
function MemberName({ member }: { member: CellMember }) {
  return (
    <>
      <h2 className="text-base font-medium">
        <Link href={`/people/${member.person_id}`} className={LINK}>
          {member.full_name}
        </Link>
      </h2>
      <p className="text-muted text-xs">{member.member_id}</p>
    </>
  );
}

/**
 * Removal behind a confirmation. A removal ends a membership from today, which changes
 * who a meeting's roster asks about from now on; it is reversible by adding the person
 * back, and the wording says what it does rather than warning.
 */
function RemoveControl({
  confirming,
  pending,
  onAskRemove,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  pending: boolean;
  onAskRemove: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={onAskRemove}>
        Remove
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" onClick={onConfirm} disabled={pending}>
          {pending ? 'Removing…' : 'Yes, remove'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Keep
        </Button>
      </div>
      <p className="text-muted max-w-xs text-right text-sm leading-relaxed">
        Their membership ends today. Past months keep counting them, and you can add them
        back at any time.
      </p>
    </div>
  );
}
