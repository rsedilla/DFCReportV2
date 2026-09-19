'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { MonthPicker } from '@/components/month-picker';
import { FailureNotice } from '@/components/ui/failure-notice';
import {
  categoryLabel,
  listCellMeetings,
  listCells,
  listMeetingsAwaiting,
  meetingStateLabel,
} from '@/lib/cells';
import { getWholeDccRoster, listDccEvents } from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel, reportingMonthOf, todayInManila } from '@/lib/reporting-month';

/**
 * The reader's month: every date they owe a record, their own Cells' meetings and their own
 * DCC checklist together (the owner's design, adjusted to the rules; owner's choice of
 * 2026-09-19). It replaces a list of the month's Sundays with a scope-wide figure each, which
 * Reports → DCC → By Sunday already carries.
 *
 * **States are words, never colour** (sections 13, 17 and 19): Recorded, Awaiting a record,
 * Not yet, and Not recorded · month closed, which opens nothing. A Sunday with no service is shown in its place with its reason (section 9).
 *
 * **Monday first** (decision 0054). On a phone the grid becomes a list of the same dates.
 */
export default function DccPage() {
  return (
    <AppShell>
      <YourMonth />
    </AppShell>
  );
}

interface DayItem {
  key: string;
  date: string;
  label: string;
  state: string;
  href: string | null;
}

function timeLabel(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const hour = hours % 12 === 0 ? 12 : hours % 12;

  return `${hour}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'}`;
}

function YourMonth() {
  const [month, setMonth] = useState(() => reportingMonthOf());
  const today = todayInManila();

  const cells = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  const meetings = useQueries({
    queries: (cells.data?.data ?? []).map((cell) => ({
      queryKey: ['cell-meetings', cell.id, month],
      queryFn: ({ signal }: { signal: AbortSignal }) => listCellMeetings(cell.id, month, signal),
    })),
  });

  // A Cell closed this month is not in the index, and its meetings still owed a record reach
  // the reader only through the recording queue (decision 0251).
  const awaiting = useQuery({
    queryKey: ['meetings-awaiting', month, 'mine'],
    queryFn: ({ signal }) => listMeetingsAwaiting(month, signal, 'mine'),
  });

  const events = useQuery({
    queryKey: ['dcc-events', month],
    queryFn: ({ signal }) => listDccEvents(month, signal),
  });

  const heldEvents = (events.data?.data ?? []).filter((event) => !event.removed);

  // A closed month offers nothing to record: what was never recorded is shown without an action.
  // Each half reads its own route's answer, and an answer not yet read counts as closed.
  const cellsOpen = cells.data?.open === true;
  const dccOpen = events.data?.open === true;

  const checklists = useQueries({
    queries: heldEvents.map((event) => ({
      queryKey: ['dcc-roster-whole', event.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getWholeDccRoster(event.id, signal),
    })),
  });

  const items: DayItem[] = [];

  (cells.data?.data ?? []).forEach((cell, index) => {
    for (const scheduled of meetings[index]?.data?.meetings ?? []) {
      const notYet = scheduled.meeting === null && scheduled.scheduled_date > today;

      items.push({
        key: `cell-${cell.id}-${scheduled.scheduled_date}`,
        date: scheduled.scheduled_date,
        label: `${categoryLabel(cell.category)} · ${timeLabel(scheduled.scheduled_time)}`,
        state: notYet
          ? 'Not yet'
          : scheduled.meeting !== null
            ? `Recorded · ${meetingStateLabel(scheduled.meeting).toLowerCase()}`
            : cellsOpen
              ? 'Awaiting a record'
              : 'Not recorded · month closed',
        href:
          notYet || (scheduled.meeting === null && !cellsOpen)
            ? null
            : `/cells/${cell.id}/meetings/${scheduled.scheduled_date}`,
      });
    }
  });

  const listed = new Set((cells.data?.data ?? []).map((cell) => cell.id));
  for (const meeting of awaiting.data?.meetings ?? []) {
    if (!listed.has(meeting.cell_id)) {
      items.push({
        key: `closed-${meeting.cell_id}-${meeting.scheduled_date}`,
        date: meeting.scheduled_date,
        label: `${meeting.category ? `${categoryLabel(meeting.category)} · ` : ''}${timeLabel(meeting.scheduled_time)}`,
        state: 'Awaiting a record · Cell closed',
        href: `/cells/${meeting.cell_id}/meetings/${meeting.scheduled_date}`,
      });
    }
  }

  for (const event of events.data?.data ?? []) {
    if (event.removed) {
      items.push({
        key: `dcc-${event.id}`,
        date: event.event_date,
        label: 'DCC',
        state: `No service${event.removal_reason ? `: ${event.removal_reason}` : ''}`,
        href: null,
      });
      continue;
    }

    const lines = checklists[heldEvents.indexOf(event)]?.data;

    // Somebody who disciples nobody owes no DCC record, so the Sunday is not theirs to show.
    if (lines === undefined || lines.length === 0) {
      continue;
    }

    const unmarked = lines.filter((line) => line.record === null).length;
    const notYet = event.not_recordable_reason === 'NOT_YET_HELD';

    items.push({
      key: `dcc-${event.id}`,
      date: event.event_date,
      label: 'DCC',
      state: notYet
        ? 'Not yet'
        : unmarked === 0
          ? 'Recorded'
          : dccOpen
            ? `Awaiting a record · ${unmarked} to mark`
            : `Not recorded · month closed · ${unmarked} unmarked`,
      href: notYet || (unmarked > 0 && !dccOpen) ? null : `/dcc/${event.id}`,
    });
  }

  // Only the month shown: a closed Cell's queue can carry last month's work in the close week.
  const shown = items
    .filter((item) => item.date.startsWith(month.slice(0, 8)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));

  const pending =
    cells.isPending ||
    events.isPending ||
    awaiting.isPending ||
    meetings.some((query) => query.isPending) ||
    checklists.some((query) => query.isPending);

  const failed = [cells, events, awaiting, ...meetings, ...checklists].find(
    (query) => query.isError,
  );

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">Your month</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Every date you owe a record: your own Cells&rsquo; meetings and your own DCC checklist. Each
        opens its record.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={events.data?.open} />

      <div className="mt-8">
        <FailureNotice failure={failed ? describeFailure(failed.error) : null} />
      </div>

      {pending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : shown.length === 0 ? (
        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          You owe no record this month.
        </p>
      ) : (
        <>
          <MonthGrid month={month} items={shown} />
          <MonthList items={shown} />
        </>
      )}
    </main>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The month as weeks, Monday first; `null` pads the days outside it. */
function weeksOf(month: string): (string | null)[][] {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);

  for (let day = 1; day <= length; day += 1) {
    days.push(`${month.slice(0, 8)}${String(day).padStart(2, '0')}`);
  }
  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}

function ItemView({ item }: { item: DayItem }) {
  return (
    <div className="mt-1 text-xs leading-snug">
      {item.href ? (
        <Link
          href={item.href}
          className="focus-visible:outline-accent inline-flex min-h-6 items-center font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {item.label}
          <span className="sr-only">, {dayLabel(item.date)}</span>
        </Link>
      ) : (
        <span className="font-medium">{item.label}</span>
      )}
      <span className="text-muted block">{item.state}</span>
    </div>
  );
}

function MonthGrid({ month, items }: { month: string; items: DayItem[] }) {
  return (
    <table className="mt-6 hidden w-full table-fixed border-collapse sm:table">
      <caption className="sr-only">Every date you owe a record this month</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((weekday) => (
            <th
              key={weekday}
              scope="col"
              className="text-muted pb-2 text-left text-xs font-bold tracking-[0.08em] uppercase"
            >
              {weekday}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeksOf(month).map((week, index) => (
          <tr key={index}>
            {week.map((date, day) => (
              <td
                key={date ?? `pad-${index}-${day}`}
                className="border-line h-24 border p-2 align-top"
              >
                {date ? (
                  <>
                    <span className="text-sm font-bold">{Number(date.slice(8))}</span>
                    {items
                      .filter((item) => item.date === date)
                      .map((item) => (
                        <ItemView key={item.key} item={item} />
                      ))}
                  </>
                ) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthList({ items }: { items: DayItem[] }) {
  const dates = [...new Set(items.map((item) => item.date))];

  return (
    <ul className="border-line mt-6 border-t sm:hidden">
      {dates.map((date) => (
        <li key={date} className="border-line border-b py-3">
          <p className="text-sm font-bold">{dayLabel(date)}</p>
          {items
            .filter((item) => item.date === date)
            .map((item) => (
              <ItemView key={item.key} item={item} />
            ))}
        </li>
      ))}
    </ul>
  );
}
