'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CellScheduleDialog } from '@/components/cell-schedule-dialog';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button, buttonClasses } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import {
  categoryLabel,
  dayOfWeekLabel,
  listCellMeetings,
  meetingStateLabel,
  timeLabel,
  type CellMeetings,
  type ScheduledMeeting,
} from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { dayLabel, monthLabel, reportingMonthOf, todayInManila } from '@/lib/reporting-month';

const LINK =
  'focus-visible:outline-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * One Cell&rsquo;s meetings for a month, and the Cell&rsquo;s own page (SKILL.md sections
 * 10, 12, 13 and 19).
 *
 * **A scheduled meeting with no record is an outstanding task, not a fourth
 * status.** Sections 13 and 19 make that distinction and this screen keeps it: the
 * three statuses are things a leader reported — `HELD`, `NOT_HELD`, `RESCHEDULED` —
 * and an absent record is the absence of a report. Every state is an outlined word
 * and never a colour.
 *
 * **A meeting whose day has not come reads "Not yet"** rather than "Awaiting a
 * record", as on the meeting&rsquo;s own screen: decision 0238 refuses a record before
 * the day begins in Manila, so nothing is awaited yet.
 *
 * **`NOT_HELD` is a record and is never shown as a failure.** Section 13 makes
 * reporting honestly that a Cell could not meet the whole point of that status
 * existing, so it counts as recorded and sits in the list like any other row.
 *
 * **Every date here is the *scheduled* date, which is the meeting&rsquo;s identity**
 * (section 13). A reschedule moves the actual date and leaves this one alone, so the
 * row keeps its place in the month and the actual date is shown beside it.
 *
 * **The coverage line is the same two figures the index shows**, and this screen
 * recomputes neither: it renders the counts the API sends.
 */
export default function CellMeetingsPage() {
  return (
    <AppShell>
      <CellMeetings />
    </AppShell>
  );
}

function CellMeetings() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [month, setMonth] = useState(() => search.get('month') ?? reportingMonthOf());
  const [changing, setChanging] = useState(false);
  const [savedFrom, setSavedFrom] = useState<string | null>(null);

  const meetings = useQuery({
    queryKey: ['cell-meetings', params.id, month],
    queryFn: ({ signal }) => listCellMeetings(params.id, month, signal),
  });

  const today = todayInManila();
  const handle = meetings.data?.cell_id ?? null;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <p className="mb-4">
        <Link href="/cells" className={`${LINK} text-accent text-sm font-medium`}>
          Back to Cells
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        {meetings.data ? cellTitle(meetings.data) : 'Cell meetings'}
      </h1>
      {meetings.data ? (
        <p className="text-muted mt-1 text-sm">{cellSubtitle(meetings.data)}</p>
      ) : null}
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Every meeting this Cell was scheduled to hold this month, and what was recorded for
        it. A meeting with no record yet is work outstanding rather than a meeting that did
        not happen.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link href={`/cells/${params.id}/members`} className={buttonClasses('secondary')}>
          Members
        </Link>
        <Button variant="secondary" onClick={() => setChanging(true)}>
          Change when it meets
        </Button>
      </div>

      {savedFrom ? (
        <p aria-live="polite" className="mt-4 text-sm font-medium">
          Saved. It takes effect on 1 {monthLabel(savedFrom)}.
        </p>
      ) : null}

      <CellScheduleDialog
        open={changing}
        onClose={() => setChanging(false)}
        onSaved={setSavedFrom}
        cellId={params.id}
        cellHandle={handle}
      />

      {/*
        No `open` flag here: this route does not return one. It is shown on the
        Cells index and on the reports, and claiming it from a clock this screen
        does not own would be a second answer to a question the API settles.
      */}
      <MonthPicker month={month} onChange={setMonth} />

      <div className="mt-8">
        <FailureNotice failure={meetings.isError ? describeFailure(meetings.error) : null} />
      </div>

      {meetings.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : meetings.data ? (
        <>
          <p className="mt-6">
            <CoverageFigure
              recorded={meetings.data.recorded_count}
              scheduled={meetings.data.scheduled_count}
              unit="meetings recorded"
            />
          </p>

          {meetings.data.meetings.length === 0 ? (
            <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
              This Cell had no meetings scheduled this month. That is not an error: a Cell
              scheduled nothing in a month before it existed, or after it closed.
            </p>
          ) : (
            <>
              <Table caption="Meetings this month" className="mt-6 hidden lg:block">
                <thead>
                  <tr>
                    <HeaderCell>Meeting</HeaderCell>
                    <HeaderCell>Time</HeaderCell>
                    <HeaderCell>What was recorded</HeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {meetings.data.meetings.map((entry) => (
                    <tr key={entry.scheduled_date} className={rowClasses}>
                      <td className="px-3 py-3 align-top">
                        <Link
                          href={`/cells/${params.id}/meetings/${entry.scheduled_date}`}
                          className={`${LINK} text-accent font-medium`}
                        >
                          {dayLabel(entry.scheduled_date)}
                        </Link>
                      </td>
                      <td className="px-3 py-3 align-top">{timeLabel(entry.scheduled_time)}</td>
                      <td className="px-3 py-3 align-top">
                        <MeetingState entry={entry} today={today} />
                        <MeetingDetail entry={entry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <ul className="mt-6 flex flex-col gap-3 lg:hidden">
                {meetings.data.meetings.map((entry) => (
                  <li key={entry.scheduled_date} className="border-line border p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="text-base font-medium">
                        <Link
                          href={`/cells/${params.id}/meetings/${entry.scheduled_date}`}
                          className={`${LINK} text-accent`}
                        >
                          {dayLabel(entry.scheduled_date)}
                        </Link>
                        <span className="text-muted font-normal">
                          {' '}
                          at {timeLabel(entry.scheduled_time)}
                        </span>
                      </h2>
                      <MeetingState entry={entry} today={today} />
                    </div>
                    <MeetingDetail entry={entry} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}

/**
 * Words, never a colour or an icon alone (1.4.1, and sections 13 and 17). A day that has
 * not come is muted text rather than a tag: it is not a state anybody could act on.
 */
function MeetingState({ entry, today }: { entry: ScheduledMeeting; today: string }) {
  if (entry.meeting === null && entry.scheduled_date > today) {
    return <span className="text-muted text-sm">Not yet</span>;
  }

  return <Tag appearance="outline">{meetingStateLabel(entry.meeting)}</Tag>;
}

function MeetingDetail({ entry }: { entry: ScheduledMeeting }) {
  const meeting = entry.meeting;
  const moved =
    meeting !== null && meeting.actual_date !== null && meeting.actual_date !== entry.scheduled_date;

  return (
    <>
      {moved && meeting ? (
        <p className="text-muted mt-2 text-sm">
          Moved to {dayLabel(meeting.actual_date as string)}
          {meeting.actual_time ? ` at ${meeting.actual_time}` : ''}. It still reports in the
          month it was scheduled in.
        </p>
      ) : null}

      {meeting?.not_held_note ? (
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          {meeting.not_held_note}
        </p>
      ) : null}
    </>
  );
}

/**
 * "Young Pro · Fridays 7:30 pm", the owner's design's way of naming a Cell, as the Cell
 * stands today (each meeting row carries its own time); the Cell ID where there is no
 * category or schedule to name.
 */
function cellTitle(data: CellMeetings): string {
  if (data.category == null || data.day_of_week == null || data.scheduled_time == null) {
    return `Cell ${data.cell_id}`;
  }

  return `${categoryLabel(data.category)} · ${dayOfWeekLabel(data.day_of_week)}s ${timeLabel(
    data.scheduled_time,
  )}`;
}

/** "C-0007 · led by Ana Reyes · 6 members", or when it closed in place of the count. */
function cellSubtitle(data: CellMeetings): string {
  const parts = [data.cell_id];

  if (data.leader?.full_name) {
    parts.push(`led by ${data.leader.full_name}`);
  }

  parts.push(
    data.cell_closed_on != null
      ? `closed on ${dayLabel(data.cell_closed_on)}`
      : data.member_count === 1
        ? '1 member'
        : `${data.member_count} members`,
  );

  return parts.join(' · ');
}
