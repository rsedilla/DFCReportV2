'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import { Tag } from '@/components/ui/tag';
import {
  listCellMeetings,
  listCells,
  peopleWithoutACell,
  type CellMeetings,
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
 * **The queue is the leader's own work and nobody else's** (owner's choice of
 * 2026-09-15). It holds their own Cells' meetings and the Sundays on their own DCC
 * checklist. A downline leader's outstanding meetings are on "Cells with meetings
 * still to record" below, which is an attention list rather than somebody else's
 * to-do list.
 *
 * **Every tile carries what it counts, its value, its scope and its period**
 * (section 19). A tile reading `12` and a tile reading `11,480` are the same tile
 * for two different people, and a figure without its scope "cannot be discussed,
 * screenshotted, or compared". The figures are words and numbers; there are no
 * progress bars and no comparison with another month (owner's choice of
 * 2026-09-15), because a bar that reads as empty is coverage encoded as a
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
 * **Two of section 19's five outstanding-work lists are not fully served.** One has
 * no route yet and is named here rather than faked: the outcome of a Cell leadership
 * request the actor submitted — a question `CLAUDE.md` records as open, since section
 * 7 names no capability for such a read. The other is partly served: a **closed** Cell's
 * meetings are not reachable, because the Cells index is `ACTIVE`-only and nothing
 * supplies the identifier.
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

type QueueFilter = 'ALL' | 'CELLS' | 'SUNDAYS';

type QueueItem =
  | { kind: 'cell'; month: string; date: string; time: string; cell: CellSummary }
  | { kind: 'dcc'; month: string; date: string; eventId: string; marked: number; total: number };

/**
 * A month's Cell meetings still awaiting a record, from the leader's own Cells.
 *
 * **Only meetings whose Manila day has begun.** The listing returns the month's whole
 * schedule with no record for a date not yet reached, and section 13 refuses a record
 * for one, so offering it here would offer a button the API refuses.
 */
function cellEntries(
  cells: readonly CellSummary[],
  meetings: readonly { data?: CellMeetings }[],
  month: string,
  today: string,
): QueueItem[] {
  return cells.flatMap((cell, index) =>
    (meetings[index]?.data?.meetings ?? [])
      .filter((entry) => entry.meeting === null && entry.scheduled_date <= today)
      .map((entry) => ({
        kind: 'cell' as const,
        month,
        date: entry.scheduled_date,
        time: entry.scheduled_time,
        cell,
      })),
  );
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

  const mine = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  const scoped = useQuery({
    queryKey: ['cells', month, false],
    queryFn: ({ signal }) => listCells({ month }, signal),
  });

  // One request per Cell the actor leads, because a meeting awaiting a record is
  // a property of a meeting rather than of the Cell — the index carries the two
  // coverage figures and never which meetings are missing.
  const meetings = useQueries({
    queries: (mine.data?.data ?? []).map((cell) => ({
      queryKey: ['cell-meetings', cell.id, month],
      queryFn: ({ signal }: { signal: AbortSignal }) => listCellMeetings(cell.id, month, signal),
    })),
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

  // **Last month's outstanding work, read only in the close week**, under the same keys
  // the recording screens refresh, so saving there clears the entry here.
  const minePrevious = useQuery({
    queryKey: ['cells', previousMonth, true],
    queryFn: ({ signal }) => listCells({ month: previousMonth, ledBy: 'me' }, signal),
    enabled: inCloseWeek,
  });

  // A Cell meeting of a month that has closed is not the leader's to record any more, so
  // its meetings are not even read once the server says the month is shut.
  const cellsPrevious = minePrevious.data?.open ? minePrevious.data.data : [];

  const meetingsPrevious = useQueries({
    queries: cellsPrevious.map((cell) => ({
      queryKey: ['cell-meetings', cell.id, previousMonth],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listCellMeetings(cell.id, previousMonth, signal),
    })),
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

  // **Oldest first, and the page says so.** Date order is the one order that ranks
  // nobody, and it puts last month's entries before this month's. A Cell meeting and a
  // Sunday on the same date keep that order, because the sort is stable and the Cell
  // entries come first.
  const queue = [
    ...cellEntries(mine.data?.data ?? [], meetings, month, today),
    ...cellEntries(cellsPrevious, meetingsPrevious, previousMonth, today),
    ...dccEntries(recordableEvents, checklists, month),
    ...dccEntries(recordablePrevious, checklistsPrevious, previousMonth),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const shown = queue.filter(
    (item) =>
      filter === 'ALL' ||
      (filter === 'CELLS' && item.kind === 'cell') ||
      (filter === 'SUNDAYS' && item.kind === 'dcc'),
  );

  // **Pending until every read the queue is built from has answered**, including the
  // per-Cell meetings and per-Sunday checklists, which only start once the two indexes
  // resolve. Until then an empty queue would say "nothing awaiting" when nothing is
  // yet known.
  //
  // Last month's two indexes count only in the close week: a query that is not enabled
  // stays pending for ever, and would otherwise hold the queue on "Loading…".
  const queuePending =
    mine.isPending ||
    dccEvents.isPending ||
    meetings.some((query) => query.isPending) ||
    checklists.some((query) => query.isPending) ||
    (inCloseWeek && (minePrevious.isPending || dccEventsPrevious.isPending)) ||
    meetingsPrevious.some((query) => query.isPending) ||
    checklistsPrevious.some((query) => query.isPending);

  // A queue built from a read that failed is not a queue, so it says nothing at all
  // and leaves the failure notice above to speak.
  const previousFailed = [
    minePrevious,
    dccEventsPrevious,
    ...meetingsPrevious,
    ...checklistsPrevious,
  ].find((query) => query.isError);

  const queueFailed =
    mine.isError ||
    dccEvents.isError ||
    meetings.some((query) => query.isError) ||
    checklists.some((query) => query.isError) ||
    previousFailed !== undefined;

  const needingAttention = (scoped.data?.data ?? []).filter(
    (cell) => cell.coverage.recorded < cell.coverage.scheduled,
  );

  // **Every query on this page, not the ones it started with.** Section 19 puts
  // outstanding work above the figures precisely so a leader can trust it, and a
  // failed load that renders as an empty queue says "nothing to do" on this screen's
  // authority. The per-Cell meetings and per-Sunday checklists matter most: without
  // them the queue is empty, which is the opposite of the truth.
  const meetingsFailed = meetings.find((query) => query.isError);
  const checklistFailed = checklists.find((query) => query.isError);

  const failure = mine.isError
    ? describeFailure(mine.error)
    : meetingsFailed
      ? describeFailure(meetingsFailed.error)
      : dccEvents.isError
        ? describeFailure(dccEvents.error)
        : checklistFailed
          ? describeFailure(checklistFailed.error)
          : previousFailed
            ? describeFailure(previousFailed.error)
            : scoped.isError
            ? describeFailure(scoped.error)
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
        What needs doing comes first. The figures below it are for {monthLabel(month)}, and
        their scope is {scopeLabel}.
      </p>

      <div className="mt-8">
        <FailureNotice failure={failure} />
      </div>

      <section className="mt-8" aria-labelledby="awaiting-heading">
        <h2 id="awaiting-heading" className="text-lg font-bold tracking-tight">
          Awaiting a record
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Your own Cells&rsquo; meetings and your own DCC checklist, this month
          {inCloseWeek ? ', and last month’s while it is still open' : ''}. Oldest first.
          Nothing here is scored or ranked.
        </p>

        <div className="mt-4">
          <RadioGroup
            legend="Show"
            name="queue-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'CELLS', label: 'Cells' },
              { value: 'SUNDAYS', label: 'Sundays' },
            ]}
          />
        </div>

        {queueFailed ? null : queuePending ? (
          <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
        ) : shown.length === 0 ? (
          <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
            {filter === 'CELLS'
              ? 'No Cell meeting of yours is awaiting a record.'
              : filter === 'SUNDAYS'
                ? 'Nobody on your DCC checklist is awaiting a record.'
                : 'Nothing is awaiting a record from you.'}
          </p>
        ) : (
          <ul className="border-line mt-4 border-t">
            {shown.map((item) => (
              <QueueRow
                key={`${item.month}-${item.kind === 'cell' ? `${item.cell.id}-${item.date}` : item.eventId}`}
                item={item}
                currentMonth={month}
              />
            ))}
          </ul>
        )}

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
            Open the DCC calendar
          </Link>
        </p>
      </section>

      <section className="mt-10" aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="text-lg font-bold tracking-tight">
          Cells with meetings still to record
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Within your scope, in no particular order. This is a filter, not a ranking.
        </p>
        {scoped.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : scoped.isError ? null : needingAttention.length === 0 ? (
          <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
            Every Cell in your scope has recorded all of this month&rsquo;s meetings.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
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
      <section className="mt-10" aria-labelledby="unplaced-heading">
        <h2 id="unplaced-heading" className="text-lg font-bold tracking-tight">
          People needing a leader
        </h2>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Their own pastoral leader no longer holds an assignment. Listed by name, never by
          how long they have waited.
        </p>
        {unplaced.isPending ? (
          <p className="text-muted mt-2 text-sm">Loading&hellip;</p>
        ) : unplaced.data ? (
          <>
            {unplaced.data.data.length === 0 ? (
              <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
                Everyone in your scope has a pastoral leader who is still in place.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {unplaced.data.data.slice(0, UNPLACED_TILE).map((person) => (
                  <li key={person.id} className="border-line border p-4">
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
                  ? 'See everyone waiting for a leader'
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
      <section className="mt-10" aria-labelledby="without-cell-heading">
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
                Everyone in your scope is in a Cell.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {withoutACell.data.data.slice(0, UNPLACED_TILE).map((person) => (
                  <li key={person.id} className="border-line border p-4">
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

      {/*
        Period-based figures, kept apart from the current-state section below.
        Section 3 draws that line and section 19 says a dashboard is where it is
        most easily lost.
      */}
      <section className="mt-12" aria-labelledby="period-heading">
        <h2 id="period-heading" className="text-lg font-bold tracking-tight">
          {monthLabel(month)}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Tile
            counts="Cell attendance"
            value={cellFigures.data ? String(cellFigures.data.unique_people) : '—'}
            unit="people attended"
            scope={scopeLabel}
            period={periodLabel(month, cellFigures.data?.open)}
            href="/reports/cells"
          />
          <Tile
            counts="DCC attendance"
            value={dccFigures.data ? String(dccFigures.data.unique_people) : '—'}
            unit="people attended"
            scope={scopeLabel}
            period={periodLabel(month, dccFigures.data?.open)}
            href="/reports/dcc"
          />
          <Tile
            counts="Cell recording coverage"
            value={
              cellFigures.data ? (
                <CoverageFigure
                  recorded={cellFigures.data.coverage.recorded}
                  scheduled={cellFigures.data.coverage.scheduled}
                  unit="meetings recorded"
                />
              ) : (
                '—'
              )
            }
            scope={scopeLabel}
            period={periodLabel(month, cellFigures.data?.open)}
            href="/reports/cells"
          />
          <Tile
            counts="DCC recording coverage"
            value={
              dccFigures.data ? (
                <CoverageFigure
                  recorded={dccFigures.data.coverage.met}
                  scheduled={dccFigures.data.coverage.owed}
                  unit="records filed"
                />
              ) : (
                '—'
              )
            }
            scope={scopeLabel}
            period={periodLabel(month, dccFigures.data?.open)}
            href="/reports/dcc"
          />
        </div>
      </section>

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

/** `19:00` or `19:00:00` as `7:00 pm`, the way a meeting time is said aloud. */
function timeLabel(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const hour = ((hours + 11) % 12) + 1;

  return `${hour}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'}`;
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
function QueueRow({ item, currentMonth }: { item: QueueItem; currentMonth: string }) {
  const { day, weekday } = dateParts(item.date);
  const title = item.kind === 'cell' ? `Cell ${item.cell.cell_id}` : 'DCC Sunday';
  const href =
    item.kind === 'cell' ? `/cells/${item.cell.id}/meetings/${item.date}` : `/dcc/${item.eventId}`;
  const detail =
    item.kind === 'cell'
      ? timeLabel(item.time)
      : `${item.marked} of ${item.total} of your people marked`;
  const outstanding =
    item.kind === 'cell' ? 'Awaiting a record' : `${item.total - item.marked} awaiting`;

  return (
    <li className="border-line grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
      <p aria-hidden="true" className="text-center leading-none">
        <span className="block text-2xl font-bold">{day}</span>
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
          <Tag appearance="outline">{outstanding}</Tag>
          {/*
            Allowed to wrap: at 320px the month and its closing date are longer than the
            column, and a tag that cannot wrap pushes the page sideways.
          */}
          {item.month === currentMonth ? null : (
            <Tag className="whitespace-normal">{openUntilLabel(item.month, currentMonth)}</Tag>
          )}
        </p>
      </div>
      <Link href={href} className={cn(buttonClasses('primary'), 'col-span-2 sm:col-span-1')}>
        Record
        <span className="sr-only">
          {' '}
          {title}, {dayLabel(item.date)}
        </span>
      </Link>
    </li>
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
    <li className="border-line border p-4">
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
      <p className="text-muted mt-2 text-sm">Led by {cell.leader.full_name}</p>
    </li>
  );
}
