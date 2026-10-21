'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { peopleWithoutACell } from '@/lib/cells';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';
import { cn } from '@/lib/utils';

/**
 * Section 15's two attention lists, *Awaiting CG Assignment* and *Awaiting Leader Assignment*
 * (decisions 0232 and 0233), each on the screen its remedy is on (decision 0381): the first a
 * tab of `Cells`, where a person is put in a Cell, and the second a tab of `People`, where a
 * person is moved to a leader. They left `Record`, which is for recording. Both ask about now.
 */

/** A name that opens its record: 24px tall at least, which 2.5.8 measures. */
export const NAME_LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/** A list's count for its tab: the rows read so far, `+` while more remain. */
function countOf(pages: { data?: { pages: { data: unknown[] }[] }; hasNextPage: boolean }) {
  const data = pages.data?.pages.flatMap((page) => page.data);
  return data ? `${data.length}${pages.hasNextPage ? '+' : ''}` : null;
}

/** The people not in a Cell or leading one, fifty at a time (decision 0233). */
export function useWithoutACell(enabled: boolean) {
  const pages = useInfiniteQuery({
    queryKey: ['people-without-a-cell', 'awaiting'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => peopleWithoutACell({ limit: 50, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  return { pages, count: countOf(pages) };
}

/** The people whose pastoral leader is not in the tree, fifty at a time (decision 0232). */
export function useAwaitingLeader(enabled: boolean) {
  const pages = useInfiniteQuery({
    queryKey: ['awaiting-reassignment', 'awaiting'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => awaitingReassignment({ limit: 50, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  return { pages, count: countOf(pages) };
}

/** *Awaiting CG Assignment*, as a tab of `Cells` (decisions 0233 and 0381). */
export function AwaitingCgList() {
  const { pages } = useWithoutACell(true);
  const data = pages.data?.pages.flatMap((page) => page.data);

  return (
    <section className="min-w-0 pt-5" aria-labelledby="without-cell-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="without-cell-heading" className="text-lg font-bold tracking-tight">
          Awaiting CG Assignment
        </h2>
        <p className="text-muted text-sm">People you oversee who are not in a Cell or leading one.</p>
      </div>
      <div className="mt-3">
        <FailureNotice failure={pages.isError ? describeFailure(pages.error) : null} />
      </div>
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          <ListTable
            caption="Awaiting CG Assignment"
            columns={['Name']}
            empty="Everybody you oversee is in a Cell."
            rows={data.map((person) => ({
              key: person.id,
              cells: [
                <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                  {person.full_name}
                </Link>,
              ],
            }))}
          />
          <ShowMore pages={pages} />
        </>
      ) : null}
    </section>
  );
}

/** *Awaiting Leader Assignment*, as a tab of `People` (decisions 0232, 0356 and 0381). */
export function AwaitingLeaderList() {
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  // Who may move them: a Leader only when ticked Moves people (decision 0356). The API decides
  // each move again.
  const mayMove = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'people.manage_pastoral_assignment',
  );
  const { pages } = useAwaitingLeader(true);
  const data = pages.data?.pages.flatMap((page) => page.data);

  return (
    <section className="min-w-0 pt-5" aria-labelledby="unplaced-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="unplaced-heading" className="text-lg font-bold tracking-tight">
          Awaiting Leader Assignment
        </h2>
        <p className="text-muted text-sm">
          People you oversee whose pastoral leader is not in the pastoral tree.
        </p>
      </div>
      {/* Read only for a reader who may not move them (owner, 2026-10-16, decision 0356). */}
      {me.data && !mayMove ? (
        <p className="text-muted mt-2 text-sm">A new leader is chosen by your Primary.</p>
      ) : null}
      <div className="mt-3">
        <FailureNotice failure={pages.isError ? describeFailure(pages.error) : null} />
      </div>
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : data ? (
        <>
          {/* The action that resolves an entry is the reassignment (section 19). */}
          <ListTable
            caption="Awaiting Leader Assignment"
            columns={['Name', 'Previous Cell Leader']}
            empty="Nobody you oversee is waiting for a new leader."
            rows={data.map((person) => ({
              key: person.id,
              cells: [
                // The person page, where Move to another leader is.
                <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                  {person.full_name}
                </Link>,
                person.former_leader.full_name,
              ],
            }))}
          />
          <ShowMore pages={pages} />
        </>
      ) : null}
    </section>
  );
}

/**
 * A list as a table from `lg` and as cards below it, the shape the Cells page uses. An
 * empty list keeps its table and says so in one row (owner's choice of 2026-09-25).
 */
export function ListTable({
  caption,
  columns,
  empty,
  rows,
}: {
  caption: string;
  columns: readonly string[];
  empty: string;
  rows: readonly { key: string; cells: readonly ReactNode[] }[];
}) {
  return (
    <>
      <Table caption={caption} className="mt-3 hidden lg:block">
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column}>{column}</HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-muted px-3 py-3">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className={rowClasses}>
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]}
                    className={cn('px-3 py-3 align-top', index > 0 && 'text-muted')}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <ul className="mt-3 flex flex-col gap-3 lg:hidden">
        {rows.length === 0 ? (
          <li className="border-line text-muted border p-4 text-sm">{empty}</li>
        ) : (
          rows.map((row) => (
            <li key={row.key} className="border-line border p-4">
              <p className="text-base">{row.cells[0]}</p>
              <dl className="text-muted mt-2 grid gap-y-1 text-sm">
                {row.cells.slice(1).map((cell, index) => (
                  <div key={columns[index + 1]} className="flex flex-wrap gap-x-2">
                    <dt>{columns[index + 1]}</dt>
                    <dd className="text-ink">{cell}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))
        )}
      </ul>
    </>
  );
}

/** The next fifty, in place, so nobody on a list is out of reach (decision 0290). */
export function ShowMore({
  pages,
}: {
  pages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
}) {
  return pages.hasNextPage ? (
    <p className="mt-4">
      <button
        type="button"
        onClick={() => void pages.fetchNextPage()}
        disabled={pages.isFetchingNextPage}
        className={buttonClasses('secondary')}
      >
        {pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
      </button>
    </p>
  ) : null;
}
