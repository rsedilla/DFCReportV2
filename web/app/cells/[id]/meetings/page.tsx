'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { FailureNotice } from '@/components/ui/failure-notice';
import { listCellMeetings, meetingStateLabel, type ScheduledMeeting } from '@/lib/cells';
import { describeFailure } from '@/lib/messages';
import { dayLabel, reportingMonthOf } from '@/lib/reporting-month';

/**
 * One Cell&rsquo;s meetings for a month (SKILL.md sections 12, 13 and 19).
 *
 * **A scheduled meeting with no record is an outstanding task, not a fourth
 * status.** Sections 13 and 19 make that distinction and this screen keeps it: the
 * three statuses are things a leader reported — `HELD`, `NOT_HELD`, `RESCHEDULED` —
 * and an absent record is the absence of a report. It reads &ldquo;Awaiting a
 * record&rdquo;, in the same type as the rest, because section 19 puts outstanding
 * work above the numbers and an unreported meeting is exactly that.
 *
 * **`NOT_HELD` is a record and is never shown as a failure.** Section 13 makes
 * reporting honestly that a Cell could not meet the whole point of that status
 * existing, so it counts as recorded, carries no warning colour, and sits in the
 * list like any other row.
 *
 * **Every date here is the *scheduled* date, which is the meeting&rsquo;s identity**
 * (section 13). A reschedule moves the actual date and leaves this one alone, so the
 * row keeps its place in the month and the actual date is shown beside it rather
 * than instead of it — a meeting that moved is one fact, not two rows.
 *
 * **The coverage line is the same two figures the index shows**, arrived at the same
 * way, and this screen recomputes neither: it renders the counts the API sends.
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

  const meetings = useQuery({
    queryKey: ['cell-meetings', params.id, month],
    queryFn: ({ signal }) => listCellMeetings(params.id, month, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">
        {meetings.data ? `Cell ${meetings.data.cell_id}` : 'Cell meetings'}
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Every meeting this Cell was scheduled to hold this month, and what was recorded for
        it. A meeting with no record yet is work outstanding rather than a meeting that did
        not happen.
      </p>

      <p className="mt-4 flex flex-wrap gap-4">
        <Link
          href={`/cells/${params.id}/members`}
          className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Members
        </Link>
        <Link
          href={`/cells/${params.id}/schedule`}
          className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Change when it meets
        </Link>
      </p>

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
            <ul className="mt-6 flex flex-col gap-3">
              {meetings.data.meetings.map((entry) => (
                <MeetingRow key={entry.scheduled_date} entry={entry} cellId={params.id} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function MeetingRow({ entry, cellId }: { entry: ScheduledMeeting; cellId: string }) {
  const meeting = entry.meeting;
  const moved =
    meeting !== null && meeting.actual_date !== null && meeting.actual_date !== entry.scheduled_date;

  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">
          <Link
            href={`/cells/${cellId}/meetings/${entry.scheduled_date}`}
            className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {dayLabel(entry.scheduled_date)}
          </Link>
          <span className="text-muted font-normal"> at {entry.scheduled_time}</span>
        </h2>
        {/*
          Words, never a colour or an icon alone (1.4.1, and sections 13 and 17).
          "Awaiting a record" reads in the same type as the three statuses because
          it is the state a leader most needs to see, not a lesser one.
        */}
        <p className="text-sm font-medium">{meetingStateLabel(meeting)}</p>
      </div>

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
    </li>
  );
}
