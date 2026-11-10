'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { PAGE_WIDTH } from '@/components/app-shell';
import { ShowMore } from '@/components/awaiting-lists';
import { MyCellTabs } from '@/components/my-cell-tabs';
import { SentRequests } from '@/components/sent-requests';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Tag } from '@/components/ui/tag';
import {
  type CellSummary,
  cellShortName,
  dayOfWeekLabel,
  getCellCounts,
  listCells,
} from '@/lib/cells';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { openUntilLabel, reportingMonthOf } from '@/lib/reporting-month';
import { cn } from '@/lib/utils';

export default function MyCellPage() {
  return (
    <>
      <MyCell />
    </>
  );
}

/**
 * `My Cell`, on the recording screens (section 19, decision 0323): the reader's own Cells,
 * each with its members and this month's meetings, and the requests the reader has sent.
 * Asking for a new Cell is the tab beside it (decision 0457). A Cell's own pages are the ones
 * every account uses. Under the reader's own, the Cells their leaders lead (decision 0463).
 */
function MyCell() {
  const month = reportingMonthOf();

  const cells = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  // The Cell Groups in the reader's care as of today, every level of their branch, as My People
  // lists its people (decision 0438): the counts the Cells page's totals read (decision 0309).
  // One small call, alongside the list.
  const counts = useQuery({
    queryKey: ['cell-counts'],
    queryFn: ({ signal }) => getCellCounts(signal),
  });
  const inCare = counts.data?.in_scope ?? 0;
  const mine = counts.data?.led_by_me ?? 0;

  // **The Cells the reader's leaders lead, ten at a time** (decision 0463). The list the Cells
  // page reads puts the reader's own Cells first (decision 0400), so the first page asks for
  // as many more as the reader leads and leaves those out here; a Cell whose leadership moved
  // between the two reads is left out by its leader rather than by its place.
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const theirs = useInfiniteQuery({
    queryKey: ['cells', month, 'led-by-others', mine],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listCells(
        { month, cursor: pageParam, limit: pageParam === undefined ? LEADERS_PAGE + mine : LEADERS_PAGE },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: counts.isSuccess && inCare > mine && me.data !== undefined,
  });
  const ledByOthers = (theirs.data?.pages ?? [])
    .flatMap((page) => page.data)
    .filter((cell) => cell.leader.person_id !== me.data?.person_id);

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <MyCellTabs current="mine">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
        <FailureNotice failure={theirs.isError ? describeFailure(theirs.error) : null} />
        {inCare > 0 ? (
          <div className="mt-5">
            <h2 className="text-xl font-semibold">
              <span className="text-accent tabular-nums">{inCare}</span>{' '}
              {inCare === 1 ? 'Cell Group' : 'Cell Groups'} in your care
            </h2>
            {/* As the Cells page says it, "People you oversee" where they lead none (0317). */}
            <p className="text-muted text-sm">
              {mine > 0
                ? `${mine} you lead · ${inCare - mine} led by your leaders`
                : 'People you oversee'}{' '}
              · as of today
            </p>
          </div>
        ) : null}
        {cells.isPending ? (
          <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
        ) : cells.data && cells.data.data.length === 0 ? (
          <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
            You don&rsquo;t lead a Cell Group yet.{' '}
            <Link href="/my-cell/new" className="text-accent font-semibold underline">
              Request one
            </Link>{' '}
            and it will be sent for approval.
          </p>
        ) : cells.data ? (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="field-label">You lead</h2>
              {/* Section 17: a month's coverage line says the month is still running. */}
              {cells.data.open ? <Tag>{openUntilLabel(month)}</Tag> : null}
            </div>
            <ul className="mt-2 grid gap-4 sm:grid-cols-2">
              {cells.data.data.map((cell) => (
                <CellCard key={cell.id} cell={cell} month={month} />
              ))}
            </ul>
          </>
        ) : null}

        {/* Read to follow up: each Cell is recorded by its own leader (decision 0322), so both
            buttons are plain and the reader's own Meetings stays the one filled. */}
        {ledByOthers.length > 0 ? (
          <>
            <h2 className="field-label mt-6">Led by your leaders</h2>
            <ul className="mt-2 grid gap-4 sm:grid-cols-2">
              {ledByOthers.map((cell) => (
                <CellCard key={cell.id} cell={cell} month={month} ledBy={cell.leader.full_name} />
              ))}
            </ul>
            <ShowMore pages={theirs} />
          </>
        ) : null}

        <SentRequests plain />
      </MyCellTabs>
    </main>
  );
}

const LEADERS_PAGE = 10;

/**
 * One Cell: its name and size, schedule and Cell ID, and this month's coverage line. `ledBy`
 * names the leader of a Cell the reader does not lead, whose two buttons are both plain.
 */
function CellCard({ cell, month, ledBy }: { cell: CellSummary; month: string; ledBy?: string }) {
  return (
    <li className="border-line rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold tracking-tight">
          {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
        </h3>
        <span className="text-muted text-sm whitespace-nowrap">
          {cell.member_count} {cell.member_count === 1 ? 'member' : 'members'}
        </span>
      </div>
      <p className="text-muted mt-1 text-sm">
        {dayOfWeekLabel(cell.schedule.day_of_week)}s {cell.schedule.time_of_day} ·{' '}
        {cell.cell_id}
      </p>
      {ledBy ? (
        <p className="mt-1 text-sm">
          Led by <span className="font-semibold">{ledBy}</span>
        </p>
      ) : null}
      {/* The server's own figures, two and never divided (section 12); `behind` is
          never worked out here (decision 0267). In words alone, and Meetings is
          filled on every Cell the reader leads, so a Cell behind is not marked by colour. */}
      <p className="mt-2 text-sm">
        <span className="font-bold tabular-nums">
          {cell.coverage.recorded} of {cell.coverage.scheduled}
        </span>{' '}
        recorded this month
        {cell.coverage.behind > 0 ? (
          <>
            {' · '}
            <span className="font-bold">{cell.coverage.behind} to record</span>
          </>
        ) : null}
      </p>
      <div className="mt-3 flex gap-3">
        <Link
          href={`/cells/${cell.id}/meetings?month=${month}`}
          className={cn(buttonClasses(ledBy ? 'secondary' : undefined), 'min-w-0 flex-1 sm:min-w-0')}
        >
          Meetings
        </Link>
        <Link
          href={`/cells/${cell.id}/members`}
          className={cn(buttonClasses('secondary'), 'min-w-0 flex-1 sm:min-w-0')}
        >
          Members
        </Link>
      </div>
    </li>
  );
}
