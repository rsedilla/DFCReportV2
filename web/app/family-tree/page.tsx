'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PeopleTabs } from '@/components/people-tabs';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { FRAME } from '@/components/ui/frame';
import { describeFailure } from '@/lib/messages';
import { getBranch, getMyBranch, type Branch, type BranchNode } from '@/lib/network';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/** The API's most, so a generation is rarely more than one read. */
const FETCH = '200';

/**
 * The Family Tree tab (decision 0341): the reader's branch as an outline, the reader first,
 * each line opening that person's direct disciples in place, to any depth. Everyone is
 * listed by name, whether or not they lead anybody, and a name opens the person's page.
 *
 * It reads the Branch screen's routes under `people.view_subtree` and carries two of Branch's
 * headcounts and no other figure or action, so it shows nothing Branch does not. A generation is read only when it is
 * opened. A reader outside the pastoral tree starts at the Network roots, as Branch does
 * (decision 0268).
 *
 * **The indent stops growing** after four generations on a phone and eight on a wider
 * screen, so a deep branch stays readable; each line still says how many it leads.
 */
export default function FamilyTreePage() {
  const mine = useQuery({
    queryKey: ['network-branch', 'mine', 'tree'],
    queryFn: ({ signal }) => getMyBranch(undefined, signal, FETCH),
  });

  const roots = mine.data?.roots ?? [];

  return (
    <AppShell>
      <main id="main" className={PAGE_WIDTH.INDEX}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Family Tree</h1>
        </div>

        <PeopleTabs current="/family-tree">
          <FailureNotice failure={mine.isError ? describeFailure(mine.error) : null} />
          {mine.isPending ? (
            <p className="text-muted text-sm">Loading&hellip;</p>
          ) : mine.data === undefined ? null : (
            <section aria-label="Family Tree" className={`mt-6 ${FRAME}`}>
              <ul className="[--tree-cap:4] [--tree-step:14px] sm:[--tree-cap:8] sm:[--tree-step:22px]">
                {roots.length > 0 ? (
                  roots.map((root) => <TreeLine key={root.id} node={root} depth={0} />)
                ) : (
                  <TreeLine node={mine.data.person} depth={0} you initial={mine.data} />
                )}
              </ul>
            </section>
          )}
        </PeopleTabs>
      </main>
    </AppShell>
  );
}

/**
 * One person and, once opened, their direct disciples. The reader's own line arrives open,
 * with the first page already read by `my-tree`.
 */
function TreeLine({
  node,
  depth,
  you = false,
  initial,
}: {
  node: BranchNode;
  depth: number;
  you?: boolean;
  initial?: Branch;
}) {
  const [open, setOpen] = useState(you);
  const leads = node.direct_reports > 0;

  const children = useInfiniteQuery<Branch>({
    queryKey: ['family-tree', node.id],
    initialPageParam: undefined as string | undefined,
    // The reader's own line goes on paging the route it started from.
    queryFn: ({ pageParam, signal }) =>
      you
        ? getMyBranch(pageParam as string | undefined, signal, FETCH)
        : getBranch(node.id, pageParam as string | undefined, signal, FETCH),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    initialData:
      initial === undefined ? undefined : { pages: [initial], pageParams: [undefined] },
    enabled: open && leads,
  });

  const rows = children.data?.pages.flatMap((page) => page.data) ?? [];
  const name = `${node.full_name}${you ? ' (you)' : ''}`;

  return (
    <li>
      <div
        className="border-line flex min-h-11 items-center gap-2 border-b py-1"
        style={{ paddingLeft: `calc(min(${depth}, var(--tree-cap)) * var(--tree-step))` }}
      >
        {leads ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${node.full_name}’s disciples`}
            onClick={() => setOpen(!open)}
            className="border-edge focus-visible:outline-accent inline-flex size-8 shrink-0 items-center justify-center rounded border focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {open ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="size-8 shrink-0" />
        )}
        <span className="min-w-0">
          <Link href={`/people/${node.id}`} className={LINK}>
            {name}
          </Link>
          <span className="text-muted block text-sm">
            {leads ? `${node.direct_reports} direct · ${node.beneath} beneath` : 'leads nobody yet'}
          </span>
        </span>
      </div>

      {open && leads ? (
        <>
          {children.isError ? (
            <div className="py-2">
              <FailureNotice failure={describeFailure(children.error)} />
            </div>
          ) : children.isPending ? (
            <p className="text-muted py-2 text-sm">Loading&hellip;</p>
          ) : (
            <ul aria-label={`${node.full_name}’s disciples`}>
              {rows.map((row) => (
                <TreeLine key={row.id} node={row} depth={depth + 1} />
              ))}
            </ul>
          )}
          {children.hasNextPage ? (
            <p className="py-2">
              <Button
                variant="secondary"
                onClick={() => void children.fetchNextPage()}
                disabled={children.isFetchingNextPage}
              >
                {children.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </Button>
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
