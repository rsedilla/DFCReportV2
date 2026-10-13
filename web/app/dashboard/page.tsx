'use client';

import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { LeaderRecordingStatusPanel, RecordingStatusPanel } from '@/components/recording-status';
import { SentRequests } from '@/components/sent-requests';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { CONTROL_BAR, TAB_PANE, TAB_ROW, tabClasses } from '@/components/ui/frame';
import { RadioGroup } from '@/components/ui/radio-group';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { ViewSwitch } from '@/components/ui/view-switch';
import {
  cellShortName,
  behindOf,
  closedOnLabel,
  listEveryCell,
  listMeetingsAwaiting,
  type CellCategory,
  peopleWithoutACell,
  type AwaitingMeetings,
} from '@/lib/cells';
import {
  getDccOwed,
  getLeaderChecklist,
  getPendingDccLeaders,
  getWholeDccRoster,
  listDccEvents,
  type DccEvent,
  type DccOwed,
  type DccRosterLine,
  type PendingDccLeader,
} from '@/lib/dcc';
import { getMe, holdsWholeChurch } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import { awaitingReassignment, MINIMUM_SEARCH_LENGTH } from '@/lib/people';
import { getCellMonthlyReport, getDccMonthlyReport } from '@/lib/reports';
import {
  dayLabel,
  monthLabel,
  reportingMonthOf,
  shiftMonth,
  todayInManila,
} from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { deadlineLabel, mayStillBeOpen, monthOpenUntilLabel } from '@/lib/weekly-deadline';
import { cn } from '@/lib/utils';

/**
 * Where a signed-in leader lands (SKILL.md section 19).
 *
 * **Outstanding work comes above the numbers, and that is the whole design.**
 * Section 19 is blunt about it: "A dashboard of counts tells a leader nothing to
 * act on." So the screen opens on five lists of outstanding work, one at a time, each
 * with its count (decisions 0290 and 0336): what awaits a record, the Cells behind, the
 * leaders behind on DCC, the people needing a new leader and the people not in a Cell. The
 * figures are at the foot.
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
      leaderId: string;
      leaderName: string | null;
      leaderLastName: string | null;
      leaderFirstName: string | null;
      leaderMemberId: string | null;
      isActor: boolean;
      mayRecord: boolean;
      dueAt?: string | null;
      closesAt?: string;
    }
  | {
      kind: 'dcc';
      month: string;
      date: string;
      eventId: string;
      marked: number;
      total: number;
      dueAt?: string | null;
      closesAt?: string;
    };

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
    leaderId: entry.leader.id,
    leaderName: entry.leader.full_name,
    leaderLastName: entry.leader.last_name,
    leaderFirstName: entry.leader.first_name,
    leaderMemberId: entry.leader.member_id,
    isActor: entry.leader.is_actor,
    mayRecord: entry.may_record,
    dueAt: entry.due_at,
    closesAt: entry.closes_at,
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
  checklists: readonly { data?: DccRosterLine[] }[],
  month: string,
): QueueItem[] {
  return events.flatMap((event, index) => {
    const lines = checklists[index]?.data;

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
            dueAt: event.due_at,
            closesAt: event.closes_at,
          },
        ];
  });
}

function Dashboard() {
  const month = reportingMonthOf();
  const today = todayInManila();
  const previousMonth = shiftMonth(month, -1);

  // **While last month may still be open**: until its last week closes, between the 15th
  // and the 21st (section 13, decision 0335), or the 7th for a month before the weekly
  // rule. Section 13 has every leader see their own outstanding work "always" (owner's
  // choice of 2026-09-15). The browser's clock only decides whether to ask; the server's
  // `open` flag and each row's own week decide what is shown.
  const inCloseWeek = mayStillBeOpen(previousMonth, today);

  // Which list, which kind and whose are in the address, so Back from a meeting or a
  // checklist returns to the list it was opened from. The defaults drop out of it.
  const search = useSearchParams();
  const go = useScreenAddress();
  const tab: RecordTab = RECORD_TABS.find((key) => key === search.get('list')) ?? 'awaiting';
  const filter: QueueFilter = search.get('kind') === 'dcc' ? 'DCC' : 'CELLS';
  // The reader's own work is the default (decision 0258). The radio follows the click at
  // once and the address a moment later, as on the Cells list; the address still decides,
  // so Back moves it.
  const whoseInAddress: Whose = search.get('whose') === 'branch' ? 'branch' : 'mine';
  const [whose, setWhose] = useState(whoseInAddress);
  const [lastWhose, setLastWhose] = useState(whoseInAddress);
  if (lastWhose !== whoseInAddress) {
    setLastWhose(whoseInAddress);
    setWhose(whoseInAddress);
  }
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });

  // **A Recording-only account sees Awaiting a record and nothing else** (section 19,
  // decision 0323): no other list, no month figures, and Leaders Under Me only while the
  // server says a leader holding an account sits directly beneath it.
  const recordingOnly = me.data?.screens === 'RECORDING';
  // **The Senior Pastors' Record has two tabs, Recording status first** (decision 0325):
  // their own Awaiting a record with no Leaders Under Me, and none of the other lists or
  // the month figures.
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const spTab: 'status' | 'awaiting' = search.get('list') === 'awaiting' ? 'awaiting' : 'status';
  const fullRecord = me.data !== undefined && !recordingOnly && !seniorPastor;
  // **Recording Status, last, for a reader who reads reports over their own branch**
  // (decision 0334): a Full view leader, whose Leader default gives `reports.view_subtree` that scope.
  const leaderStatus =
    fullRecord &&
    (me.data?.capabilities ?? []).some(
      (grant) => grant.capability === 'reports.view_subtree' && grant.scope_type === 'OWN_SUBTREE',
    );
  // **An Admin's Record carries the church-wide one, last** (decision 0335): the reader who
  // amends a closed week sees what went late. Keyed on the capability, never on the role.
  const churchStatus = fullRecord && holdsWholeChurch(me.data, 'reports.view_subtree');
  const listTab: RecordTab =
    recordingOnly || seniorPastor || (tab === 'status' && !leaderStatus && !churchStatus)
      ? 'awaiting'
      : tab;
  const mayOversee = me.data?.people_i_oversee !== false;
  const shownWhose: Whose = mayOversee ? whose : 'mine';
  const branchView = shownWhose === 'branch';
  // The branch is asked for only once the account says the reader may have one.
  const whoseKnown = !branchView || me.data !== undefined;

  // The leader whose DCC checklist is open under the branch view (decision 0301). Cleared
  // when the list or the view changes, so a list switched away from does not come back open.
  const [chosenLeader, setChosenLeader] = useState<ChosenLeader | null>(null);
  // The leader whose checklist is open under Pending DCC Reports (decision 0336).
  const [pendingChosen, setPendingChosen] = useState<ChosenLeader | null>(null);
  const [chosenFor, setChosenFor] = useState(`${filter}|${whose}`);
  if (chosenFor !== `${filter}|${whose}`) {
    setChosenFor(`${filter}|${whose}`);
    setChosenLeader(null);
  }

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
    enabled: fullRecord,
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
    enabled: fullRecord,
  });
  const withoutACell = {
    isPending: withoutACellPages.isPending,
    isError: withoutACellPages.isError,
    error: withoutACellPages.error,
    data: withoutACellPages.data?.pages.flatMap((page) => page.data),
  };

  // **Pending DCC Reports** (decision 0336): the leaders in the reader's whole scope whose 12
  // are unrecorded for a Sunday whose week is open, fifty at a time, searched and filtered on
  // the server. Undated: it asks about now.
  const [pendingFilter, setPendingFilter] = useState<{
    q: string;
    network: 'MENS' | 'WOMENS' | null;
  }>({ q: '', network: null });
  const pendingDccPages = useInfiniteQuery({
    queryKey: ['dcc-pending-leaders', pendingFilter.q, pendingFilter.network],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      getPendingDccLeaders(
        {
          cursor: pageParam,
          q: pendingFilter.q === '' ? undefined : pendingFilter.q,
          network: pendingFilter.network,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: fullRecord,
  });
  const pendingDcc = pendingDccPages.data?.pages.flatMap((page) => page.data);

  // **One request per open month**, replacing two index calls and one per Cell. The
  // key is the month and whose view is shown (decision 0258).
  //
  // **The recording screen clears it by the bare `meetings-awaiting` prefix**, which
  // it had to be given: the queue used to be keyed `['cell-meetings', id, month]` and
  // was cleared by the invalidation that screen already made, and this key is not
  // under that prefix. Said the other way round, moving the queue onto its own route
  // moved it out of the reach of the only thing that refreshed it.
  const awaiting = useQuery({
    queryKey: ['meetings-awaiting', month, shownWhose],
    queryFn: ({ signal }) => listMeetingsAwaiting(month, signal, shownWhose),
    enabled: whoseKnown,
  });

  // **The whole branch, every page** (decision 0340), so Pending CG Reports names every Cell
  // behind: Filed Reports, which used to hold the rest, is withdrawn.
  const scoped = useQuery({
    queryKey: ['cells-every', month],
    queryFn: ({ signal }) => listEveryCell({ month }, signal),
    enabled: fullRecord,
  });

  // **Section 15's attention list includes a closed Cell while its month is open**, and
  // the running view cannot carry one. The closed view (decision 0266) can.
  const scopedClosed = useQuery({
    queryKey: ['cells-every', month, 'CLOSED'],
    queryFn: ({ signal }) => listEveryCell({ month, state: 'CLOSED' }, signal),
    enabled: fullRecord,
  });

  // **Last month's Cells behind while that month is open** (section 15, decision 0315),
  // read only in the close week. A month that has shut answers `open: false`.
  const scopedPrevious = useQuery({
    queryKey: ['cells-every', previousMonth],
    queryFn: ({ signal }) => listEveryCell({ month: previousMonth }, signal),
    enabled: fullRecord && inCloseWeek,
  });
  const scopedClosedPrevious = useQuery({
    queryKey: ['cells-every', previousMonth, 'CLOSED'],
    queryFn: ({ signal }) => listEveryCell({ month: previousMonth, state: 'CLOSED' }, signal),
    enabled: fullRecord && inCloseWeek,
  });

  // **The Sundays on the leader's own checklist.** The events index says which of
  // this month's Sundays take a record now; the checklist for each says whether
  // anybody on it is still unmarked. A Sunday that has not happened, was removed,
  // or whose month has closed takes no record and so is never in the queue.
  //
  // The checklist is read under the key the DCC screen uses, so saving there
  // refreshes this entry rather than leaving it saying something is awaiting.
  //
  // The Sundays only: the queue uses `recordable` and never the coverage figure, which
  // reads the reader's whole branch. Its own key, because the DCC screen shows coverage
  // (checklist row perf-record-load).
  const dccEvents = useQuery({
    queryKey: ['dcc-events', month, 'sundays-only'],
    queryFn: ({ signal }) => listDccEvents(month, signal, { coverage: false }),
  });

  const recordableEvents = (dccEvents.data?.data ?? []).filter((event) => event.recordable);

  // **The whole checklist, every page of it**, as the DCC calendar reads it. The first
  // page alone is fifty people, so a longer checklist counted as done while people past
  // the fiftieth were unmarked. The calendar's key, so the two share one read.
  const checklists = useQueries({
    queries: recordableEvents.map((event) => ({
      queryKey: ['dcc-roster-whole', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getWholeDccRoster(event.id, signal),
    })),
  });

  // **Last month's outstanding work, read only in the close week.** A month that has
  // shut answers `open: false` and an empty list rather than refusing, so nothing here
  // has to decide whether it is still the leader's to record.
  const awaitingPrevious = useQuery({
    queryKey: ['meetings-awaiting', previousMonth, shownWhose],
    queryFn: ({ signal }) => listMeetingsAwaiting(previousMonth, signal, shownWhose),
    enabled: inCloseWeek && whoseKnown,
  });

  const dccEventsPrevious = useQuery({
    queryKey: ['dcc-events', previousMonth, 'sundays-only'],
    queryFn: ({ signal }) => listDccEvents(previousMonth, signal, { coverage: false }),
    enabled: inCloseWeek,
  });

  const recordablePrevious = (dccEventsPrevious.data?.data ?? []).filter(
    (event) => event.recordable,
  );

  const checklistsPrevious = useQueries({
    queries: recordablePrevious.map((event) => ({
      queryKey: ['dcc-roster-whole', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getWholeDccRoster(event.id, signal),
    })),
  });

  // **The branch's DCC records still owed** (decision 0301): one request per open month,
  // read only while Leaders Under Me is chosen. A closed month owes nothing and answers
  // empty, so last month is asked for in the close week alone.
  const owedNow = useQuery({
    queryKey: ['dcc-owed', month],
    queryFn: ({ signal }) => getDccOwed(month, signal),
    enabled: branchView && whoseKnown,
  });
  const owedPrevious = useQuery({
    queryKey: ['dcc-owed', previousMonth],
    queryFn: ({ signal }) => getDccOwed(previousMonth, signal),
    enabled: branchView && whoseKnown && inCloseWeek,
  });
  const owedRows: OwedRow[] = [
    ...(owedPrevious.data?.data ?? []).map((row) => ({ ...row, month: previousMonth })),
    ...(owedNow.data?.data ?? []).map((row) => ({ ...row, month })),
  ];
  const owedPending =
    branchView && (owedNow.isPending || (inCloseWeek && owedPrevious.isPending));
  const owedFailure = branchView
    ? [owedNow, owedPrevious].find((query) => query.isError)
    : undefined;

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

  // The month figures wait for the lists above them, which are the work a leader acts on,
  // so the lists do not queue behind four reports (checklist row perf-record-load). A list
  // that failed has answered, so it holds nothing back.
  const listsAnswered =
    !queuePending &&
    !scoped.isPending &&
    !scopedClosed.isPending &&
    !unplacedPages.isPending &&
    !withoutACellPages.isPending;

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
    enabled: fullRecord && listsAnswered,
  });

  const dccFigures = useQuery({
    queryKey: ['dcc-report', month, reportScope],
    queryFn: ({ signal }) => getDccMonthlyReport(month, reportScope, signal),
    enabled: fullRecord && listsAnswered,
  });

  // Last month's figures, shown under this month's on each card and named by month.
  const cellFiguresPrevious = useQuery({
    queryKey: ['cell-report', previousMonth, reportScope],
    queryFn: ({ signal }) => getCellMonthlyReport(previousMonth, reportScope, signal),
    enabled: fullRecord && listsAnswered,
  });

  // Section 19: an open period says so, and last month is open until its last week closes.
  const previousName = monthLabel(previousMonth).split(' ')[0];
  const previousLabel = (open: boolean | undefined) =>
    `${previousName}${open ? ' (still open)' : ''}`;

  const dccFiguresPrevious = useQuery({
    queryKey: ['dcc-report', previousMonth, reportScope],
    queryFn: ({ signal }) => getDccMonthlyReport(previousMonth, reportScope, signal),
    enabled: fullRecord && listsAnswered,
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
    ...[
      ...(scoped.data?.data ?? []),
      ...(scopedClosed.data?.open ? scopedClosed.data.data : []),
    ].map((cell) => ({ cell, month })),
    // Last month's only while its window is open, each view by its own flag.
    ...(inCloseWeek
      ? [
          ...(scopedPrevious.data?.open ? scopedPrevious.data.data : []),
          ...(scopedClosedPrevious.data?.open ? scopedClosedPrevious.data.data : []),
        ].map((cell) => ({ cell, month: previousMonth }))
      : []),
  ].filter(({ cell }) => behindOf(cell.coverage) > 0);
  // Last month was read and is still open, so the list speaks for it too.
  const lastMonthRead =
    inCloseWeek && (scopedPrevious.data?.open === true || scopedClosedPrevious.data?.open === true);
  const behindPending =
    scoped.isPending ||
    scopedClosed.isPending ||
    (inCloseWeek && (scopedPrevious.isPending || scopedClosedPrevious.isPending));
  const behindFailed = [
    scoped,
    scopedClosed,
    ...(inCloseWeek ? [scopedPrevious, scopedClosedPrevious] : []),
  ].find((query) => query.isError);

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
          : owedFailure
            ? describeFailure(owedFailure.error)
          : behindFailed
              ? describeFailure(behindFailed.error)
              : unplaced.isError
                ? describeFailure(unplaced.error)
              : pendingDccPages.isError
                ? describeFailure(pendingDccPages.error)
                : cellFigures.isError
                  ? describeFailure(cellFigures.error)
                  : dccFigures.isError
                    ? describeFailure(dccFigures.error)
                    : withoutACell.isError
                      ? describeFailure(withoutACell.error)
                      : me.isError
                        ? describeFailure(me.error)
                        : null;

  // The DCC count follows Whose, as the Cell count does: the branch's owed records, or the
  // reader's own Sundays with somebody unmarked.
  const dccCount = branchView
    ? owedRows.length
    : queue.filter((item) => item.kind === 'dcc').length;
  const tabs: readonly { key: RecordTab; label: string; count: string | null }[] = [
    {
      key: 'awaiting',
      label: 'Update Record',
      count:
        queuePending || queueFailed || owedPending || owedFailure
          ? null
          : String(queue.filter((item) => item.kind === 'cell').length + dccCount),
    },
    {
      key: 'behind',
      label: 'Pending CG Reports',
      count:
        behindPending || behindFailed
          ? null
          : String(needingAttention.length),
    },
    {
      key: 'dcc',
      label: 'Pending DCC Reports',
      count: pendingDcc ? `${pendingDcc.length}${pendingDccPages.hasNextPage ? '+' : ''}` : null,
    },
    {
      key: 'leader',
      label: 'Awaiting Leader Assignment',
      count: unplaced.data ? `${unplaced.data.length}${unplacedPages.hasNextPage ? '+' : ''}` : null,
    },
    {
      key: 'nocell',
      label: 'Awaiting CG Assignment',
      count: withoutACell.data
        ? `${withoutACell.data.length}${withoutACellPages.hasNextPage ? '+' : ''}`
        : null,
    },
    ...(leaderStatus || churchStatus
      ? [{ key: 'status' as const, label: 'Recording Status', count: null }]
      : []),
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
          {me.data === undefined
            ? null
            : recordingOnly
              ? 'What still needs a record.'
              : seniorPastor
                ? 'Whether the church has recorded, and your own work.'
                : 'What needs doing first, and this month’s figures at the foot.'}
        </p>
      </div>

      <div className="mt-6">
        <FailureNotice failure={failure} />
      </div>

      {/* A Recording-only account has one list, so no tabs (decision 0323). None until the
          server names the account's screens, so no account sees another's tabs flash. */}
      {me.data === undefined || recordingOnly ? null : seniorPastor ? (
        <TabBar
          label="Record"
          className={cn('mt-6', TAB_ROW)}
          tabs={[
            { key: 'status', label: 'Recording Status', count: null },
            { key: 'awaiting', label: 'Update Record', count: tabs[0].count },
          ]}
          current={spTab}
          onChoose={(next) => go({ list: next === 'status' ? null : 'awaiting' })}
        />
      ) : (
        <TabBar
          label="Outstanding work"
          className={cn('mt-6', TAB_ROW)}
          tabs={tabs}
          current={tab}
          onChoose={(next) => go({ list: next === 'awaiting' ? null : next })}
        />
      )}

      {/* The chosen list's pane; the month's figures below it are the whole page's. */}
      <div className={recordingOnly ? 'mt-6' : TAB_PANE}>
        {seniorPastor && spTab === 'status' ? <RecordingStatusPanel /> : null}
        {listTab === 'status' && me.data ? (
          <div className={LIST}>
            {churchStatus ? (
              <RecordingStatusPanel />
            ) : (
              <LeaderRecordingStatusPanel leaderId={me.data.person_id} />
            )}
          </div>
        ) : null}
        {listTab === 'awaiting' && !(seniorPastor && spTab === 'status') ? (
          <section aria-labelledby="awaiting-heading" className={LIST}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="awaiting-heading" className="text-lg font-bold tracking-tight">
                Update Record
              </h2>
              <p className="text-muted text-sm">
                Still to record this month
                {inCloseWeek ? ', and last month while it is open' : ''}, oldest first.
              </p>
            </div>

            <ViewSwitch
              label="Update Record"
              options={[
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
                  label: 'DCC',
                  count:
                    queuePending || queueFailed || owedPending || owedFailure
                      ? null
                      : String(dccCount),
                },
              ]}
              value={filter}
              onChange={(next) => go({ kind: next === 'DCC' ? 'dcc' : null })}
              even="content"
            />

            {mayOversee ? (
            <div className={`mt-4 ${CONTROL_BAR}`}>
              <RadioGroup
                legend="Whose"
                name="queue-whose"
                even
                value={shownWhose}
                onChange={(next) => {
                  setWhose(next);
                  go({ whose: next === 'branch' ? 'branch' : null });
                }}
                // Named by decision 0333; the second choice names what each half holds.
                options={[
                  { value: 'branch', label: 'Leaders Under Me' },
                  { value: 'mine', label: filter === 'DCC' ? 'Own 12' : 'Own Cell' },
                ]}
              />
            </div>
            ) : null}

            {/*
              The close of last month's open work, once, above the branch view (decision
              0311). Each row still carries its own month label.
            */}
            {branchView &&
            (filter === 'CELLS'
              ? shown.some((item) => item.month === previousMonth)
              : owedRows.some((row) => row.month === previousMonth)) ? (
              <p className="mt-4 text-sm">
                {monthOpenUntilLabel(previousMonth).endsWith('12NN')
                  ? `${monthLabel(previousMonth).split(' ')[0]} is ${monthOpenUntilLabel(previousMonth).replace(/^Open/, 'open')}.`
                  : `${monthLabel(previousMonth).split(' ')[0]} is open until the end of ${dayLabel(`${month.slice(0, 8)}07`)}.`}
              </p>
            ) : null}

            {filter === 'DCC' && branchView ? (
              owedFailure ? null : owedPending ? (
                <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
              ) : (
                <DccBranchQueue
                  rows={owedRows}
                  today={today}
                  chosenId={chosenLeader?.id ?? null}
                  onChoose={setChosenLeader}
                />
              )
            ) : queueFailed ? null : queuePending ? (
              <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
            ) : shown.length === 0 ? (
              <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
                Nothing to record.
              </p>
            ) : branchView ? (
              <LeaderGroups
                groups={groupByLeader(
                  shown.flatMap((item) => (item.kind === 'cell' ? [item] : [])),
                  (item) => ({
                    id: item.leaderId,
                    name: item.leaderName ?? 'Its leader',
                    lastName: item.leaderLastName,
                    firstName: item.leaderFirstName,
                    memberId: item.leaderMemberId,
                    isActor: item.isActor,
                  }),
                ).map((group) => ({
                  ...group,
                  content: (
                    <QueueList
                      caption={`Update Record, ${group.title}`}
                      items={group.items}
                      today={today}
                    />
                  ),
                }))}
              />
            ) : (
              <QueueList
                caption="Update Record"
                items={shown}
                today={today}
              />
            )}

            {filter === 'DCC' ? (
              branchView && chosenLeader !== null ? (
                <LeaderChecklistGrid leader={chosenLeader} onBack={() => setChosenLeader(null)} />
              ) : (
                <DccChecklistGrid events={recordableEvents} checklists={checklists} month={month} />
              )
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

        {listTab === 'behind' ? (
          <section className={LIST} aria-labelledby="attention-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="attention-heading" className="text-lg font-bold tracking-tight">
                Pending CG Reports
              </h2>
              <p className="text-muted text-sm">
                {lastMonthRead
                  ? `Cells you oversee, this month and ${previousName} while it is open, in no particular order.`
                  : 'Cells you oversee, in no particular order.'}
              </p>
            </div>
            {behindPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : behindFailed ? null : (
              <>
                <ListTable
                  caption="Pending CG Reports"
                  columns={['Cell', 'Leader', 'Meetings recorded', 'Status']}
                  empty={`No Cell you oversee is behind ${lastMonthRead ? `this month or in ${previousName}` : 'this month'}.`}
                  rows={needingAttention.map(({ cell, month: cellMonth }) => ({
                    key: `${cell.id}|${cellMonth}`,
                    cells: [
                      <Link
                        key="cell"
                        href={`/cells/${cell.id}/meetings?month=${cellMonth}`}
                        className={NAME_LINK}
                      >
                        {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
                      </Link>,
                      cell.leader.full_name,
                      <span key="recorded" className="tabular-nums">
                        {cell.coverage.recorded} of {cell.coverage.scheduled}
                      </span>,
                      (cell.state === 'CLOSED' && cell.closed_on
                        ? `Closed ${closedOnLabel(cell.closed_on)}`
                        : 'Open') +
                        (cellMonth === month ? '' : ` · ${openUntilLabel(cellMonth)}`),
                    ],
                  }))}
                />
              </>
            )}
          </section>
        ) : null}

        {listTab === 'dcc' ? (
          <section className={LIST} aria-labelledby="pending-dcc-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="pending-dcc-heading" className="text-lg font-bold tracking-tight">
                Pending DCC Reports
              </h2>
              <p className="text-muted text-sm">
                Leaders you oversee whose 12 have no DCC record for a Sunday still open, by
                surname.
              </p>
            </div>
            <PendingDccFilters
              wholeChurch={holdsWholeChurch(me.data, 'dcc.view_subtree')}
              value={pendingFilter}
              onChange={setPendingFilter}
            />
            {pendingDccPages.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : pendingDcc ? (
              <>
                <PendingDccList
                  rows={pendingDcc}
                  empty={
                    pendingFilter.q !== '' || pendingFilter.network !== null
                      ? 'No leader matching this is behind on DCC.'
                      : 'No leader you oversee is behind on DCC.'
                  }
                  chosenId={pendingChosen?.id ?? null}
                  onChoose={setPendingChosen}
                />
                <ShowMore pages={pendingDccPages} />
                {pendingChosen !== null ? (
                  <LeaderChecklistGrid leader={pendingChosen} onBack={() => setPendingChosen(null)} />
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {/*
          Section 19's fifth outstanding-work entry, and section 20 requires the list
          behind it (decision 0232). Undated: it asks about now.
        */}
        {listTab === 'leader' ? (
          <section className={LIST} aria-labelledby="unplaced-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="unplaced-heading" className="text-lg font-bold tracking-tight">
                Awaiting Leader Assignment
              </h2>
              <p className="text-muted text-sm">
                People you oversee whose pastoral leader is not in the pastoral tree.
              </p>
            </div>
            {unplaced.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : unplaced.data ? (
              <>
                {/* The action that resolves an entry is the reassignment (section 19). */}
                <ListTable
                  caption="Awaiting Leader Assignment"
                  columns={['Name', 'Previous Cell Leader']}
                  empty="Nobody you oversee is waiting for a new leader."
                  rows={unplaced.data.map((person) => ({
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
                <ShowMore pages={unplacedPages} />
              </>
            ) : null}
          </section>
        ) : null}

        {/*
          Section 19's third outstanding-work entry, which section 15 requires and
          section 10's closure flow fills (decision 0233). Undated: it asks about now.
        */}
        {listTab === 'nocell' ? (
          <section className={LIST} aria-labelledby="without-cell-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="without-cell-heading" className="text-lg font-bold tracking-tight">
                Awaiting CG Assignment
              </h2>
              <p className="text-muted text-sm">People you oversee who are not in a Cell or leading one.</p>
            </div>
            {withoutACell.isPending ? (
              <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
            ) : withoutACell.data ? (
              <>
                <ListTable
                  caption="Awaiting CG Assignment"
                  columns={['Name']}
                  empty="Everybody you oversee is in a Cell."
                  rows={withoutACell.data.map((person) => ({
                    key: person.id,
                    cells: [
                      <Link key="name" href={`/people/${person.id}`} className={NAME_LINK}>
                        {person.full_name}
                      </Link>,
                    ],
                  }))}
                />
                <ShowMore pages={withoutACellPages} />
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* The reader's own requests, below their own work (decision 0269); on the recording
          screens they are on My Cell, beside asking for one (decision 0323). */}
      {recordingOnly || seniorPastor ? null : <SentRequests />}

      {recordingOnly || seniorPastor ? null : (
      <>
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
          {/* Whose changes the list above and never these figures (decision 0316). */}
          {periodLabel(month, cellFigures.data?.open)} · {scopeLabel}, whichever list is shown above
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
      </>
      )}
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
 * "September · open until Mon 19 Oct, 12NN": the month a Cell's figure belongs to and when
 * it closes, which is when its last week closes (section 13, decision 0335).
 */
function openUntilLabel(itemMonth: string): string {
  const [year, month] = itemMonth.split('-').map(Number);
  const name = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  );

  return `${name} · ${monthOpenUntilLabel(itemMonth).replace(/^Open/, 'open')}`;
}

/** Which of Record's lists, or Recording Status, is open (decisions 0290 and 0336). */
const RECORD_TABS = ['awaiting', 'behind', 'dcc', 'leader', 'nocell', 'status'] as const;

type RecordTab = (typeof RECORD_TABS)[number];

/** One of the five lists, inside the pane its button opens. */
const LIST = 'min-w-0 pt-5';

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
    // **Every button one size, as wide as the longest label** (decision 0332): two to a row
    // and filling it on a phone, two to a row at their own width from `sm`, and one row from
    // `lg`. The outer row keeps the full-width rule the chosen tab joins.
    <div role="group" aria-label={label} className={cn('border-line border-b', className)}>
      <div className="grid grid-cols-2 sm:inline-grid lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          onClick={() => onChoose(tab.key)}
          className={cn(tabClasses(tab.key === current), 'justify-center py-2 text-center')}
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
function describeQueueItem(item: QueueItem, today: string) {
  const isCell = item.kind === 'cell';
  const what = isCell
    ? `${cellShortName({
        cell_id: item.cellCode,
        category: item.category,
        day_of_week: item.dayOfWeek,
      })}${
        item.closedOn === null ? '' : ` · Cell closed ${dayLabel(item.closedOn)}`
      }`
    : `DCC · ${item.marked} of ${item.total} marked`;
  const leader = isCell ? (item.isActor ? 'You' : (item.leaderName ?? 'Its leader')) : 'You';
  const waiting = daysAgoLabel(item.date, today);
  // When it is due, or once late when it closes (decision 0335), on every row.
  const open = deadlineLabel({ due_at: item.dueAt, closes_at: item.closesAt })?.text ?? null;
  const href = isCell ? `/cells/${item.cellId}/meetings/${item.date}` : `/dcc/${item.eventId}`;
  // Another leader's meeting is followed up rather than recorded (decision 0322): the API
  // says per row whether this reader may record it.
  const action = isCell && !item.mayRecord ? 'See meeting' : 'Record';

  return { what, leader, waiting, open, href, action };
}

/** Awaiting entries as a table from `lg` and as cards below it. */
function QueueList({
  caption,
  items,
  today,
}: {
  caption: string;
  items: readonly QueueItem[];
  today: string;
}) {
  return (
    <>
      <Table caption={caption} className="mt-4 hidden lg:block">
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
          {items.map((item) => (
            <QueueTableRow key={queueKey(item)} item={item} today={today} />
          ))}
        </tbody>
      </Table>
      <ul className="mt-4 flex flex-col gap-3 lg:hidden">
        {items.map((item) => (
          <QueueCard key={queueKey(item)} item={item} today={today} />
        ))}
      </ul>
    </>
  );
}

interface LeaderOf {
  id: string;
  name: string;
  lastName: string | null;
  firstName: string | null;
  memberId: string | null;
  isActor: boolean;
}

/**
 * A branch view's entries under the leader each names (decision 0311), in surname, then
 * first name, then Member ID order: never by how much a leader owes or how long it has
 * waited, which would read as a ranking (decision 0009). Each group keeps its entries'
 * own order, oldest first.
 */
function groupByLeader<Item>(
  items: readonly Item[],
  leaderOf: (item: Item) => LeaderOf,
): { key: string; title: string; items: Item[] }[] {
  const groups = new Map<string, { leader: LeaderOf; items: Item[] }>();

  for (const item of items) {
    const leader = leaderOf(item);
    const group = groups.get(leader.id) ?? { leader, items: [] };
    group.items.push(item);
    groups.set(leader.id, group);
  }

  return [...groups.values()]
    .sort(
      (left, right) =>
        (left.leader.lastName ?? left.leader.name).localeCompare(
          right.leader.lastName ?? right.leader.name,
        ) ||
        (left.leader.firstName ?? '').localeCompare(right.leader.firstName ?? '') ||
        (left.leader.memberId ?? '').localeCompare(right.leader.memberId ?? ''),
    )
    .map(({ leader, items: grouped }) => ({
      key: leader.id,
      title: leader.isActor ? `${leader.name} (you)` : leader.name,
      items: grouped,
    }));
}

/**
 * One line per leader, showing the name and nothing else, opened to show their entries
 * (decision 0311). A count or the oldest date would set a figure beside every leader in
 * the branch (sections 5 and 13). The line is a heading over entries, not an entry.
 */
function LeaderGroups({
  groups,
}: {
  groups: readonly { key: string; title: string; content: ReactNode }[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  return (
    <ul className="border-line mt-4 border-t">
      {groups.map((group) => {
        const isOpen = open.has(group.key);
        const panel = `leader-group-${group.key}`;

        return (
          <li key={group.key} className="border-line border-b">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) {
                      next.delete(group.key);
                    } else {
                      next.add(group.key);
                    }
                    return next;
                  })
                }
                className="focus-visible:outline-accent hover:bg-raised flex min-h-11 w-full items-center gap-3 px-2 py-2 text-left text-base font-medium focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span aria-hidden="true" className="w-4 text-center">
                  {isOpen ? '−' : '+'}
                </span>
                {group.title}
              </button>
            </h3>
            {isOpen ? (
              <div id={panel} className="pb-4">
                {group.content}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function QueueTableRow({
  item,
  today,
}: {
  item: QueueItem;
  today: string;
}) {
  const { what, leader, waiting, open, href, action } = describeQueueItem(
    item,
    today,
  );

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
        <Link href={href} className={buttonClasses(action === 'Record' ? 'primary' : 'secondary')}>
          {action}
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
  today,
}: {
  item: QueueItem;
  today: string;
}) {
  const { what, leader, waiting, open, href, action } = describeQueueItem(
    item,
    today,
  );

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
      <Link href={href} className={buttonClasses(action === 'Record' ? 'primary' : 'secondary')}>
        {action}
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
  checklists: readonly { data?: DccRosterLine[] }[];
  month: string;
}) {
  const people = new Map<string, { name: string }>();
  const marks = new Map<string, Map<string, boolean>>();

  events.forEach((event, index) => {
    for (const line of checklists[index]?.data ?? []) {
      people.set(line.person_id, { name: line.full_name });
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

/** The leader whose checklist the branch view opened, and the month the row was in. */
interface ChosenLeader {
  id: string;
  name: string;
  month: string;
}

type OwedRow = DccOwed & { month: string };

/**
 * The DCC half of Leaders Under Me (decision 0301): one row per Sunday and leader in the
 * reader's branch with no DCC record yet, oldest first and by name, never by how far behind.
 * The reader's own row records; another leader's carries Record, where the API says the reader
 * may record for them, beside See checklist, which opens their month below, read only
 * (decision 0313).
 */
function DccBranchQueue({
  rows,
  today,
  chosenId,
  onChoose,
}: {
  rows: readonly OwedRow[];
  today: string;
  chosenId: string | null;
  onChoose: (leader: ChosenLeader) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted mt-4 max-w-2xl text-sm leading-relaxed">
        Nothing to record.
      </p>
    );
  }

  const describe = (row: OwedRow) => ({
    leader: row.leader.is_actor ? 'You' : row.leader.full_name,
    waiting: daysAgoLabel(row.event_date, today),
    open: deadlineLabel(row)?.text ?? null,
  });

  const own = (row: OwedRow) => row.leader.is_actor || row.leader.recorded_by_you;

  // Record opens the screen of the leader whose checklist holds this row's people, and is
  // offered where the API says the reader may record there (decision 0313).
  const record = (row: OwedRow) => (
    <Link
      href={
        own(row) || row.record_for === null
          ? `/dcc/${row.event_id}`
          : `/dcc/${row.event_id}?leader=${row.record_for}`
      }
      className={buttonClasses('primary')}
    >
      Record
      <span className="sr-only">
        {' '}
        DCC, {dayLabel(row.event_date)}
        {own(row) ? '' : `, for ${row.leader.full_name}`}
      </span>
    </Link>
  );

  const action = (row: OwedRow) =>
    own(row) ? (
      record(row)
    ) : (
      <span className="inline-flex flex-wrap gap-2">
        {row.may_record ? record(row) : null}
        <button
          type="button"
          data-see-checklist={row.leader.person_id}
          aria-pressed={chosenId === row.leader.person_id}
          onClick={() =>
            onChoose({ id: row.leader.person_id, name: row.leader.full_name, month: row.month })
          }
          className={buttonClasses('secondary')}
        >
          See checklist
          <span className="sr-only"> of {row.leader.full_name}</span>
        </button>
      </span>
    );

  const key = (row: OwedRow) => `${row.event_id}-${row.leader.person_id}`;

  // Grouped under each leader, name only, as the Cell list is (decision 0311).
  return (
    <LeaderGroups
      groups={groupByLeader(rows, (row) => ({
        id: row.leader.person_id,
        name: row.leader.full_name,
        lastName: row.leader.last_name,
        firstName: row.leader.first_name,
        memberId: row.leader.member_id,
        isActor: row.leader.is_actor,
      })).map((group) => ({
        key: group.key,
        title: group.title,
        content: (
          <OwedList
            caption={`DCC still to record, ${group.title}`}
            rows={group.items}
            describe={describe}
            action={action}
            rowKey={key}
          />
        ),
      }))}
    />
  );
}

/** One leader's owed Sundays as a table from `lg` and as cards below it. */
function OwedList({
  caption,
  rows,
  describe,
  action,
  rowKey: key,
}: {
  caption: string;
  rows: readonly OwedRow[];
  describe: (row: OwedRow) => { leader: string; waiting: string; open: string | null };
  action: (row: OwedRow) => ReactNode;
  rowKey: (row: OwedRow) => string;
}) {
  return (
    <>
      <Table caption={caption} className="mt-4 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Date</HeaderCell>
            <HeaderCell>What</HeaderCell>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell>Waiting</HeaderCell>
            <HeaderCell>
              <span className="sr-only">Action</span>
            </HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { leader, waiting, open } = describe(row);

            return (
              <tr key={key(row)} className={rowClasses}>
                <td className="px-3 py-3 align-top whitespace-nowrap">{dayLabel(row.event_date)}</td>
                <td className="px-3 py-3 align-top">DCC · still to record</td>
                <td className="px-3 py-3 align-top">{leader}</td>
                <td className="px-3 py-3 align-top">
                  {waiting}
                  {open === null ? null : <span className="text-muted block text-xs">{open}</span>}
                </td>
                <td className="px-3 py-3 text-right align-top">{action(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <ul className="mt-4 flex flex-col gap-3 lg:hidden">
        {rows.map((row) => {
          const { leader, waiting, open } = describe(row);

          return (
            <li
              key={key(row)}
              className="border-line flex flex-wrap items-center justify-between gap-3 border p-4"
            >
              <div className="min-w-0">
                <p className="text-base font-medium">{dayLabel(row.event_date)}</p>
                <p className="text-sm">DCC · still to record</p>
                <p className="text-muted text-sm">
                  {leader} · {waiting}
                  {open === null ? '' : ` · ${open}`}
                </p>
              </div>
              {action(row)}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Pending DCC Reports' search, and its Network filter for a whole-church reader (decision
 * 0336). The search narrows on the server and never reorders (decision 0009).
 */
function PendingDccFilters({
  wholeChurch,
  value,
  onChange,
}: {
  wholeChurch: boolean;
  value: { q: string; network: 'MENS' | 'WOMENS' | null };
  onChange: (next: { q: string; network: 'MENS' | 'WOMENS' | null }) => void;
}) {
  const [term, setTerm] = useState(value.q);
  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MINIMUM_SEARCH_LENGTH;

  return (
    <div className={`mt-4 ${CONTROL_BAR}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort) {
            onChange({ ...value, q: trimmed });
          }
        }}
        className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end lg:w-auto lg:min-w-72 lg:flex-1"
        noValidate
      >
        <Field
          label="Search a leader by name or Member ID"
          type="search"
          name="q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="min-w-0 sm:flex-1"
        />
        <Button type="submit" disabled={tooShort}>
          {trimmed === '' && value.q !== '' ? 'Show all' : 'Search'}
        </Button>
      </form>
      {wholeChurch ? (
        <RadioGroup
          legend="Network"
          name="pending-dcc-network"
          value={value.network ?? 'ALL'}
          onChange={(next) =>
            onChange({ ...value, network: next === 'ALL' ? null : (next as 'MENS' | 'WOMENS') })
          }
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'MENS', label: 'Men’s' },
            { value: 'WOMENS', label: 'Women’s' },
          ]}
        />
      ) : null}
    </div>
  );
}

/**
 * Pending DCC Reports (decision 0336): one row per leader, by surname, each open Sunday on a
 * line of its own with Update Record's label. The recorder named, Record and See checklist
 * follow the oldest Sunday; Record is offered where the API says the reader may record there.
 */
function PendingDccList({
  rows,
  empty,
  chosenId,
  onChoose,
}: {
  rows: readonly PendingDccLeader[];
  empty: string;
  chosenId: string | null;
  onChoose: (leader: ChosenLeader) => void;
}) {
  const name = (row: PendingDccLeader) =>
    row.leader.is_actor ? (
      'You'
    ) : (
      <Link href={`/people/${row.leader.person_id}`} className={NAME_LINK}>
        {row.leader.full_name}
      </Link>
    );

  const account = (row: PendingDccLeader) =>
    row.leader.has_account
      ? null
      : row.recorded_by_you
        ? 'Has no account · Recorded by you'
        : row.recorded_by !== null
          ? `Has no account · Recorded by ${row.recorded_by.full_name}`
          : 'Has no account';

  const sundays = (row: PendingDccLeader) => (
    <ul className="flex flex-col gap-1">
      {row.sundays.map((sunday) => (
        <li key={sunday.event_id}>
          <span className="text-ink whitespace-nowrap">{dayLabel(sunday.event_date)}</span>
          {' · '}
          {deadlineLabel(sunday)?.text}
        </li>
      ))}
    </ul>
  );

  const actions = (row: PendingDccLeader) => {
    const oldest = row.sundays[0];
    const own = row.leader.is_actor || row.recorded_by_you;
    const record = row.may_record ? (
      <Link
        href={
          own || row.record_for === null
            ? `/dcc/${oldest.event_id}`
            : `/dcc/${oldest.event_id}?leader=${row.record_for}`
        }
        className={buttonClasses('primary')}
      >
        Record
        <span className="sr-only">
          {' '}
          DCC, {dayLabel(oldest.event_date)}
          {row.leader.is_actor ? '' : `, for ${row.leader.full_name}`}
        </span>
      </Link>
    ) : null;

    return own ? (
      record
    ) : (
      <span className="inline-flex flex-wrap gap-2">
        {record}
        <button
          type="button"
          data-see-checklist={row.leader.person_id}
          aria-pressed={chosenId === row.leader.person_id}
          onClick={() =>
            onChoose({
              id: row.leader.person_id,
              name: row.leader.full_name,
              month: `${oldest.event_date.slice(0, 7)}-01`,
            })
          }
          className={buttonClasses('secondary')}
        >
          See checklist
          <span className="sr-only"> of {row.leader.full_name}</span>
        </button>
      </span>
    );
  };

  return (
    <>
      <Table caption="Pending DCC Reports" className="mt-4 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Leader</HeaderCell>
            <HeaderCell>Sundays still to record</HeaderCell>
            <HeaderCell>
              <span className="sr-only">Action</span>
            </HeaderCell>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="text-muted px-3 py-3">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.leader.person_id} className={rowClasses}>
                <td className="px-3 py-3 align-top">
                  {name(row)}
                  {account(row) === null ? null : (
                    <span className="text-muted block text-xs">{account(row)}</span>
                  )}
                </td>
                <td className="text-muted px-3 py-3 align-top text-sm">{sundays(row)}</td>
                <td className="px-3 py-3 text-right align-top">{actions(row)}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <ul className="mt-4 flex flex-col gap-3 lg:hidden">
        {rows.length === 0 ? (
          <li className="border-line text-muted border p-4 text-sm">{empty}</li>
        ) : (
          rows.map((row) => (
            <li key={row.leader.person_id} className="border-line flex flex-col gap-2 border p-4">
              <div className="min-w-0">
                <p className="text-base font-medium">{name(row)}</p>
                {account(row) === null ? null : (
                  <p className="text-muted text-sm">{account(row)}</p>
                )}
              </div>
              <div className="text-muted text-sm">{sundays(row)}</div>
              <div>{actions(row)}</div>
            </li>
          ))
        )}
      </ul>
    </>
  );
}

/**
 * Another leader's DCC checklist for the month, read only (decision 0301): the people whose
 * record they owe, one column per Sunday. Words rather than ticks or colour, as on the
 * reader's own grid; a dash is a Sunday the person was not on the list.
 */
function LeaderChecklistGrid({
  leader,
  onBack,
}: {
  leader: ChosenLeader;
  onBack: () => void;
}) {
  const sheet = useQuery({
    queryKey: ['dcc-leader-checklist', leader.id, leader.month],
    queryFn: ({ signal }) => getLeaderChecklist(leader.id, leader.month, signal),
  });
  const title = `${leader.name}’s DCC checklist`;

  // The checklist opens at the foot of the page, below every leader in the list, so the page
  // is taken to it and back again; otherwise See checklist looks as if it did nothing.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus();
  }, [leader.id, leader.month]);

  const back = () => {
    onBack();
    requestAnimationFrame(() => {
      const button = document.querySelector<HTMLElement>(`[data-see-checklist="${leader.id}"]`);
      button?.scrollIntoView({ block: 'center' });
      button?.focus();
    });
  };

  return (
    <section aria-labelledby="leader-grid-heading" className="mt-8">
      <p className="mb-4">
        {/* A button, since it goes back in place; styled as every other "Back to…" link. */}
        <button
          type="button"
          onClick={back}
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to your checklist
        </button>
      </p>
      <h3
        id="leader-grid-heading"
        ref={heading}
        tabIndex={-1}
        className="scroll-mt-20 text-base font-bold focus:outline-none"
      >
        {title}, {monthLabel(leader.month)}
      </h3>
      {sheet.isError ? (
        <div className="mt-3">
          <FailureNotice failure={describeFailure(sheet.error)} />
        </div>
      ) : sheet.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : sheet.data.data.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody is on {leader.name}’s DCC checklist this month.</p>
      ) : (
        <Table caption={`${title} by Sunday, ${monthLabel(leader.month)}`}>
          <thead>
            <tr>
              <HeaderCell>Person</HeaderCell>
              {sheet.data.events.map((event) => (
                <HeaderCell key={event.id}>{shortDayLabel(event.event_date)}</HeaderCell>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.data.data.map((person) => (
              <tr key={person.person_id} className={rowClasses}>
                <td className="px-3 py-3">
                  {person.full_name}
                </td>
                {sheet.data.events.map((event) => {
                  const mark = person.marks[event.id];

                  return (
                    <td key={event.id} className="px-3 py-3">
                      {mark === undefined ? (
                        <>
                          <span aria-hidden="true">–</span>
                          <span className="sr-only">Not on the list that Sunday</span>
                        </>
                      ) : mark === null ? (
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
            ))}
          </tbody>
        </Table>
      )}
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

