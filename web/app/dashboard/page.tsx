'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { SentRequests } from '@/components/sent-requests';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME, ROW } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import { Tag } from '@/components/ui/tag';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  categoryLabel,
  behindOf,
  closedOnLabel,
  dayOfWeekLabel,
  timeLabel,
  listCells,
  listMeetingsAwaiting,
  type CellCategory,
  peopleWithoutACell,
  type AwaitingMeetings,
  type CellSummary,
} from '@/lib/cells';
import { getDccRoster, listDccEvents, type DccEvent, type DccRoster } from '@/lib/dcc';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment } from '@/lib/people';
import { getCellMonthlyReport, getDccMonthlyReport } from '@/lib/reports';
import {
  dayLabel,
  monthLabel,
  reportingMonthOf,
  shiftMonth,
  todayInManila,
} from '@/lib/reporting-month';
import { cn } from '@/lib/utils';

/**
 * How many people needing a leader the dashboard tile shows before deferring to the
 * full list (section 19).
 *
 * A dashboard entry is a prompt to act, not the list itself: section 15 forbids
 * ranking, so a longer tile would be a longer arbitrary slice rather than a more
 * useful one. The screen behind it pages honestly.
 */
const UNPLACED_TILE = 5;

/**
 * Where a signed-in leader lands (SKILL.md section 19).
 *
 * **Outstanding work comes above the numbers, and that is the whole design.**
 * Section 19 is blunt about it: "A dashboard of counts tells a leader nothing to
 * act on." So the first thing on this screen is what awaits a record, each entry
 * carrying the button that resolves it, and the second is the Cells whose coverage
 * line shows something missing. The figures follow.
 *
 * **The queue shows the leader's own work by default, and their branch's on request**
 * (decision 0258, reversing the owner's choice of 2026-09-15).
 *
 * **Every tile carries what it counts, its value, its scope and its period**
 * (section 19). A tile reading `12` and a tile reading `11,480` are the same tile
 * for two different people, and a figure without its scope "cannot be discussed,
 * screenshotted, or compared". The figures are words and numbers; last month's figure sits
 * under each (owner's choice of 2026-09-19) and there are no progress bars, because a bar that reads as empty is coverage encoded as a
 * graphic, which is the thing sections 13 and 17 forbid by another route.
 *
 * **Current-state and period-based figures are in separate sections and never
 * interleaved.** Section 3 draws that line and section 19 says a dashboard is
 * where it is most easily lost.
 *
 * **An open month says so**, because the same tile on the 5th and the 31st shows
 * very different numbers with nothing having happened (sections 17 and 19).
 *
 * **Attendance counts unique people and never occurrences** (section 19, principle
 * 10). Both figures here come from the reporting routes, which count distinct
 * people; nothing on this screen sums attendances.
 *
 * **Nothing here is ranked or colour-graded** (sections 13, 17 and 19). The queue is
 * in date order, oldest first, and says so; the attention list is filtered rather
 * than sorted, in the order the API returns.
 */
export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

type QueueFilter = 'ALL' | 'CELLS' | 'DCC';

/** Whose outstanding work the queue shows (decision 0258). */
type Whose = 'mine' | 'branch';

type QueueItem =
  | {
      kind: 'cell';
      month: string;
      date: string;
      time: string;
      cellId: string;
      cellCode: string;
      /** Null while the Cell is `ACTIVE`; a Manila date once it has closed. */
      closedOn: string | null;
      dayOfWeek: number;
      category: CellCategory | null;
      memberCount: number;
      leaderName: string | null;
      isActor: boolean;
      mayRecord: boolean;
    }
  | { kind: 'dcc'; month: string; date: string; eventId: string; marked: number; total: number };

/**
 * A month's Cell meetings still awaiting a record from this leader.
 *
 * **The server decides the population now** (ruling of 2026-09-17). It was assembled
 * here from the Cells index and one request per Cell, which could not reach a **closed**
 * Cell's meetings at all — the index is `ACTIVE`-only. The day bound and the "no record" filter
 * moved with it: both are the route's, so a client cannot drift from them.
 */
function cellEntries(awaiting: AwaitingMeetings | undefined): QueueItem[] {
  return (awaiting?.meetings ?? []).map((entry) => ({
    kind: 'cell' as const,
    month: entry.reporting_month,
    date: entry.scheduled_date,
    time: entry.scheduled_time,
    cellId: entry.cell_id,
    cellCode: entry.cell_code,
    closedOn: entry.cell_closed_on,
    dayOfWeek: entry.day_of_week,
    category: entry.category,
    memberCount: entry.member_count,
    leaderName: entry.leader.full_name,
    isActor: entry.leader.is_actor,
    mayRecord: entry.may_record,
  }));
}

/**
 * A month's Sundays with anybody on the leader's own checklist still unmarked.
 *
 * A checklist with nobody on it owes nothing — somebody who disciples nobody has no DCC
 * record to make — so it is not an entry either. The events passed in are the ones that
 * take a record now, which already leaves out a Sunday not yet reached, a removed one,
 * and one whose month has closed.
 */
function dccEntries(
  events: readonly DccEvent[],
  checklists: readonly { data?: DccRoster }[],
  month: string,
): QueueItem[] {
  return events.flatMap((event, index) => {
    const lines = checklists[index]?.data?.data;

    if (lines === undefined || lines.length === 0) {
      return [];
    }

    const marked = lines.filter((line) => line.record !== null).length;

    return marked === lines.length
      ? []
      : [
          {
            kind: 'dcc' as const,
            month,
            date: event.event_date,
            eventId: event.id,
            marked,
            total: lines.length,
          },
        ];
  });
}

function Dashboard() {
  const month = reportingMonthOf();
  const today = todayInManila();
  const previousMonth = shiftMonth(month, -1);

  // **The first seven days of a month, while last month may still be open** (section
  // 13, decision 0170). Section 13 has every leader see their own outstanding work
  // "always", and last month's is still outstanding until its window closes on the 7th
  // (owner's choice of 2026-09-15). The browser's clock only decides whether to ask; the
  // server's `open` flag and each Sunday's `recordable` decide what is shown.
  const inCloseWeek = Number(today.slice(8, 10)) <= 7;

  const [filter, setFilter] = useState<QueueFilter>('ALL');
  // The reader's own work is the default (decision 0258).
  const [whose, setWhose] = useState<Whose>('mine');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // Section 20's attention list (decision 0232). It takes no month: the list asks
  // about now, so it is deliberately not keyed on the period the figures below use.
  //
  // One more than the tile shows, so "is there more than this" is answered by the
  // read rather than by a second request — the same trick the collection endpoints
  // use one layer down, and section 22 returns no total to ask instead.
  const unplaced = useQuery({
    queryKey: ['awaiting-reassignment', 'dashboard'],
    queryFn: ({ signal }) => awaitingReassignment({ limit: UNPLACED_TILE + 1 }, signal),
  });

  // Section 15's other attention list (decision 0233), and undated for the same
  // reason: it asks who is not in a Cell now.
  const withoutACell = useQuery({
    queryKey: ['people-without-a-cell', 'dashboard'],
    queryFn: ({ signal }) => peopleWithoutACell({ limit: UNPLACED_TILE + 1 }, signal),
  });

  // **One request per open month**, replacing two index calls and one per Cell. The
  // key is the month and whose view is shown (decision 0258).
  //
  // **The recording screen clears it by the bare `meetings-awaiting` prefix**, which
  // it had to be given: the queue used to be keyed `['cell-meetings', id, month]` and
  // was cleared by the invalidation that screen already made, and this key is not
  // under that prefix. Said the other way round, moving the queue onto its own route
  // moved it out of the reach of the only thing that refreshed it.
  const awaiting = useQuery({
    queryKey: ['meetings-awaiting', month, whose],
    queryFn: ({ signal }) => listMeetingsAwaiting(month, signal, whose),
  });

  // **The tile's own read, and no longer the queue's.** "Cells you lead" is a
  // current-state figure and the `ACTIVE`-only index is exactly right for it: a closed
  // Cell is not one you lead. The queue needs the opposite and now asks its own route.
  const mine = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  const scoped = useQuery({
    queryKey: ['cells', month, false],
    queryFn: ({ signal }) => listCells({ month }, signal),
  });

  // **Section 15's attention list includes a closed Cell while its month is open**, and
  // the running view cannot carry one. The closed view (decision 0266) can. What a page
  // bound owes this list is recorded as open in `CLAUDE.md`.
  const scopedClosed = useQuery({
    queryKey: ['cells', month, false, 'CLOSED'],
    queryFn: ({ signal }) => listCells({ month, state: 'CLOSED' }, signal),
  });

  // **The Sundays on the leader's own checklist.** The events index says which of
  // this month's Sundays take a record now; the checklist for each says whether
  // anybody on it is still unmarked. A Sunday that has not happened, was removed,
  // or whose month has closed takes no record and so is never in the queue.
  //
  // The checklist is read under the key the DCC screen uses, so saving there
  // refreshes this entry rather than leaving it saying something is awaiting.
  const dccEvents = useQuery({
    queryKey: ['dcc-events', month],
    queryFn: ({ signal }) => listDccEvents(month, signal),
  });

  const recordableEvents = (dccEvents.data?.data ?? []).filter((event) => event.recordable);

  const checklists = useQueries({
    queries: recordableEvents.map((event) => ({
      queryKey: ['dcc-roster', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getDccRoster(event.id, signal),
    })),
  });

  // **Last month's outstanding work, read only in the close week.** A month that has
  // shut answers `open: false` and an empty list rather than refusing, so nothing here
  // has to decide whether it is still the leader's to record.
  const awaitingPrevious = useQuery({
    queryKey: ['meetings-awaiting', previousMonth, whose],
    queryFn: ({ signal }) => listMeetingsAwaiting(previousMonth, signal, whose),
    enabled: inCloseWeek,
  });

  const dccEventsPrevious = useQuery({
    queryKey: ['dcc-events', previousMonth],
    queryFn: ({ signal }) => listDccEvents(previousMonth, signal),
    enabled: inCloseWeek,
  });

  const recordablePrevious = (dccEventsPrevious.data?.data ?? []).filter(
    (event) => event.recordable,
  );

  const checklistsPrevious = useQueries({
    queries: recordablePrevious.map((event) => ({
      queryKey: ['dcc-roster', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getDccRoster(event.id, signal),
    })),
  });

  /**
   * The scope the figures are read at, and why it is not always the actor.
   *
   * **A Whole Church grant is read as Whole Church.** Keying every tile on the
   * signed-in person's own subtree is right for a leader and wrong for anybody
   * holding a church-wide grant who is not themselves in the pastoral tree —
   * section 5 permits exactly that for an administrator, and section 20 then
   * places them in no subtree at all. The tiles read `0` while the attention
   * list above them showed real Cells, which is the disagreement this fixes.
   */
  const reportScope = holdsWholeChurch(me.data, 'reports.view_subtree')
    ? ({ kind: 'WHOLE_CHURCH' } as const)
    : ({ kind: 'LEADER', person_id: me.data?.person_id ?? '' } as const);

  const scopeLabel = holdsWholeChurch(me.data, 'reports.view_subtree')
    ? 'Whole Church'
    : 'People you oversee';

  const cellFigures = useQuery({
    queryKey: ['cell-report', month, reportScope],
    queryFn: ({ signal }) => getCellMonthlyReport(month, reportScope, signal),
    enabled: me.data !== undefined,
  });

  const dccFigures = useQuery({
    queryKey: ['dcc-report', month, reportScope],
    queryFn: ({ signal }) => getDccMonthlyReport(month, reportScope, signal),
    enabled: me.data !== undefined,
  });

  // Last month's figures, shown under this month's on each card and named by month.
  const cellFiguresPrevious = useQuery({
    queryKey: ['cell-report', previousMonth, reportScope],
    queryFn: ({ signal }) => getCellMonthlyReport(previousMonth, reportScope, signal),
    enabled: me.data !== undefined,
  });

  // Section 19: an open period says so, and last month is open until its 7th.
  const previousName = monthLabel(previousMonth).split(' ')[0];
  const previousLabel = (open: boolean | undefined) =>
    `${previousName}${open ? ' (still open)' : ''}`;

  const dccFiguresPrevious = useQuery({
    queryKey: ['dcc-report', previousMonth, reportScope],
    queryFn: ({ signal }) => getDccMonthlyReport(previousMonth, reportScope, signal),
    enabled: me.data !== undefined,
  });

  // **Oldest first, and the page says so.** Date order is the one order that ranks
  // nobody, and it puts last month's entries before this month's. A Cell meeting and a
  // Sunday on the same date keep that order, because the sort is stable and the Cell
  // entries come first.
  const queue = [
    ...cellEntries(awaiting.data),
    ...cellEntries(awaitingPrevious.data),
    ...dccEntries(recordableEvents, checklists, month),
    ...dccEntries(recordablePrevious, checklistsPrevious, previousMonth),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const shown = queue.filter(
    (item) =>
      filter === 'ALL' ||
      (filter === 'CELLS' && item.kind === 'cell') ||
      (filter === 'DCC' && item.kind === 'dcc'),
  );

  // **Pending until every read the queue is built from has answered**, including the
  // per-Cell meetings and per-Sunday checklists, which only start once the two indexes
  // resolve. Until then an empty queue would say "nothing awaiting" when nothing is
  // yet known.
  //
  // Last month's two indexes count only in the close week: a query that is not enabled
  // stays pending for ever, and would otherwise hold the queue on "Loading…".
  const queuePending =
    awaiting.isPending ||
    dccEvents.isPending ||
    checklists.some((query) => query.isPending) ||
    (inCloseWeek && (awaitingPrevious.isPending || dccEventsPrevious.isPending)) ||
    checklistsPrevious.some((query) => query.isPending);

  // A queue built from a read that failed is not a queue, so it says nothing at all
  // and leaves the failure notice above to speak.
  const previousFailed = [awaitingPrevious, dccEventsPrevious, ...checklistsPrevious].find(
    (query) => query.isError,
  );

  const queueFailed =
    awaiting.isError ||
    dccEvents.isError ||
    checklists.some((query) => query.isError) ||
    previousFailed !== undefined;

  // Bounded by the window rather than by how recently the Cell closed, so the list never
  // shows a meeting only Admin could act on (section 15). **One predicate for both views**
  // (decision 0267): a meeting that has come and has no record. It used to compare with
  // the whole month's schedule, which named a running Cell for meetings not yet held.
  const needingAttention = [
    ...(scoped.data?.data ?? []),
    ...(scopedClosed.data?.open ? scopedClosed.data.data : []),
  ].filter((cell) => behindOf(cell.coverage) > 0);

  // **Every query on this page, not the ones it started with.** Section 19 puts
  // outstanding work above the figures precisely so a leader can trust it, and a
  // failed load that renders as an empty queue says "nothing to do" on this screen's
  // authority. The queue's own reads matter most and come first: without them it is
  // empty, which is the opposite of the truth. `mine` is named here although it now
  // feeds only a tile — a tile reading `—` because its read failed says nothing about
  // why, and this rule is about every query rather than about the queue's.
  const checklistFailed = checklists.find((query) => query.isError);

  const failure = awaiting.isError
    ? describeFailure(awaiting.error)
    : dccEvents.isError
      ? describeFailure(dccEvents.error)
      : checklistFailed
        ? describeFailure(checklistFailed.error)
        : previousFailed
          ? describeFailure(previousFailed.error)
          : mine.isError
            ? describeFailure(mine.error)
            : scoped.isError
              ? describeFailure(scoped.error)
              : scopedClosed.isError
                ? describeFailure(scopedClosed.error)
              : unplaced.isError
                ? describeFailure(unplaced.error)
                : cellFigures.isError
                  ? describeFailure(cellFigures.error)
                  : dccFigures.isError
                    ? describeFailure(dccFigures.error)
                    : withoutACell.isError
                      ? describeFailure(withoutACell.error)
                      : me.isError
                        ? describeFailure(me.error)
                        : null;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="text-muted text-xs font-bold tracking-[0.08em] uppercase">
        Record · {monthLabel(month)}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        {me.data?.first_name ? `Welcome, ${me.data.first_name}` : 'Dashboard'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        What needs doing comes first, with this month&rsquo;s figures beside it.
      </p>

      <div className="mt-8">
        <FailureNotice failure={failure} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="awaiting-heading" className={`min-w-0 ${FRAME}`}>
          <h2 id="awaiting-heading" className="text-lg font-bold tracking-tight">
            Awaiting a record
          </h2>
          <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
            {whose === 'mine'
              ? 'Your own Cells’ meetings and your own DCC checklist'
              : 'Your own work and your branch’s, each naming the leader who records it'}
            , this month
            {inCloseWeek ? ', and last month’s while it is still open' : ''}. Oldest first. Nothing
            here is scored or ranked.
          </p>

          <div className={`mt-4 ${CONTROL_BAR}`}>
            <RadioGroup
              legend="Whose"
              name="queue-whose"
              value={whose}
              onChange={setWhose}
              options={[
                { value: 'branch', label: 'People I oversee' },
                { value: 'mine', label: 'My own Cells' },
              ]}
            />
            <RadioGroup
              legend="Show"
              name="queue-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'CELLS', label: 'Cells' },
                { value: 'DCC', label: 'DCC' },
              ]}
            />
          </div>

          {queueFailed ? null : queuePending ? (
            <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
          ) : shown.length === 0 ? (
            <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
              {filter === 'CELLS'
                ? whose === 'mine'
                  ? 'No Cell meeting of yours is awaiting a record.'
                  : 'No Cell meeting in your branch is awaiting a record.'
                : filter === 'DCC'
                  ? whose === 'mine'
                    ? 'Nobody on your DCC checklist is awaiting a record.'
                    : 'No DCC record is owed in your branch.'
                  : whose === 'mine'
                    ? 'Nothing is awaiting a record from you.'
                    : 'Nothing is awaiting a record in your branch.'}
            </p>
          ) : (
            <ul className="border-line mt-4 border-t">
              {shown.map((item) => (
                <QueueRow
                  key={`${item.month}-${item.kind}-${item.kind === 'cell' ? `${item.cellId}-${item.date}` : item.eventId}`}
                  item={item}
                  currentMonth={month}
                  today={today}
                />
              ))}
            </ul>
          )}

          {filter === 'DCC' && whose === 'mine' ? (
            <DccChecklistGrid events={recordableEvents} checklists={checklists} month={month} />
          ) : null}

          {/*
            **Record is where DCC attendance is recorded from** (section 19, ruling of
            2026-09-14). The queue lists the Sundays with something outstanding; the
            calendar is the way to every Sunday of the month, including one already
            complete that a leader needs to look at again.
          */}
          <p className="mt-4">
            <Link
              href="/dcc"
              className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              See the whole month
            </Link>
          </p>
        </section>

        {/*
          This month so far, beside the queue as the owner's design places it (decision
          0258's screen, owner's choice of 2026-09-19). Each figure carries last month's,
          named by its month; no bars, because coverage is two figures and never a fraction
          (decision 0224).
        */}
        <aside aria-labelledby="period-heading" className="min-w-0">
          <h2 id="period-heading" className="text-lg font-bold tracking-tight">
            {monthLabel(month).split(' ')[0]} so far
          </h2>
          <p className="text-muted mt-1 text-sm">
            {periodLabel(month, cellFigures.data?.open)} · {scopeLabel}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <MonthCard
              label="Cell meetings recorded"
              value={
                cellFigures.data
                  ? `${cellFigures.data.coverage.recorded} of ${cellFigures.data.coverage.scheduled}`
                  : '—'
              }
              previous={
                cellFiguresPrevious.data
                  ? `${previousLabel(cellFiguresPrevious.data.open)}: ${cellFiguresPrevious.data.coverage.recorded} of ${cellFiguresPrevious.data.coverage.scheduled}`
                  : null
              }
              href="/reports/cells"
            />
            <MonthCard
              label="DCC records filed"
              value={
                dccFigures.data
                  ? `${dccFigures.data.coverage.met} of ${dccFigures.data.coverage.owed}`
                  : '—'
              }
              previous={
                dccFiguresPrevious.data
                  ? `${previousLabel(dccFiguresPrevious.data.open)}: ${dccFiguresPrevious.data.coverage.met} of ${dccFiguresPrevious.data.coverage.owed}`
                  : null
              }
              href="/reports/dcc"
            />
            <MonthCard
              label="People at a Cell"
              value={cellFigures.data ? String(cellFigures.data.unique_people) : '—'}
              previous={
                cellFiguresPrevious.data
                  ? `${previousLabel(cellFiguresPrevious.data.open)}: ${cellFiguresPrevious.data.unique_people}`
                  : null
              }
              href="/reports/cells"
            />
            <MonthCard
              label="People at DCC"
              value={dccFigures.data ? String(dccFigures.data.unique_people) : '—'}
              previous={
                dccFiguresPrevious.data
                  ? `${previousLabel(dccFiguresPrevious.data.open)}: ${dccFiguresPrevious.data.unique_people}`
                  : null
              }
              href="/reports/dcc"
            />
          </div>
        </aside>
      </div>

      {/* The reader's own requests, beside their own work (decision 0269). */}
      <SentRequests />

      {/* The three attention lists side by side from `lg`, one frame each. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <section className={FRAME} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="text-lg font-bold tracking-tight">
          Cells with meetings still to record
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Within your scope, in no particular order. This is a filter, not a ranking.
        </p>
        {scoped.isPending || scopedClosed.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : scoped.isError || scopedClosed.isError ? null : needingAttention.length === 0 ? (
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            {/* Only the first page of each view is read; say so where there is more. */}
            {scoped.data?.next_cursor == null && scopedClosed.data?.next_cursor == null ? (
              'No Cell in your scope is behind this month. Closed Cells count while the month is open.'
            ) : (
              <>
                None of the first 50 Cells in your scope is behind this month.{' '}
                <Link
                  href={`/reports/cells?${new URLSearchParams({ month, behind: '1' }).toString()}`}
                  className="focus-visible:outline-accent text-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  See every Cell behind in Reports
                </Link>
              </>
            )}
          </p>
        ) : (
          <ul className="mt-3">
            {needingAttention.map((cell) => (
              <AttentionRow key={cell.id} cell={cell} month={month} />
            ))}
          </ul>
        )}
      </section>

      {/*
        Section 19's fifth outstanding-work entry, and section 20 requires the list
        behind it (decision 0232). It sits with the other outstanding work rather than
        with the figures because it is something to do, not something to read.

        **Undated, so it is above the period heading rather than under it.** The list
        asks about now: somebody reassigned last week needs no action today, whatever a
        past month's chain looked like. Putting it below would attach it to the month
        selector and make it look like a figure for a period, which is exactly the line
        section 3 draws and section 19 says a dashboard is where it is most easily lost.
      */}
      <section className={FRAME} aria-labelledby="unplaced-heading">
        <h2 id="unplaced-heading" className="text-lg font-bold tracking-tight">
          People needing a leader
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Their own pastoral leader no longer holds an assignment. Listed by name, never by how long
          they have waited.
        </p>
        {unplaced.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : unplaced.data ? (
          <>
            {unplaced.data.data.length === 0 ? (
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                Nobody in your scope is waiting for a leader. Somebody whose own leader
                holds no assignment can fall outside your branch as they go, so a reader
                with a wider scope may see them.
              </p>
            ) : (
              <ul className="mt-3">
                {unplaced.data.data.slice(0, UNPLACED_TILE).map((person) => (
                  <li key={person.id} className={ROW}>
                    {/*
                      The action that resolves it (section 19) is the reassignment, which
                      lives on the person's place in the tree.
                    */}
                    <Link
                      href={`/people/${person.id}/network`}
                      className="focus-visible:outline-accent inline-flex min-h-6 items-center text-base font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {person.full_name}
                    </Link>
                    <p className="text-muted mt-1 text-sm">
                      Was under {person.former_leader.full_name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {/*
              **Unconditional, and two versions of it were not.** The link was first
              shown only when the tile overflowed, so with one to five people waiting
              the screen had no route into it from anywhere in the application. Moving
              it out of that condition left it inside the *non-empty* branch, so on a
              church where nobody is waiting — the ordinary case, and the state the
              demo database is in — the screen was still unreachable, under a comment
              claiming it was unconditional. It is now outside both branches.

              The coverage ledger cannot catch either version: it asks whether every
              route has a screen and never whether a screen can be reached, which is
              decision 0213's own blind spot one direction over.
            */}
            <p className="mt-4">
              <Link
                href="/people/awaiting-reassignment"
                className="focus-visible:outline-accent inline-flex min-h-6 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {unplaced.data.data.length > UNPLACED_TILE || unplaced.data.next_cursor !== null
                  ? 'See everyone needing a leader'
                  : 'Open the full list'}
              </Link>
            </p>
          </>
        ) : null}
      </section>

      {/*
        Section 19's third outstanding-work entry, which section 15 requires and
        section 10's closure flow fills (decision 0233). Undated, so it sits above the
        period heading with the other current-state work.
      */}
      <section className={FRAME} aria-labelledby="without-cell-heading">
        <h2 id="without-cell-heading" className="text-lg font-bold tracking-tight">
          People without a Cell
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          In your scope and not in a Cell. Somebody who leads one is not listed.
        </p>
        {withoutACell.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : withoutACell.data ? (
          <>
            {withoutACell.data.data.length === 0 ? (
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                Nobody in your scope is without a Cell. Somebody whose own leader holds
                no assignment can fall outside your branch, so a reader with a wider scope
                may see them.
              </p>
            ) : (
              <ul className="mt-3">
                {withoutACell.data.data.slice(0, UNPLACED_TILE).map((person) => (
                  <li key={person.id} className={ROW}>
                    <Link
                      href={`/people/${person.id}`}
                      className="focus-visible:outline-accent inline-flex min-h-6 items-center text-base font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {person.full_name}
                    </Link>
                    <p className="text-muted mt-1 text-sm">{person.member_id}</p>
                  </li>
                ))}
              </ul>
            )}
            {/* Unconditional, for the reason the section above records. */}
            <p className="mt-4">
              <Link
                href="/cells/people-without-a-cell"
                className="focus-visible:outline-accent inline-flex min-h-6 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {withoutACell.data.data.length > UNPLACED_TILE ||
                withoutACell.data.next_cursor !== null
                  ? 'See everyone without a Cell'
                  : 'Open the full list'}
              </Link>
            </p>
          </>
        ) : null}
      </section>
      </div>

      <section className="mt-10" aria-labelledby="current-heading">
        <h2 id="current-heading" className="text-lg font-bold tracking-tight">
          As things stand today
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Tile
            counts="Cells you lead"
            value={mine.data ? String(mine.data.data.length) : '—'}
            scope="Your own Cells"
            period="As of today"
            href="/cells?led_by=me"
          />
          <Tile
            counts="Cells in your scope"
            value={scoped.data ? String(scoped.data.data.length) : '—'}
            scope={scopeLabel}
            period="As of today"
            href="/cells"
          />
        </div>
      </section>
    </main>
  );
}

/** Section 17: a period still open for submission is still changing. */
function periodLabel(month: string, open: boolean | undefined): string {
  if (open === undefined) {
    return monthLabel(month);
  }

  return open ? `${monthLabel(month)} · still open` : `${monthLabel(month)} · closed`;
}

/** The day of the month and a short weekday, for the date block at the start of a row. */
function dateParts(date: string): { day: number; weekday: string } {
  const at = new Date(`${date}T00:00:00Z`);

  return {
    day: at.getUTCDate(),
    weekday: at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
  };
}

/**
 * "September · open until 7 Oct": the month an entry belongs to and the day it closes.
 *
 * A period being open is a neutral fact, so it is the solid tag (`docs/DESIGN_RECONCILIATION.md`),
 * set beside the outlined word for what is missing. The close is the 7th of the month
 * after (section 13, decision 0170).
 */
function openUntilLabel(itemMonth: string, currentMonth: string): string {
  const [year, month] = itemMonth.split('-').map(Number);
  const [nextYear, nextMonth] = currentMonth.split('-').map(Number);
  const name = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  );
  const closes = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(
    new Date(Date.UTC(nextYear, nextMonth - 1, 15)),
  );

  return `${name} · open until 7 ${closes}`;
}

/**
 * One entry in the queue: when, what, what is outstanding, and the button that
 * resolves it (section 19, "each entry carries the action that resolves it").
 *
 * **The tag is an outlined word, never a colour** (`docs/DESIGN_RECONCILIATION.md`):
 * a record awaiting entry is exactly what sections 13, 17 and 19 forbid encoding in
 * colour, so the word carries it and the red is left for the button.
 *
 * **The date block is hidden from assistive technology** because the line beneath the
 * title says the same date in full; announcing "6 Sat" and then "Saturday 6
 * September" would say it twice. Every button reads "Record" on screen and carries
 * the entry it records in its accessible name, so a list of them is not a list of
 * identical links.
 */
function QueueRow({
  item,
  currentMonth,
  today,
}: {
  item: QueueItem;
  currentMonth: string;
  today: string;
}) {
  const { day, weekday } = dateParts(item.date);
  const when = daysAgoLabel(item.date, today);

  let title: string;
  let detail: string;
  let tag: string;
  let href: string;

  if (item.kind === 'cell') {
    // The owner's row (choice of 2026-09-19): the Cell's category and meeting time, then
    // whose it is, its size and its ID. Words and no colour (sections 13 and 19).
    const category = item.category ? `${categoryLabel(item.category)} · ` : '';
    title = `${category}${dayOfWeekLabel(item.dayOfWeek)}s ${timeLabel(item.time)}`;
    const leader = item.isActor ? 'You' : (item.leaderName ?? 'Its leader');
    detail = [
      leader,
      `${item.memberCount} ${item.memberCount === 1 ? 'member' : 'members'}`,
      item.cellCode,
      ...(item.closedOn === null ? [] : [`Cell closed ${dayLabel(item.closedOn)}`]),
    ].join(' · ');
    tag = `Awaiting a record · ${when}`;
    href = `/cells/${item.cellId}/meetings/${item.date}`;
  } else {
    title = 'DCC';
    const people = `${item.total} ${item.total === 1 ? 'person' : 'people'}`;
    detail = `${people} you are responsible for · ${item.marked} marked`;
    tag = `${item.total - item.marked} awaiting · ${when}`;
    href = `/dcc/${item.eventId}`;
  }

  return (
    <li className="border-line grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
      <p aria-hidden="true" className="text-center leading-none">
        <span className="text-accent block text-2xl font-bold">{day}</span>
        <span className="text-muted mt-1 block text-xs font-bold tracking-[0.08em] uppercase">
          {weekday}
        </span>
      </p>
      <div className="min-w-0">
        <p className="text-base font-medium">{title}</p>
        <p className="text-muted text-sm">
          {dayLabel(item.date)} · {detail}
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          <Tag appearance="outline" className="whitespace-normal">
            {tag}
          </Tag>
          {item.month === currentMonth ? null : (
            <Tag className="whitespace-normal">{openUntilLabel(item.month, currentMonth)}</Tag>
          )}
        </p>
      </div>
      <Link href={href} className={cn(buttonClasses('primary'), 'col-span-2 sm:col-span-1')}>
        Record
        <span className="sr-only">
          {' '}
          {item.kind === 'cell' ? `${item.cellCode}, ${title}` : title}, {dayLabel(item.date)}
        </span>
      </Link>
    </li>
  );
}

/** "today", "yesterday" or "N days ago", counted in Manila days. */
function daysAgoLabel(date: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000,
  );

  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * One of the month's figures beside the queue: this month's, and last month's named by its
 * month. No bar and no arrow: a figure is not a score (sections 13 and 19).
 */
function MonthCard({
  label,
  value,
  previous,
  href,
}: {
  label: string;
  value: string;
  previous: string | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border-line focus-visible:outline-accent block border p-3 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="text-muted block text-sm">{label}</span>
      <span className="mt-1 block text-xl font-bold tabular-nums">{value}</span>
      {previous === null ? null : <span className="text-muted mt-1 block text-xs">{previous}</span>}
    </Link>
  );
}

/**
 * The reader's own DCC checklist across the month's Sundays (owner's choice of 2026-09-19).
 * Only their own checklist, which the checklist screen already shows mark by mark (decision
 * 0194). Words rather than ticks or colour; a dot is a Sunday not recorded yet.
 */
function DccChecklistGrid({
  events,
  checklists,
  month,
}: {
  events: readonly DccEvent[];
  checklists: readonly { data?: DccRoster }[];
  month: string;
}) {
  const people = new Map<string, { name: string; memberId: string }>();
  const marks = new Map<string, Map<string, boolean>>();

  events.forEach((event, index) => {
    for (const line of checklists[index]?.data?.data ?? []) {
      people.set(line.person_id, { name: line.full_name, memberId: line.member_id });
      if (line.record !== null) {
        const byEvent = marks.get(line.person_id) ?? new Map<string, boolean>();
        byEvent.set(event.id, line.record.present);
        marks.set(line.person_id, byEvent);
      }
    }
  });

  if (people.size === 0) {
    return null;
  }

  const rows = [...people.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <section aria-labelledby="dcc-grid-heading" className="mt-8">
      <h3 id="dcc-grid-heading" className="text-base font-bold">
        Your DCC checklist, {monthLabel(month)}
      </h3>
      <Table caption={`Your DCC checklist by Sunday, ${monthLabel(month)}`}>
        <thead>
          <tr>
            <HeaderCell>Person</HeaderCell>
            {events.map((event) => (
              <HeaderCell key={event.id}>{shortDayLabel(event.event_date)}</HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([personId, person]) => {
            const byEvent = marks.get(personId);

            return (
              <tr key={personId} className={rowClasses}>
                <td className="px-3 py-3">
                  {person.name}
                  <div className="text-muted text-xs">{person.memberId}</div>
                </td>
                {events.map((event) => {
                  const mark = byEvent?.get(event.id);

                  return (
                    <td key={event.id} className="px-3 py-3">
                      {mark === undefined ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="sr-only">Not recorded yet</span>
                        </>
                      ) : mark ? (
                        'Present'
                      ) : (
                        'Absent'
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </section>
  );
}

/** "13 Sep" for a column heading. */
function shortDayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/**
 * One tile, carrying the four things section 19 requires of every one.
 *
 * The scope and period are not decoration and are not optional props: a figure
 * without them cannot be discussed or compared, which is that section's own
 * reason. They are required by this component's type so a tile cannot be added
 * without them.
 */
function Tile({
  counts,
  value,
  unit,
  scope,
  period,
  href,
}: {
  counts: string;
  value: React.ReactNode;
  unit?: string;
  scope: string;
  period: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border-edge hover:bg-raised focus-visible:outline-accent block border p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <p className="text-muted text-xs font-bold tracking-[0.08em] uppercase">{counts}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {unit ? <p className="text-muted text-sm">{unit}</p> : null}
      <p className="text-muted mt-3 text-sm">
        {scope} · {period}
      </p>
    </Link>
  );
}

function AttentionRow({ cell, month }: { cell: CellSummary; month: string }) {
  return (
    <li className={ROW}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-medium">
          <Link
            href={`/cells/${cell.id}/meetings?month=${month}`}
            className="focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {cell.cell_id}
          </Link>
        </h3>
        <CoverageFigure
          recorded={cell.coverage.recorded}
          scheduled={cell.coverage.scheduled}
          unit="meetings recorded"
        />
      </div>
      <p className="text-muted mt-2 text-sm">
        {cell.state === 'CLOSED' && cell.closed_on
          ? `Led by ${cell.leader.full_name} · closed ${closedOnLabel(cell.closed_on)}`
          : `Led by ${cell.leader.full_name}`}
      </p>
    </li>
  );
}
