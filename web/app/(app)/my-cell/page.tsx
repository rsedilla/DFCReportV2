'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { PAGE_WIDTH } from '@/components/app-shell';
import { MyCellTabs } from '@/components/my-cell-tabs';
import { SentRequests } from '@/components/sent-requests';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { cellShortName, dayOfWeekLabel, getCellCounts, listCells } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

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
 * every account uses.
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

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <MyCellTabs current="mine">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
        <FailureNotice failure={counts.isError ? describeFailure(counts.error) : null} />
        {inCare > 0 ? (
          <div className="mt-5">
            <h2 className="text-2xl font-semibold">
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
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {(cells.data?.data ?? []).map((cell) => (
              <li key={cell.id} className="border-line rounded-md border p-4">
                <h2 className="text-lg font-bold tracking-tight">
                  {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
                </h2>
                <p className="text-muted mt-1 text-sm">
                  {cell.cell_id} · {dayOfWeekLabel(cell.schedule.day_of_week)}s at{' '}
                  {cell.schedule.time_of_day} · {cell.member_count}{' '}
                  {cell.member_count === 1 ? 'member' : 'members'}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href={`/cells/${cell.id}/members`} className={buttonClasses('secondary')}>
                    Members
                  </Link>
                  <Link
                    href={`/cells/${cell.id}/meetings?month=${month}`}
                    className={buttonClasses('secondary')}
                  >
                    This month&rsquo;s meetings
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        <SentRequests />
      </MyCellTabs>
    </main>
  );
}
