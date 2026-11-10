'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { ShowMore } from '@/components/awaiting-lists';
import { FailureNotice } from '@/components/ui/failure-notice';
import { LoadingBlocks } from '@/components/ui/loading-blocks';
import { TextLink } from '@/components/ui/text-link';
import { type CellSummary, cellShortName, dayOfWeekLabel, listCellMembers } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';

/**
 * One Cell the reader's leaders lead, on My Cell (decision 0468): its leader, what it is and
 * this month's coverage line, opened in place to its members.
 *
 * **Its members are asked for only when it is opened**, once, and kept: most rows are never
 * opened, so a leader overseeing many Cells costs the server nothing for those. Its one link
 * is not prefetched, for the same reason. The figures are the server's own, two and never
 * divided (section 12), and nothing here is coloured by them (section 13).
 */
export function LeaderCellRow({ cell, month }: { cell: CellSummary; month: string }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const members = useInfiniteQuery({
    queryKey: ['cell-members', cell.id, 'open-row'],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => listCellMembers(cell.id, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const people = (members.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <li className="border-line border-b last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((current) => !current)}
          className="focus-visible:outline-accent hover:bg-raised flex min-h-11 w-full items-center gap-3 rounded-md px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          <span aria-hidden="true" className="text-accent w-4 text-center font-bold">
            {open ? '−' : '+'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-bold">{cell.leader.full_name}</span>
              <span className="text-muted text-sm font-normal whitespace-nowrap">
                {cell.member_count} {cell.member_count === 1 ? 'member' : 'members'}
              </span>
            </span>
            <span className="text-muted block text-sm font-normal">
              <span className="block sm:inline">
                {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">
                {' · '}
              </span>
              <span className="text-ink block font-semibold sm:inline">
                <span className="tabular-nums">
                  {cell.coverage.recorded} of {cell.coverage.scheduled}
                </span>{' '}
                recorded
                {cell.coverage.behind > 0 ? ` · ${cell.coverage.behind} to record` : ''}
              </span>
            </span>
          </span>
        </button>
      </h3>
      {open ? (
        <div id={panel} className="pr-4 pb-3 pl-11">
          <p className="text-muted text-sm">
            {dayOfWeekLabel(cell.schedule.day_of_week)}s {cell.schedule.time_of_day} ·{' '}
            <span className="whitespace-nowrap">{cell.cell_id}</span>
          </p>
          <FailureNotice failure={members.isError ? describeFailure(members.error) : null} />
          {members.isPending ? (
            <LoadingBlocks shape="lines" className="mt-2" />
          ) : members.isSuccess && people.length === 0 ? (
            <p className="text-muted mt-2 text-sm">No members yet.</p>
          ) : (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {people.map((person) => (
                <li key={person.person_id}>{person.full_name}</li>
              ))}
            </ul>
          )}
          <ShowMore pages={members} />
          <p className="mt-1">
            <TextLink href={`/cells/${cell.id}/meetings?month=${month}`} prefetch={false}>
              See this Cell&rsquo;s meetings
            </TextLink>
          </p>
        </div>
      ) : null}
    </li>
  );
}
