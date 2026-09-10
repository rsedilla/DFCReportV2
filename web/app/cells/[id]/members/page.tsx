'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { addCellMember, listCellMembers, removeCellMember, type CellMember } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { dayLabel } from '@/lib/reporting-month';

/**
 * A Cell's members, and adding or removing one (SKILL.md sections 5, 10 and 12).
 *
 * **Removing somebody ends their membership rather than deleting it.** Section 5
 * forbids removing a row of an effective-dated table and section 12 reads a month's
 * figures against the membership window, so somebody removed today still counts in
 * the months they were a member for. That is what makes a closed month
 * reproducible, and the screen says it in words rather than leaving a leader to
 * fear they have erased history.
 *
 * **Who may be added is the server's question.** Section 10 requires a member and
 * the Cell's leader to share a Network, refuses somebody archived or merged, and
 * refuses somebody already in the Cell; section 7 decides whether this actor may
 * act on this Cell at all. So the picker searches the church-wide directory and the
 * refusal arrives from the API with its own message — a client that pre-filtered
 * the list to "eligible" people would be answering an authorization question
 * section 7 reserves to the server (principle 4).
 *
 * **Each write carries an idempotency key derived from what it is doing**, so a
 * leader on a slow connection who presses Add twice adds one person, and a retry
 * after a dropped response replays rather than writing again (decision 0127).
 *
 * **The list is ordered by name and nothing here ranks anybody** (sections 13
 * and 15). It pages by cursor, because section 22 returns no total and a page
 * number would be invented.
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
  const [chosen, setChosen] = useState<{ id: string; full_name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['cell-members', params.id, cursors[page]],
    queryFn: ({ signal }) => listCellMembers(params.id, cursors[page], signal),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['cell-members', params.id] });

  const add = useMutation({
    mutationFn: () => {
      if (chosen === null) {
        throw new Error('Nobody chosen.');
      }
      return addCellMember(params.id, chosen.id, idempotencyKeyFor('add', params.id, chosen.id));
    },
    onSuccess: async () => {
      setChosen(null);
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (personId: string) =>
      removeCellMember(params.id, personId, idempotencyKeyFor('remove', params.id, personId)),
    onSuccess: async () => {
      setRemoving(null);
      await invalidate();
    },
  });

  const failure = members.isError
    ? describeFailure(members.error)
    : add.isError
      ? describeFailure(add.error)
      : remove.isError
        ? describeFailure(remove.error)
        : null;

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/cells/${params.id}/meetings`}
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this Cell&rsquo;s meetings
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Who is in this Cell now. Removing somebody ends their membership from today; it does
        not erase the months they were part of, and past figures keep counting them.
      </p>

      <div className="mt-8">
        <FailureNotice failure={failure} />
      </div>

      <section className="mt-8" aria-labelledby="add-heading">
        <h2 id="add-heading" className="text-lg font-medium">
          Add somebody
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Search everyone in the church. A person must be in the same Network as this
          Cell&rsquo;s leader, and the server says so if they are not.
        </p>

        <div className="mt-4">          <PersonPicker
            legend="Who to add"
            description="Search everyone in the church by name. They must be in the same Network as this Cell's leader."
            searchLabel="Search for a person by name"
            selectedId={chosen?.id ?? null}
            selectedName={chosen?.full_name ?? null}
            onSelect={setChosen}
          />
        </div>

        {chosen ? (
          <Button
            type="button"
            className="mt-4"
            onClick={() => add.mutate()}
            disabled={add.isPending}
          >
            {add.isPending ? 'Adding…' : `Add ${chosen.full_name}`}
          </Button>
        ) : null}

        {add.isSuccess ? (
          <p aria-live="polite" className="mt-4 text-sm font-medium">
            Added.
          </p>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-medium">
          Current members
        </h2>

        {members.isPending ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : members.data && members.data.data.length === 0 ? (
          <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
            This Cell has no members yet. A meeting can still be recorded as held with nobody
            to mark, which counts towards its coverage.
          </p>
        ) : members.data ? (
          <>
            <ul className="mt-4 flex flex-col gap-3">
              {members.data.data.map((member) => (
                <MemberRow
                  key={member.person_id}
                  member={member}
                  confirming={removing === member.person_id}
                  pending={remove.isPending && removing === member.person_id}
                  onAskRemove={() => setRemoving(member.person_id)}
                  onCancel={() => setRemoving(null)}
                  onConfirm={() => remove.mutate(member.person_id)}
                />
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
      </section>
    </main>
  );
}

/**
 * One member, with removal behind a confirmation.
 *
 * The confirmation is not ceremony: a removal ends a membership from today, which
 * changes who a meeting's roster asks about from now on. It is reversible by adding
 * the person back, and the wording says what it does rather than warning.
 */
function MemberRow({
  member,
  confirming,
  pending,
  onAskRemove,
  onCancel,
  onConfirm,
}: {
  member: CellMember;
  confirming: boolean;
  pending: boolean;
  onAskRemove: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          {/*
            A heading rather than a paragraph: each member is a section of the
            list with its own controls, so a screen reader should be able to move
            between them by heading rather than by reading every line.
          */}
          <h3 className="text-base font-medium">{member.full_name}</h3>
          <p className="text-muted mt-1 text-sm">
            {member.member_id} — a member since {dayLabel(member.started_at.slice(0, 10))}
          </p>
        </div>

        {confirming ? (
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={onConfirm} disabled={pending}>
              {pending ? 'Removing…' : 'Yes, remove'}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Keep
            </Button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={onAskRemove}>
            Remove
          </Button>
        )}
      </div>

      {confirming ? (
        <p className="text-muted mt-3 max-w-2xl text-sm leading-relaxed">
          Their membership ends today. Past months keep counting them, and you can add them
          back at any time.
        </p>
      ) : null}
    </li>
  );
}
