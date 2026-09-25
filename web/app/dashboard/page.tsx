'use client';

import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { SentRequests } from '@/components/sent-requests';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { CONTROL_BAR, FRAME } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import {
  categoryLabel,
  behindOf,
  closedOnLabel,
  listCells,
  listMeetingsAwaiting,
  type CellCategory,
  peopleWithoutACell,
  type AwaitingMeetings,
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
 * Where a signed-in leader lands (SKILL.md section 19).
 *
 * **Outstanding work comes above the numbers, and that is the whole design.**
 * Section 19 is blunt about it: "A dashboard of counts tells a leader nothing to
 * act on." So the screen opens on four lists of outstanding work, one at a time, each
 * with its count (decision 0290): what awaits a record, the Cells behind, the people
 * needing a new leader and the people not in a Cell. The figures are at the foot.
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
 * in date order, oldest first, and says so; the other lists are filtered rather than
 * sorted, in the order the API returns.
 */
export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

type QueueFilter = 'CELLS' | 'DCC';

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

  const [filter, setFilter] = useState<QueueFilter>('CELLS');
  // The reader's own work is the default (decision 0258).
  const [whose, setWhose] = useState<Whose>('mine');
  const [tab, setTab] = useState<RecordTab>('awaiting');

  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // Section 20's attention list (decision 0232). It takes no month: the list asks
  // about now, so it is deliberately not keyed on the period the figures below use.
  //
  // The whole list, fifty at a time, with Show more in place of a link to another
  // screen (decision 0290).
  const unplacedPages = useInfiniteQuery({
    queryKey: ['awaiting-reassignment', 'dashboard'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      awaitingReassignment({ limit: 50, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const unplaced = {
    isPending: unplacedPages.isPending,
    isError: unplacedPages.isError,
    error: unplacedPages.error,
    data: unplacedPages.data?.pages.flatMap((page) => page.data),
  };

  // Section 15's other attention list (decision 0233), and undated for the same
  // reason: it asks who is not in a Cell now.
  const withoutACellPages = useInfiniteQuery({
    queryKey: ['people-without-a-cell', 'dashboard'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      peopleWithoutACell({ limit: 50, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const withoutACell = {
    isPending: withoutACellPages.isPending,
    isError: withoutACellPages.isError,
    error: withoutACellPages.error,
    data: withoutACellPages.data?.pages.flatMap((page) => page.data),
  };

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

  const shown = queue.filter((item) => (filter === 'CELLS') === (item.kind === 'cell'));

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
  // empty, which is the opposite of the truth.
  const checklistFailed = checklists.find((query) => query.isError);

  const failure = awaiting.isError
    ? describeFailure(awaiting.error)
    : dccEvents.isError
      ? describeFailure(dccEvents.error)
      : checklistFailed
        ? describeFailure(checklistFailed.error)
        : previousFailed
          ? describeFailure(previousFailed.error)
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

  // The tab counts. A list read fifty at a time says "50+" rather than a figure it has
  // not read; section 22 returns no total to ask for instead.
  const behindMore = scoped.data?.next_cursor != null || scopedClosed.data?.next_cursor != null;
  const tabs: readonly { key: RecordTab; label: string; count: string | null }[] = [
    {
      key: 'awaiting',
      label: 'Awaiting a record',
      count: queuePending || queueFailed ? null : String(queue.length),
    },
    {
      key: 'behind',
      label: 'Cells behind',
      count:
        scoped.data && scopedClosed.data
          ? `${needingAttention.length}${behindMore ? '+' : ''}`
          : null,
    },
    {
      key: 'leader',
      label: 'Needs a new leader',
      count: unplaced.data ? `${unplaced.data.length}${unplacedPages.hasNextPage ? '+' : ''}` : null,
    },
    {
      key: 'nocell',
      label: 'Not in a Cell',
      count: withoutACell.data
        ? `${withoutACell.data.length}${withoutACellPages.hasNextPage ? '+' : ''}`
        : null,
    },
  ];

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="text-muted text-xs font-bold tracking-[0.08em] uppercase">
        Record · {monthLabel(month)}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {me.data?.first_name ? `Welcome, ${me.data.first_name}` : 'Dashboard'}
        </h1>
        <p className="text-muted text-sm">
          What needs doing first, and this month&rsquo;s figures at the foot.
        </p>
      </div>

      <div className="mt-6">
        <FailureNotice failure={failure} />
      </div>

      <TabBar
        label="Outstanding work"
        className="mt-6 grid-cols-2 lg:grid-cols-4"
        tabs={tabs}
        current={tab}
        onChoose={setTab}
      />

      <div className="mt-6">
        {tab === 'awaiting' ? (
          <section aria-labelledby="awaiting-heading" className={`min-w-0 ${FRAME}`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="awaiting-heading" className="text-lg font-bold tracking-tight">
                Awaiting a record
              </h2>
              <p className="text-muted text-sm">
                Still to record this month
                {inCloseWeek ? ', and last month while it is open' : ''}, oldest first.
              </p>
            </div>

            <TabBar
              label="Awaiting a record"
              className="mt-4 grid-cols-2 sm:max-w-xl"
              tabs={[
                {
                  key: 'CELLS',
                  label: 'Cell Group',
                  count:
                    queuePending || queueFailed
                      ? null
                      : String(queue.filter((item) => item.kind === 'cell').length),
                },
                {
                  key: 'DCC',
                  label: 'Doulos Cell Celebration',
                  count:
                    queuePending || queueFailed
                      ? null
                      : String(queue.filter((item) => item.kind === 'dcc').length),
                },
              ]}
              current={filter}
              onChoose={setFilter}
            />

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
            </div>

            {queueFailed ? null : queuePending ? (
              <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
            ) : shown.length === 0 ? (
              <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
                {filter === 'CELLS'
                  ? whose === 'mine'
                    ? 'No Cell meeting of yours is awaiting a record.'
                    : 'No Cell meeting in your branch is awaiting a record.'
                  : whose === 'mine'
                    ? 'Nobody on your DCC checklist is awaiting a record.'
                    : 'No DCC record is owed in your branch.'}
              </p>
            ) : (
              <>
                <Table caption="Awaiting a record" className="mt-4 hidden lg:block">
                  <thead>
                    <tr>
                      <HeaderCell>Date</HeaderCell>
                      <HeaderCell>What</HeaderCell>
                      <HeaderCell>Leader</HeaderCell>
                      <HeaderCell>Waiting</HeaderCell>
                      <HeaderCell>
                        <span className="sr-only">Record</span>
                      </HeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((item) => (
                      <QueueTableRow
                        key={queueKey(item)}
                        item={item}
                        currentMonth={month}
                        today={today}
                      />
                    ))}
                  </tbody>
                </Table>
                <ul className="mt-4 flex flex-col gap-3 lg:hidden">
                  {shown.map((item) => (
                    <QueueCard key={queueKey(item)} item={item} currentMonth={month} today={today} />
                  ))}
                </ul>
              </>
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
        ) : null}

        {tab === 'behind' ? (
          <section className={FRAME} aria-labelledby="attention-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="attention-heading" className="text-lg font-bold tracking-tight">
                Cells behind
              </h2>
              <p className="text-muted text-sm">In your scope, in no particular order.</p>
            </div>
            {scoped.isPending || scopedClosed.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : scoped.isError || scopedClosed.isError ? null : (
              <>
                <ListTable
                  caption="Cells behind"
                  columns={['Cell', 'Leader', 'Meetings recorded', 'Status']}
                  empty={
                    behindMore
                      ? 'None of the first 50 Cells in your scope is behind this month.'
                      : 'No Cell in your scope is behind this month.'
                  }
                  rows={needingAttention.map((cell) => ({
                    key: cell.id,
                    cells: [
                      <Link
                        key="cell"
                        href={`/cells/${cell.id}/meetings?month=${month}`}
                        className={NAME_LINK}
                      >
                        {cell.cell_id}
                      </Link>,
                      cell.leader.full_name,
                      <span key="recorded" className="tabular-nums">
                        {cell.coverage.recorded} of {cell.coverage.scheduled}
                      </span>,
                      cell.state === 'CLOSED' && cell.closed_on
                        ? `Closed ${closedOnLabel(cell.closed_on)}`
                        : 'Open',
                    ],
                  }))}
                />
                {/* Only the first page of each view is read; say so where there is more. */}
                {behindMore ? (
                  <p className="mt-4">
                    <Link
                      href={`/reports/filed?${new URLSearchParams({ month, behind: '1' }).toString()}`}
                      className="focus-visible:outline-accent text-accent inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      See every Cell behind in Reports
                    </Link>
                  </p>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {/*
          Section 19's fifth outstanding-work entry, and section 20 requires the list
          behind it (decision 0232). Undated: it asks about now.
        */}
        {tab === 'leader' ? (
          <section className={FRAME} aria-labelledby="unplaced-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="unplaced-heading" className="text-lg font-bold tracking-tight">
                Needs a new leader
              </h2>
              <p className="text-muted text-sm">
                In your scope, and their pastoral leader holds no assignment.
              </p>
            </div>
            {unplaced.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : unplaced.data ? (
              <>
                {/* The action that resolves an entry is the reassignment (section 19). */}
                <ListTable
                  caption="Needs a new leader"
                  columns={['Name', 'Member ID', 'Was under']}
                  empty="Nobody in your scope is waiting for a new leader."
                  rows={unplaced.data.map((person) => ({
                    key: person.id,
                    cells: [
                      <Link key="name" href={`/people/${person.id}/network`} className={NAME_LINK}>
                        {person.full_name}
                      </Link>,
                      person.member_id,
                      person.former_leader.full_name,
                    ],
                  }))}
                />
                <ShowMore pages={unplacedPages} />
              </>
            ) : null}
          </section>
        ) : null}

        {/*
          Section 19's third outstanding-work entry, which section 15 requires and
          section 10's closure flow fills (decision 0233). Undated: it asks about now.
        */}
        {tab === 'nocell' ? (
          <section className={FRAME} aria-labelledby="without-cell-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="without-cell-heading" className="text-lg font-bold tracking-tight">
                Not in a Cell
              </h2>
              <p className="text-muted text-sm">In your scope, and not in a Cell or leading one.</p>
            </div>
            {withoutACell.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : withoutACell.data ? (
              <>
                <ListTable
                  caption="Not in a Cell"
                  columns={['Name', 'Member ID']}
                  empty="Everybody in your scope is in a Cell."
                  rows={withoutACell.data.map((person) => ({
                    key: person.id,
                    cells: [
                      <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                        {person.full_name}
                      </Link>,
                      person.member_id,
                    ],
                  }))}
                />
                <ShowMore pages={withoutACellPages} />
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* The reader's own requests, below their own work (decision 0269). */}
      <SentRequests />

      {/*
        This month so far, as a row at the foot (decision 0290). Each figure carries last
        month's, named by its month; no bars, because coverage is two figures and never a
        fraction (decision 0224).
      */}
      <aside aria-labelledby="period-heading" className="border-line mt-10 border-t pt-6">
        <h2 id="period-heading" className="text-lg font-bold tracking-tight">
          {monthLabel(month).split(' ')[0]} so far
        </h2>
        <p className="text-muted mt-1 text-sm">
          {periodLabel(month, cellFigures.data?.open)} · {scopeLabel}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

/** Which of Record's four lists is open (decision 0290). */
type RecordTab = 'awaiting' | 'behind' | 'leader' | 'nocell';

/** A name that opens its record: 24px tall at least, which 2.5.8 measures. */
const NAME_LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

function queueKey(item: QueueItem): string {
  return `${item.month}-${item.kind}-${item.kind === 'cell' ? `${item.cellId}-${item.date}` : item.eventId}`;
}

/**
 * Equal-width buttons that choose which list is shown, each with its count in a box
 * (owner's choices of 2026-09-25). Buttons pressed and unpressed rather than ARIA tabs:
 * the lists are sections of one page, and a screen reader meets each by its heading.
 * The count box is the same on every button whatever the number, because colour never
 * marks a figure as behind (sections 13 and 19).
 */
function TabBar<Key extends string>({
  label,
  className,
  tabs,
  current,
  onChoose,
}: {
  label: string;
  className: string;
  tabs: readonly { key: Key; label: string; count: string | null }[];
  current: Key;
  onChoose: (key: Key) => void;
}) {
  return (
    <div role="group" aria-label={label} className={cn('border-line grid border-b', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          onClick={() => onChoose(tab.key)}
          className={cn(
            'focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 border border-b-0 px-3 py-2 text-center sm:px-4',
            'text-xs font-bold tracking-[0.08em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2',
            tab.key === current
              ? 'bg-accent text-surface border-accent'
              : 'border-line text-ink hover:bg-raised',
          )}
        >
          {tab.label}
          {tab.count === null ? null : (
            <span className="inline-block min-w-5 border border-current px-1 text-center leading-4 tabular-nums">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A list as a table from `lg` and as cards below it, the shape the Cells page uses. An
 * empty list keeps its table and says so in one row (owner's choice of 2026-09-25).
 */
function ListTable({
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
function ShowMore({
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

/** What an awaiting entry is, who records it and how long it has waited, in words. */
function describeQueueItem(item: QueueItem, currentMonth: string, today: string) {
  const isCell = item.kind === 'cell';
  const what = isCell
    ? `${item.category ? `${categoryLabel(item.category)} · ` : ''}${item.cellCode}${
        item.closedOn === null ? '' : ` · Cell closed ${dayLabel(item.closedOn)}`
      }`
    : `DCC · ${item.marked} of ${item.total} marked`;
  const leader = isCell ? (item.isActor ? 'You' : (item.leaderName ?? 'Its leader')) : 'You';
  const waiting = daysAgoLabel(item.date, today);
  const open = item.month === currentMonth ? null : openUntilLabel(item.month, currentMonth);
  const href = isCell ? `/cells/${item.cellId}/meetings/${item.date}` : `/dcc/${item.eventId}`;

  return { what, leader, waiting, open, href };
}

function QueueTableRow({
  item,
  currentMonth,
  today,
}: {
  item: QueueItem;
  currentMonth: string;
  today: string;
}) {
  const { what, leader, waiting, open, href } = describeQueueItem(item, currentMonth, today);

  return (
    <tr className={rowClasses}>
      <td className="px-3 py-3 align-top whitespace-nowrap">{dayLabel(item.date)}</td>
      <td className="px-3 py-3 align-top">{what}</td>
      <td className="px-3 py-3 align-top">{leader}</td>
      <td className="px-3 py-3 align-top">
        {waiting}
        {open === null ? null : <span className="text-muted block text-xs">{open}</span>}
      </td>
      <td className="px-3 py-3 text-right align-top">
        <Link href={href} className={buttonClasses('primary')}>
          Record
          <span className="sr-only">
            {' '}
            {what}, {dayLabel(item.date)}
          </span>
        </Link>
      </td>
    </tr>
  );
}

/** The same entry as a card below `lg`, with Record always in view. */
function QueueCard({
  item,
  currentMonth,
  today,
}: {
  item: QueueItem;
  currentMonth: string;
  today: string;
}) {
  const { what, leader, waiting, open, href } = describeQueueItem(item, currentMonth, today);

  return (
    <li className="border-line flex flex-wrap items-center justify-between gap-3 border p-4">
      <div className="min-w-0">
        <p className="text-base font-medium">{dayLabel(item.date)}</p>
        <p className="text-sm">{what}</p>
        <p className="text-muted text-sm">
          {leader} · {waiting}
          {open === null ? '' : ` · ${open}`}
        </p>
      </div>
      <Link href={href} className={buttonClasses('primary')}>
        Record
        <span className="sr-only">
          {' '}
          {what}, {dayLabel(item.date)}
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

