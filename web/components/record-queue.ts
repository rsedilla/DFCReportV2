import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { NO_PENDING_FILTER, type OwedRow, type PendingFilter } from '@/components/record-lists';
import {
  getPendingCgCells,
  listMeetingsAwaiting,
  type AwaitingMeetings,
  type CellCategory,
} from '@/lib/cells';
import {
  getDccOwed,
  getPendingDccLeaders,
  getWholeDccRoster,
  listDccEvents,
  type DccEvent,
  type DccRosterLine,
} from '@/lib/dcc';

export type QueueFilter = 'CELLS' | 'DCC';

/** Whose outstanding work the queue shows (decision 0258). */
export type Whose = 'mine' | 'branch';

export type QueueItem =
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

/**
 * Update Records' reads (SKILL.md section 19): this month's Cell meetings and Sundays still to
 * record, last month's in its close week, and the branch's DCC records still owed under Leaders
 * Under Me, with whether any is still loading or has failed. The Record screen draws what
 * this returns and decides nothing about it.
 */
export function useUpdateRecordsQueue({
  month,
  previousMonth,
  inCloseWeek,
  shownWhose,
  branchView,
  whoseKnown,
}: {
  month: string;
  previousMonth: string;
  inCloseWeek: boolean;
  shownWhose: Whose;
  branchView: boolean;
  whoseKnown: boolean;
}) {
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

  // **Every query on this page, not the ones it started with.** Section 19 puts
  // outstanding work here precisely so a leader can trust it, and a
  // failed load that renders as an empty queue says "nothing to do" on this screen's
  // authority. The queue's own reads matter most and come first: without them it is
  // empty, which is the opposite of the truth.
  const checklistFailed = checklists.find((query) => query.isError);

  return {
    awaiting,
    dccEvents,
    recordableEvents,
    checklists,
    checklistFailed,
    previousFailed,
    queue,
    queuePending,
    queueFailed,
    owedRows,
    owedPending,
    owedFailure,
  };
}

/**
 * Pending CG Records' and Pending DCC Records' reads (decisions 0336 and 0368), each with the
 * filter it is read under. On the Record screen, which shows their counts on its tabs.
 */
export function usePendingRecords(enabled: boolean) {
  // **Pending DCC Records** (decision 0336): the leaders in the reader's whole scope whose 12
  // are unrecorded for a Sunday whose week is open, fifty at a time, searched and filtered on
  // the server. Undated: it asks about now.
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>(NO_PENDING_FILTER);
  const pendingDccPages = useInfiniteQuery({
    queryKey: [
      'dcc-pending-leaders',
      pendingFilter.q,
      pendingFilter.network,
      pendingFilter.late,
      pendingFilter.leader?.id ?? null,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      getPendingDccLeaders(
        {
          cursor: pageParam,
          q: pendingFilter.q === '' ? undefined : pendingFilter.q,
          network: pendingFilter.network,
          late: pendingFilter.late,
          leaderId: pendingFilter.leader?.id ?? null,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  const pendingDcc = pendingDccPages.data?.pages.flatMap((page) => page.data);

  // **Pending CG Records** (decision 0368), laid out as Pending DCC Records is: one row per
  // Cell, each meeting still open on a line of its own, fifty at a time, searched and
  // filtered on the server. It replaced four reads of every Cell in the reader's scope.
  const [cgFilter, setCgFilter] = useState<PendingFilter>(NO_PENDING_FILTER);
  const pendingCgPages = useInfiniteQuery({
    queryKey: ['cg-pending', cgFilter.q, cgFilter.network, cgFilter.late, cgFilter.leader?.id ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      getPendingCgCells(
        {
          cursor: pageParam,
          q: cgFilter.q === '' ? undefined : cgFilter.q,
          network: cgFilter.network,
          late: cgFilter.late,
          leaderId: cgFilter.leader?.id ?? null,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  const pendingCg = pendingCgPages.data?.pages.flatMap((page) => page.data);

  return {
    pendingFilter,
    setPendingFilter,
    pendingDccPages,
    pendingDcc,
    cgFilter,
    setCgFilter,
    pendingCgPages,
    pendingCg,
  };
}
