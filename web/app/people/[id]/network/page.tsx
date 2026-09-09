'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { getPastoralPath, reassignPastoralLeader } from '@/lib/hierarchy';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * Where a person sits in the pastoral tree, and moving them (SKILL.md sections 5
 * and 8; decision 0131).
 *
 * **The path runs from the top down, and says which end is a root.** Decision 0131
 * settles that: a chain that did not say so would read the same whether it reached
 * a Network root or simply ran out of people the viewer may see, and those are
 * different facts about the church.
 *
 * **Reassignment is the highest-risk authorization surface in the system, and
 * none of that risk is managed on this screen.** Section 5 refuses a leader outside
 * the actor's own subtree in either direction, refuses the actor changing their own
 * assignment or anyone upline of them, refuses a cycle, refuses a cross-Network
 * edge, and refuses an archived Person. Every one is the API's and is tested there.
 * A client that tried to anticipate them would be building half the rule — and
 * would be wrong about the subtree the moment anything moved.
 *
 * **No effective date is offered.** Section 5 gates backdating behind its own
 * capability, an audit entry and a reason, because a backdated assignment rewrites
 * which subtree a person belonged to in periods that may already be closed. A date
 * field on an ordinary form invites somebody to reach for it without knowing that,
 * so this screen files the change as of now and leaves backdating to a surface that
 * can explain itself.
 *
 * **A reason is offered and optional**, matching what the API accepts. Section 5
 * wants the why recorded where there is one; requiring it on every move would get
 * "moved" typed into the box.
 */
export default function PastoralNetworkPage() {
  return (
    <AppShell>
      <PastoralNetwork />
    </AppShell>
  );
}

function PastoralNetwork() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [chosen, setChosen] = useState<{ id: string; full_name: string } | null>(null);
  const [reason, setReason] = useState('');

  const path = useQuery({
    queryKey: ['pastoral-path', params.id],
    queryFn: ({ signal }) => getPastoralPath(params.id, signal),
  });

  const move = useMutation({
    mutationFn: () => {
      if (chosen === null) {
        throw new Error('Nobody chosen.');
      }
      return reassignPastoralLeader(
        params.id,
        chosen.id,
        reason.trim() || undefined,
        idempotencyKeyFor('reassign', params.id, chosen.id, reason.trim()),
      );
    },
    onSuccess: async () => {
      setChosen(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['pastoral-path', params.id] });
    },
  });

  const entries = path.data?.data ?? [];
  const person = entries.at(-1);

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/people/${params.id}`}
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this person
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {person ? `${person.full_name} in the tree` : 'Pastoral network'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Who pastors whom, from the top of the Network down to this person.
      </p>

      <div className="mt-8">
        <FailureNotice
          failure={
            path.isError ? describeFailure(path.error) : move.isError ? describeFailure(move.error) : null
          }
        />
      </div>

      {path.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : (
        <>
          <ol className="mt-6 flex flex-col gap-2">
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className="border-line rounded-lg border p-4"
                style={{ marginLeft: `${Math.min(index, 6) * 12}px` }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-base font-medium">
                    <Link
                      href={`/people/${entry.id}`}
                      className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {entry.full_name}
                    </Link>
                  </h2>
                  {/*
                    Words rather than an icon or a colour (1.4.1, decision 0131).
                    Which end is a root is information and must not be carried by
                    styling alone.
                  */}
                  {entry.network_root ? (
                    <p className="text-muted text-sm">Network root</p>
                  ) : null}
                </div>
                <p className="text-muted mt-1 text-sm">{entry.member_id}</p>
              </li>
            ))}
          </ol>

          {/*
            Stated because the alternative is a chain that looks complete. The
            path is built from the assignments this viewer may see, and it says
            so rather than letting a short chain read as a shallow tree.
          */}
          {entries.length > 0 && !entries[0].network_root ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              This chain does not reach a Network root, so it stops at the highest leader
              recorded above this person.
            </p>
          ) : null}
        </>
      )}

      <section className="mt-10" aria-labelledby="move-heading">
        <h2 id="move-heading" className="text-lg font-medium">
          Move to a different leader
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Search everyone in the church. Whether you may make this change is decided by the
          server: a leader outside your own subtree, anyone above you, a move that would form
          a loop, and a leader in the other Network are each refused with their own message.
        </p>
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          The change takes effect now. Backdating one rewrites which subtree this person
          belonged to in months that may already be closed, and is a separate permission.
        </p>

        <div className="mt-4">
          <PersonPicker
            selectedId={chosen?.id ?? null}
            selectedName={chosen?.full_name ?? null}
            onSelect={setChosen}
          />
        </div>

        {chosen ? (
          <>
            <div className="mt-4">
              <label htmlFor="reason" className="block text-sm font-medium">
                Why is this changing? (optional)
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                maxLength={500}
                className="border-line focus-visible:outline-accent mt-2 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </div>

            <Button
              type="button"
              className="mt-4"
              onClick={() => move.mutate()}
              disabled={move.isPending}
            >
              {move.isPending ? 'Moving…' : `Move under ${chosen.full_name}`}
            </Button>
          </>
        ) : null}

        {move.isSuccess ? (
          <p aria-live="polite" className="mt-4 text-sm font-medium">
            Moved.
          </p>
        ) : null}
      </section>
    </main>
  );
}
