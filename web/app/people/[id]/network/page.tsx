'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { FailureNotice } from '@/components/ui/failure-notice';
import { getPastoralPath } from '@/lib/hierarchy';
import { describeFailure } from '@/lib/messages';

/**
 * Where a person sits in the pastoral tree (SKILL.md sections 5 and 8; decision 0131).
 *
 * **The path runs from the top down, and says which end is a root.** Decision 0131
 * settles that: a chain that did not say so would read the same whether it reached
 * a Network root or simply ran out of people the viewer may see, and those are
 * different facts about the church.
 *
 * **Moving someone is not done here.** It is Move to another leader on the person's
 * profile (owner's choice of 2026-09-15, step 2 of the clean-up), so there is one place
 * to move someone and this page only shows the chain. UI-6b redesigns it.
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

  const path = useQuery({
    queryKey: ['pastoral-path', params.id],
    queryFn: ({ signal }) => getPastoralPath(params.id, signal),
  });

  const entries = path.data?.data ?? [];
  const person = entries.at(-1);

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/people/${params.id}`}
          className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this person
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {person ? `${person.full_name} in the tree` : 'Pastoral network'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Who pastors whom, from the top of the Network down to this person. To move them to
        another leader, use Move to another leader on their profile.
      </p>

      <div className="mt-8">
        <FailureNotice failure={path.isError ? describeFailure(path.error) : null} />
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
    </main>
  );
}
