'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { PAGE_WIDTH } from '@/components/app-shell';
import { SectionFrame } from '@/components/section-frame';
import { CellCategoryDialog } from '@/components/cell-category-dialog';
import { CellScheduleDialog } from '@/components/cell-schedule-dialog';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { InfoToggle } from '@/components/ui/info-toggle';
import { CONTROL_BAR, FRAME, ROW } from '@/components/ui/frame';
import { HeaderCell, Table, rowClasses } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import {
  categoryLabel,
  cellName,
  listCellMeetings,
  meetingStateLabel,
  timeLabel,
  type CellCategory,
  type ScheduledMeeting,
} from '@/lib/cells';
import { getMe } from '@/lib/me';
import { describeFailure } from '@/lib/messages';
import {
  dayLabel,
  monthDayLabel,
  monthLabel,
  reportingMonthOf,
  todayInManila,
} from '@/lib/reporting-month';
import { useScreenAddress } from '@/lib/screen-address';
import { LoadingBlocks } from '@/components/ui/loading-blocks';

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
 * **A meeting whose day has not come reads "Not yet"** rather than "Not
 * recorded", as on the meeting&rsquo;s own screen: decision 0238 refuses a record before
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
    <>
      <CellMeetings />
    </>
  );
}

function CellMeetings() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  // In the address, so Back from a meeting returns to the month it was opened from.
  const go = useScreenAddress();
  const month = search.get('month') ?? reportingMonthOf();
  const [changing, setChanging] = useState(false);
  const [savedFrom, setSavedFrom] = useState<string | null>(null);
  const [changingCategory, setChangingCategory] = useState(false);
  const [savedCategory, setSavedCategory] = useState<CellCategory | null>(null);

  const meetings = useQuery({
    queryKey: ['cell-meetings', params.id, month],
    queryFn: ({ signal }) => listCellMeetings(params.id, month, signal),
  });

  const today = todayInManila();
  const handle = meetings.data?.cell_id ?? null;
  // Offered only to an account that may change a Cell's configuration (`cell.manage_configuration`),
  // which a Senior Pastor does not hold (decision 0326); the route still decides the Cell's scope
  // (decision 0379).
  const me = useQuery({ queryKey: ['me'], queryFn: ({ signal }) => getMe(signal) });
  const mayConfigure = (me.data?.capabilities ?? []).some(
    (grant) => grant.capability === 'cell.manage_configuration',
  );
  // Back to where the account's own screens reached this from: Record's Update Records for the
  // Senior Pastors, who have no Cells item, My Cell on the recording screens, and the Cells list
  // for everyone else (decision 0379). A small arrow naming it, as an app's detail page opens
  // (decision 0466).
  const seniorPastor = me.data?.screens === 'SENIOR_PASTOR';
  const back = seniorPastor
    ? { href: '/dashboard?list=awaiting', label: 'Update Records' }
    : me.data?.screens === 'RECORDING'
      ? { href: '/my-cell', label: 'My Cell' }
      : { href: '/cells', label: 'Cells' };
  const configurable = mayConfigure && meetings.data && meetings.data.cell_closed_on == null;

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      {/* Cells' for every account with a Cells item, Record's for the Senior Pastors, with no
          section name or tab above it: the way back and the sidebar say where it is (0466). */}
      <SectionFrame section={seniorPastor ? 'record' : 'cells'} bare>
      <p className="mb-3">
        <Link
          href={back.href}
          className="text-accent focus-visible:outline-accent inline-flex min-h-11 items-center gap-1 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
          {back.label}
        </Link>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {meetings.data ? cellName(meetings.data) : 'Cell meetings'}
        </h1>
        {/* From a tablet up, behind an ⓘ; on a phone, gone (decisions 0454 and 0466). */}
        <InfoToggle label="About this page" className="hidden sm:inline-flex">
          Every meeting this Cell was scheduled to hold this month, and what was recorded for it.
          A meeting with no record yet is work outstanding rather than a meeting that did not
          happen.
        </InfoToggle>
      </div>
      {meetings.data ? (
        <>
          <p className="text-muted mt-1 text-sm">
            {[
              meetings.data.cell_id,
              meetings.data.leader?.full_name ?? null,
              meetings.data.cell_closed_on != null
                ? `closed on ${dayLabel(meetings.data.cell_closed_on)}`
                : null,
            ]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </p>
          {/* The way to the members, as a pill rather than a button in a bar (decision 0466). */}
          <Link
            href={`/cells/${params.id}/members`}
            className="bg-accent-tint text-accent focus-visible:outline-accent mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Users aria-hidden="true" className="size-5" />
            {meetings.data.cell_closed_on != null
              ? 'Members'
              : `${meetings.data.member_count} ${meetings.data.member_count === 1 ? 'member' : 'members'}`}
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        </>
      ) : null}

      {/* Changing the schedule or category, for an account that may (owner's choice,
          2026-09-22, one bar); the month now heads the meetings (decision 0466). */}
      {configurable ? (
        <div className={`mt-6 ${CONTROL_BAR}`}>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setChanging(true)}>
              Change Schedule
            </Button>
            <Button variant="secondary" onClick={() => setChangingCategory(true)}>
              Change category
            </Button>
          </div>
        </div>
      ) : null}

      {savedFrom ? (
        <p aria-live="polite" className="mt-4 text-sm font-medium">
          Saved. It takes effect on 1 {monthLabel(savedFrom)}.
        </p>
      ) : null}
      {savedCategory ? (
        <p aria-live="polite" className="mt-4 text-sm font-medium">
          Saved. It is a {categoryLabel(savedCategory)} Cell from today.
        </p>
      ) : null}

      <CellCategoryDialog
        open={changingCategory}
        onClose={() => setChangingCategory(false)}
        onSaved={setSavedCategory}
        cellId={params.id}
        cellHandle={handle}
        current={meetings.data?.category ?? null}
      />

      <CellScheduleDialog
        open={changing}
        onClose={() => setChanging(false)}
        onSaved={setSavedFrom}
        cellId={params.id}
        cellHandle={handle}
      />

      <div className="mt-6">
        <FailureNotice failure={meetings.isError ? describeFailure(meetings.error) : null} />
      </div>

      {meetings.isPending ? (
        <LoadingBlocks shape="rows" className="mt-6" />
      ) : meetings.data ? (
        <section aria-labelledby="this-month-heading" className={FRAME}>
          <h2 id="this-month-heading" className="sr-only">
            Meetings in {monthLabel(month)}
          </h2>
          {/*
            The month heads the meetings it changes (decision 0466). No `open` flag here: this
            route does not return one. It is shown on the Cells index and on the reports, and
            claiming it from a clock this screen does not own would be a second answer to a
            question the API settles.
          */}
          <MonthPicker month={month} onChange={(next) => go({ month: next })} />
          <p className="mt-2">
            <CoverageFigure
              headline
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

              <ul className="mt-4 lg:hidden">
                {meetings.data.meetings.map((entry) => (
                  <li key={entry.scheduled_date} className={ROW}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="text-base font-medium">
                        <Link
                          href={`/cells/${params.id}/meetings/${entry.scheduled_date}`}
                          className={`${LINK} text-accent`}
                        >
                          {monthDayLabel(entry.scheduled_date)}
                        </Link>
                        {/* The weekday and time are the Cell's, said once in its title, so a
                            row names only the date, and its time where it differs (0466). */}
                        {entry.scheduled_time !== meetings.data.scheduled_time ? (
                          <span className="text-muted font-normal">
                            {' '}
                            at {timeLabel(entry.scheduled_time)}
                          </span>
                        ) : null}
                      </h3>
                      <MeetingState entry={entry} today={today} />
                    </div>
                    <MeetingDetail entry={entry} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </SectionFrame>
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
  // Not owed and not recorded: nobody was in the Cell that day (decision 0409).
  if (entry.meeting === null && entry.had_a_member === false) {
    return <span className="text-muted text-sm">No members that day</span>;
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
