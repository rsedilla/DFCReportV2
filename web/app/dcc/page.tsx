'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { CoverageFigure } from '@/components/coverage-figure';
import { MonthPicker } from '@/components/month-picker';
import { FailureNotice } from '@/components/ui/failure-notice';
import { listDccEvents, notRecordableLabel, type DccEvent } from '@/lib/dcc';
import { describeFailure } from '@/lib/messages';
import { dayLabel, reportingMonthOf } from '@/lib/reporting-month';

/**
 * The DCC calendar a leader picks a Sunday from (SKILL.md sections 9, 13, 15 and
 * 19; decisions 0224, 0227 and 0229).
 *
 * **A removed Sunday is shown in its place with its reason.** Section 9 draws the
 * distinction this screen exists to preserve: a removal "always means a row that
 * records a decision", where a missing row "is never a decision". A month view that
 * slid past a removal would show four events where the calendar holds five and
 * leave that unexplained, which section 9 forbids of any report covering the month.
 *
 * **A Sunday nobody could have recorded yet carries no coverage figure, and the
 * absence is stated in words.** Decision 0229: `0 of 8` would say eight leaders had
 * failed to record a service that has not happened, and `0 of 0` would say the
 * obligations were all discharged. Both are false, so the API sends no figure and
 * this screen says nothing is owed yet rather than inventing a zero.
 *
 * **Future Sundays are reachable here, unlike on the Cells index.** Section 9 runs
 * the calendar thirteen months ahead and a leader may want to look at one; the Cell
 * figures are a report and decision 0216 refuses a period that has not begun. The
 * two screens differ deliberately, which is why the month control takes the bound
 * as a prop.
 *
 * **Nothing is ranked or colour-graded** (sections 13, 17 and 19). The order is by
 * date, which is what a calendar is.
 */
export default function DccPage() {
  return (
    <AppShell>
      <DccCalendar />
    </AppShell>
  );
}

function DccCalendar() {
  const [month, setMonth] = useState(() => reportingMonthOf());

  const events = useQuery({
    queryKey: ['dcc-events', month],
    queryFn: ({ signal }) => listDccEvents(month, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <h1 className="text-2xl font-semibold tracking-tight">DCC Attendance</h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        Every Sunday this month, and how many of the leaders in your scope have recorded for
        it. A Sunday with no service is shown in its place rather than left out.
      </p>

      <MonthPicker month={month} onChange={setMonth} open={events.data?.open} allowFuture />

      <div className="mt-8">
        <FailureNotice failure={events.isError ? describeFailure(events.error) : null} />
      </div>

      {events.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : events.data && events.data.data.length === 0 ? (
        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          The calendar holds no Sundays for this month. That is a gap in the calendar rather
          than a month with no services, and an administrator generates them ahead.
        </p>
      ) : events.data ? (
        <ul className="mt-6 flex flex-col gap-3">
          {events.data.data.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function EventRow({ event }: { event: DccEvent }) {
  return (
    <li className="border-line rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-medium">
          <Link
            href={`/dcc/${event.id}`}
            className="focus-visible:outline-accent inline-flex min-h-6 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {dayLabel(event.event_date)}
          </Link>
        </h2>
        <CoverageFigure
          recorded={event.coverage?.met ?? null}
          scheduled={event.coverage?.owed ?? null}
          unit="leaders have recorded"
          nothingOwed={
            event.removed ? 'No records owed — no service' : 'No records owed yet'
          }
        />
      </div>

      {/*
        The removal's reason, because section 9 requires a removal to record a
        decision and a row saying only "removed" records none. It is not an error
        and carries no warning colour: a Sunday the church did not meet is an
        ordinary fact.
      */}
      {event.removed ? (
        <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
          No service was held.
          {event.removal_reason ? ` ${event.removal_reason}` : ''}
        </p>
      ) : event.not_recordable_reason ? (
        <p className="text-muted mt-2 text-sm">
          {notRecordableLabel(event.not_recordable_reason)}.
        </p>
      ) : null}
    </li>
  );
}
