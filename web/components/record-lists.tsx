'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { NAME_LINK, ShowMore } from '@/components/awaiting-lists';
import type { QueueItem } from '@/components/record-queue';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SearchField } from '@/components/ui/field';
import { FilterChip } from '@/components/ui/filter-chip';
import { CONTROL_BAR, TAB_GRID, countClasses, tabClasses } from '@/components/ui/frame';
import { ViewSwitch } from '@/components/ui/view-switch';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { cellShortName, closedOnLabel, type PendingCgCell } from '@/lib/cells';
import {
  getLeaderChecklist,
  type DccEvent,
  type DccOwed,
  type DccRosterLine,
  type PendingDccLeader,
} from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel, monthLabel } from '@/lib/reporting-month';
import { useSearchTerm } from '@/lib/search-term';
import { deadlineLabel } from '@/lib/weekly-deadline';
import { cn } from '@/lib/utils';

/**
 * Record's lists (SKILL.md section 19): the rows, tables and checklists the Record screen
 * (`app/dashboard/page.tsx`) shows, kept here so that screen holds only what it decides.
 */

/** One of the three lists, inside the pane its button opens. */
export const LIST = 'min-w-0 pt-5';

function queueKey(item: QueueItem): string {
  return `${item.month}-${item.kind}-${item.kind === 'cell' ? `${item.cellId}-${item.date}` : item.eventId}`;
}

/** A count for a switch button under a tab, left off at 0 as the tabs' are (decision 0350). */
export function shownCount(count: number): string | null {
  return count === 0 ? null : String(count);
}

/**
 * Equal-width buttons that choose which list is shown, each with its count in a box
 * (owner's choices of 2026-09-25). Buttons pressed and unpressed rather than ARIA tabs:
 * the lists are sections of one page, and a screen reader meets each by its heading.
 * The count box is the same on every button whatever the number, because colour never
 * marks a figure as behind (sections 13 and 19), and a list with nothing in it shows no box
 * at all (decision 0349). A count still being read shows none either.
 */
export function TabBar<Key extends string>({
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
    // **Every tab one size** (decision 0416): two to a row on a phone, one fixed width from `sm`.
    // The outer row keeps the full-width rule the chosen tab joins.
    <div role="group" aria-label={label} className={cn('border-line border-b', className)}>
      <div className={TAB_GRID}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={tab.key === current}
          onClick={() => onChoose(tab.key)}
          className={tabClasses(tab.key === current)}
        >
          {tab.label}
          {/* A count of 0 is left off (decision 0349): a row of zeros hid the lists with work. */}
          {tab.count === null || tab.count === '0' ? null : (
            <span className={countClasses(tab.key === current)}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
      </div>
    </div>
  );
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
export function QueueList({
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
 * A branch view's entries under the leader each names (decision 0311), in first name, then
 * surname, then Member ID order (decision 0359): never by how much a leader owes or how long it has
 * waited, which would read as a ranking (decision 0009). Each group keeps its entries'
 * own order, oldest first.
 */
export function groupByLeader<Item>(
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
        (left.leader.firstName ?? left.leader.name).localeCompare(
          right.leader.firstName ?? right.leader.name,
        ) ||
        (left.leader.lastName ?? '').localeCompare(right.leader.lastName ?? '') ||
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
export function LeaderGroups({
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
 * The reader's own DCC checklist across the month's Sundays (owner's choice of 2026-09-19).
 * Only their own checklist, which the checklist screen already shows mark by mark (decision
 * 0194). Words rather than ticks or colour; a dot is a Sunday not recorded yet.
 */
export function DccChecklistGrid({
  events,
  checklists,
  month,
}: {
  events: readonly DccEvent[];
  checklists: readonly { data?: DccRosterLine[] }[];
  month: string;
}) {
  const people = new Map<string, { name: string; key: [string, string, string] }>();
  const marks = new Map<string, Map<string, boolean>>();

  events.forEach((event, index) => {
    for (const line of checklists[index]?.data ?? []) {
      people.set(line.person_id, {
        name: line.full_name,
        key: [line.first_name, line.last_name, line.member_id],
      });
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

  // First name, surname, Member ID (decision 0359): never the composed name, which leads
  // with a title (decision 0271).
  const rows = [...people.entries()].sort(
    ([, a], [, b]) =>
      a.key[0].localeCompare(b.key[0]) ||
      a.key[1].localeCompare(b.key[1]) ||
      a.key[2].localeCompare(b.key[2]),
  );

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
export interface ChosenLeader {
  id: string;
  name: string;
  month: string;
}

export type OwedRow = DccOwed & { month: string };

/**
 * The DCC half of Leaders Under Me (decision 0301): one row per Sunday and leader in the
 * reader's branch with no DCC record yet, oldest first and by name, never by how far behind.
 * The reader's own row records; another leader's carries Record, where the API says the reader
 * may record for them, beside See checklist, which opens their month below, read only
 * (decision 0313).
 */
export function DccBranchQueue({
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

/** What the two Pending lists are narrowed by, all on the server (decision 0368). */
export interface PendingFilter {
  q: string;
  network: 'MENS' | 'WOMENS' | null;
  late: boolean;
  /** One leader's branch, from a Recording Progress figure (decision 0370). */
  leader: { id: string; name: string } | null;
}

export const NO_PENDING_FILTER: PendingFilter = { q: '', network: null, late: false, leader: null };

/** Says whose branch a Pending list is narrowed to, with the way back (decision 0370). */
export function BranchNote({ filter, onClear }: { filter: PendingFilter; onClear: () => void }) {
  if (filter.leader === null) {
    return null;
  }

  return (
    <div className="border-edge mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border px-4 py-3 text-sm">
      <p>
        <span className="font-bold">{filter.leader.name}</span> and everyone beneath them,
        from Recording Progress.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-accent focus-visible:outline-accent inline-flex min-h-6 cursor-pointer items-center font-bold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Show everyone
      </button>
    </div>
  );
}

/**
 * The two Pending lists' controls, one bar for both (decision 0368): the search, the Network
 * filter for a whole-church reader, and *Late only*, the items past their deadline whose week
 * is still open. Each narrows on the server and none reorders (decision 0009).
 */
export function PendingFilters({
  searchLabel,
  wholeChurch,
  value,
  onChange,
}: {
  searchLabel: string;
  wholeChurch: boolean;
  value: PendingFilter;
  onChange: (next: PendingFilter) => void;
}) {
  const { term, setTerm, trimmed, tooShort, buttonLabel } = useSearchTerm(value.q);

  return (
    // The search on its own line, and under it the filters as one row of pills (decision
    // 0416's in-page choice): the Network as a switch and Late only as a toggle, the pattern
    // of Shopify Polaris's index filters and Material's filter chips. Every filter applies at
    // once and none reorders (decision 0009).
    <div className={cn('mt-4', CONTROL_BAR, 'flex-col items-stretch gap-y-4')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooShort) {
            onChange({ ...value, q: trimmed });
          }
        }}
        className="flex w-full min-w-0"
        noValidate
      >
        <SearchField
          label={searchLabel}
          name="q"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          action={
            <Button type="submit" disabled={tooShort}>
              {buttonLabel}
            </Button>
          }
        />
      </form>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        {wholeChurch ? (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            {/* The switch is named Network for a screen reader; this is its visible twin. */}
            <span aria-hidden="true" className="field-label">
              Network
            </span>
            <ViewSwitch
              label="Network"
              className="mt-0"
              value={value.network ?? 'ALL'}
              onChange={(next) =>
                onChange({ ...value, network: next === 'ALL' ? null : (next as 'MENS' | 'WOMENS') })
              }
              options={[
                { key: 'ALL', label: 'All' },
                { key: 'MENS', label: 'Men’s' },
                { key: 'WOMENS', label: 'Women’s' },
              ]}
            />
          </div>
        ) : null}
        <FilterChip pressed={value.late} onChange={(late) => onChange({ ...value, late })}>
          Late only
        </FilterChip>
      </div>
    </div>
  );
}

/**
 * Pending CG Records (decision 0368), laid out as Pending DCC Records is: one row per Cell,
 * named by its leader, by first name, each meeting still open on a line of its own with
 * Update Records's label. Record opens the oldest, where the API says the reader may record
 * it; See meeting opens the Cell's meetings for that month.
 */
export function PendingCgList({ rows, empty }: { rows: readonly PendingCgCell[]; empty: string }) {
  const name = (row: PendingCgCell) =>
    row.leader.is_actor ? (
      'You'
    ) : (
      <Link href={`/people/${row.leader.person_id}`} className={NAME_LINK}>
        {row.leader.full_name}
      </Link>
    );

  const cellLine = (row: PendingCgCell) =>
    `${
      row.cell.category !== null && row.cell.day_of_week !== null
        ? cellShortName({ ...row.cell, cell_id: row.cell.cell_code })
        : row.cell.cell_code
    }${row.cell.closed_on ? ` · Closed ${closedOnLabel(row.cell.closed_on)}` : ''}`;

  const meetings = (row: PendingCgCell) => (
    <ul className="flex flex-col gap-1">
      {row.meetings.map((meeting) => (
        <li key={meeting.scheduled_date}>
          <span className="text-ink whitespace-nowrap">{dayLabel(meeting.scheduled_date)}</span>
          {' · '}
          {deadlineLabel(meeting)?.text}
        </li>
      ))}
    </ul>
  );

  const actions = (row: PendingCgCell) => {
    const oldest = row.meetings[0];
    const label = cellLine(row);

    return (
      <span className="inline-flex flex-wrap gap-2">
        {row.may_record ? (
          <Link
            href={`/cells/${row.cell.id}/meetings/${oldest.scheduled_date}`}
            className={buttonClasses('primary')}
          >
            Record
            <span className="sr-only">
              {' '}
              {label}, {dayLabel(oldest.scheduled_date)}
            </span>
          </Link>
        ) : null}
        <Link
          href={`/cells/${row.cell.id}/meetings?month=${oldest.reporting_month}`}
          className={buttonClasses('secondary')}
        >
          See meeting
          <span className="sr-only"> of {label}</span>
        </Link>
      </span>
    );
  };

  return (
    <>
      <Table caption="Pending CG Records" className="mt-4 hidden lg:block">
        <thead>
          <tr>
            <HeaderCell>Cell</HeaderCell>
            <HeaderCell>Meetings still to record</HeaderCell>
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
              <tr key={`${row.cell.id}|${row.leader.person_id}`} className={rowClasses}>
                <td className="px-3 py-3 align-top">
                  {name(row)}
                  <span className="text-muted block text-xs">{cellLine(row)}</span>
                </td>
                <td className="text-muted px-3 py-3 align-top text-sm">{meetings(row)}</td>
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
            <li key={`${row.cell.id}|${row.leader.person_id}`} className="border-line flex flex-col gap-2 border p-4">
              <div className="min-w-0">
                <p className="text-base font-medium">{name(row)}</p>
                <p className="text-muted text-sm">{cellLine(row)}</p>
              </div>
              <div className="text-muted text-sm">{meetings(row)}</div>
              <div>{actions(row)}</div>
            </li>
          ))
        )}
      </ul>
    </>
  );
}

/**
 * Pending DCC Records (decision 0336): one row per leader, by first name, each open Sunday on a
 * line of its own with Update Records's label. The recorder named, Record and See checklist
 * follow the oldest Sunday; Record is offered where the API says the reader may record there.
 */
export function PendingDccList({
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

  // A leader given an account after some of their open Sundays holds one now, and those
  // Sundays stay with whoever covered them (decision 0403, 3c).
  const account = (row: PendingDccLeader) => {
    if (row.leader.has_account) {
      return null;
    }
    const none = !row.leader.holds_account_now
      ? 'Has no account'
      : row.sundays.length === 1
        ? 'No account on this Sunday'
        : 'No account on these Sundays';
    return row.recorded_by_you
      ? `${none} · Recorded by you`
      : row.recorded_by !== null
        ? `${none} · Recorded by ${row.recorded_by.full_name}`
        : none;
  };

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
      <Table caption="Pending DCC Records" className="mt-4 hidden lg:block">
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
              <tr
                key={`${row.leader.person_id}-${row.sundays[0].event_id}`}
                className={rowClasses}
              >
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
            <li
              key={`${row.leader.person_id}-${row.sundays[0].event_id}`}
              className="border-line flex flex-col gap-2 border p-4"
            >
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
export function LeaderChecklistGrid({
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

  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** A paged list as a pane needs it: whether its first page is in, and Show more's three. */
interface PagedList {
  isPending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/** Pending CG Records' pane (decision 0368): its filters, its list and Show more. */
export function PendingCgPane({
  filter,
  onFilter,
  pages,
  rows,
  wholeChurch,
}: {
  filter: PendingFilter;
  onFilter: (next: PendingFilter) => void;
  pages: PagedList;
  rows: readonly PendingCgCell[] | undefined;
  wholeChurch: boolean;
}) {
  return (
    <section className={LIST} aria-labelledby="attention-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="attention-heading" className="text-lg font-bold tracking-tight">
          Pending CG Records
        </h2>
        <p className="text-muted text-sm">
          Cell Groups in your branch with a meeting not yet recorded. Press Record where it
          is yours to record; for the rest, follow up with their leader.
        </p>
      </div>
      <PendingFilters
        searchLabel="Search by Cell ID or leader"
        wholeChurch={wholeChurch}
        value={filter}
        onChange={onFilter}
      />
      <BranchNote filter={filter} onClear={() => onFilter({ ...filter, leader: null })} />
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : rows ? (
        <>
          <PendingCgList
            rows={rows}
            empty={
              filter.leader !== null
                ? `Nothing still to record in ${filter.leader.name}’s branch.`
                : filter.late
                ? 'No Cell you oversee has a meeting past its deadline.'
                : filter.q !== '' || filter.network !== null
                  ? 'No Cell matching this has a meeting still to record.'
                  : 'No Cell you oversee has a meeting still to record.'
            }
          />
          <ShowMore pages={pages} />
        </>
      ) : null}
    </section>
  );
}

/** Pending DCC Records' pane (decision 0336), with the checklist of the leader chosen in it. */
export function PendingDccPane({
  filter,
  onFilter,
  pages,
  rows,
  wholeChurch,
  chosen,
  onChoose,
}: {
  filter: PendingFilter;
  onFilter: (next: PendingFilter) => void;
  pages: PagedList;
  rows: readonly PendingDccLeader[] | undefined;
  wholeChurch: boolean;
  chosen: ChosenLeader | null;
  onChoose: (leader: ChosenLeader | null) => void;
}) {
  return (
    <section className={LIST} aria-labelledby="pending-dcc-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="pending-dcc-heading" className="text-lg font-bold tracking-tight">
          Pending DCC Records
        </h2>
        <p className="text-muted text-sm">
          Leaders in your branch who still owe a DCC Sunday. Press Record where it is yours
          to record; for the rest, follow up with them.
        </p>
      </div>
      <PendingFilters
        searchLabel="Search a leader by name or Member ID"
        wholeChurch={wholeChurch}
        value={filter}
        onChange={onFilter}
      />
      <BranchNote filter={filter} onClear={() => onFilter({ ...filter, leader: null })} />
      {pages.isPending ? (
        <p className="text-muted mt-3 text-sm">Loading&hellip;</p>
      ) : rows ? (
        <>
          <PendingDccList
            rows={rows}
            empty={
              filter.leader !== null
                ? `Nothing still to record in ${filter.leader.name}’s branch.`
                : filter.late
                ? 'No leader you oversee has a Sunday past its deadline.'
                : filter.q !== '' || filter.network !== null
                  ? 'No leader matching this is behind on DCC.'
                  : 'No leader you oversee is behind on DCC.'
            }
            chosenId={chosen?.id ?? null}
            onChoose={onChoose}
          />
          <ShowMore pages={pages} />
          {chosen !== null ? (
            <LeaderChecklistGrid leader={chosen} onBack={() => onChoose(null)} />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
