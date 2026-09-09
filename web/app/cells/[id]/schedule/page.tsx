'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import { changeCellSchedule, dayOfWeekLabel } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { monthLabel, reportingMonthOf, shiftMonth } from '@/lib/reporting-month';

/**
 * Changing when a Cell meets (SKILL.md sections 10, 12 and 20; decision 0057).
 *
 * **It takes effect at the start of the following month, and this screen leads with
 * that.** Section 10 is the reason and it is not administrative tidiness: a month
 * has exactly one schedule throughout, which is what lets a coverage denominator be
 * derived from the calendar at all. A mid-month change would make the number of
 * meetings a Cell was due to hold depend on when the change was filed, so the same
 * month would read differently before and after — and a leader would have been
 * marked short for meetings the schedule no longer says existed.
 *
 * A leader filing this in the second week reasonably expects next week's meeting to
 * move. It will not, and a screen that let them find that out afterwards would have
 * cost somebody a missed meeting. So the month it takes effect is named in the
 * heading, again above the control, and again on the button.
 *
 * **The day is ISO 8601, Monday through Sunday** (section 20), which is the same
 * numbering `EXTRACT(ISODOW ...)` returns — so a month's scheduled meetings are
 * arithmetic against the calendar rather than a mapping table.
 */
export default function CellSchedulePage() {
  return (
    <AppShell>
      <CellSchedule />
    </AppShell>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function CellSchedule() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [day, setDay] = useState<string>('');
  const [time, setTime] = useState('19:00');

  const effectiveFrom = shiftMonth(reportingMonthOf(), 1);

  const save = useMutation({
    mutationFn: () =>
      changeCellSchedule(
        params.id,
        { day_of_week: Number(day), time_of_day: time },
        idempotencyKeyFor('schedule', params.id, day, time),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', params.id] });
    },
  });

  const ready = day !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <main id="main" className={PAGE_WIDTH.READING}>
      <p className="mb-4">
        <Link
          href={`/cells/${params.id}/meetings`}
          className="focus-visible:outline-accent text-muted inline-flex min-h-6 items-center rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to this Cell&rsquo;s meetings
        </Link>
      </p>

      <h1 className="text-2xl font-semibold tracking-tight">
        Change when this Cell meets
      </h1>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        A new day and time start on <strong className="text-ink">1 {monthLabel(effectiveFrom)}</strong>.
        This month keeps the schedule it already has, so meetings still to come this month do
        not move.
      </p>
      <p className="text-muted mt-2 max-w-2xl text-sm leading-relaxed">
        That is deliberate: a month has one schedule throughout, which is what makes
        &ldquo;meetings recorded out of meetings scheduled&rdquo; a fixed figure rather than one
        that changes depending on when a schedule was edited.
      </p>

      <div className="mt-8">
        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
      </div>

      {save.isSuccess ? (
        <p aria-live="polite" className="mt-6 text-sm font-medium">
          Saved. It takes effect on 1 {monthLabel(effectiveFrom)}.
        </p>
      ) : null}

      <div className="mt-8">
        <RadioGroup
          legend={`Which day, from ${monthLabel(effectiveFrom)}`}
          name="day_of_week"
          value={day}
          onChange={setDay}
          options={DAYS.map((value) => ({
            value: String(value),
            label: dayOfWeekLabel(value),
          }))}
        />
      </div>

      <div className="mt-6">
        <label htmlFor="time-of-day" className="block text-sm font-medium">
          What time
        </label>
        <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
          Local time in Manila, on a 24-hour clock. The same wall-clock time each week.
        </p>
        <input
          id="time-of-day"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="border-line focus-visible:outline-accent mt-2 min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>

      <div className="mt-8">
        <Button type="button" onClick={() => save.mutate()} disabled={!ready || save.isPending}>
          {save.isPending
            ? 'Saving…'
            : `Move to ${day === '' ? 'a new day' : dayOfWeekLabel(Number(day))} from 1 ${monthLabel(effectiveFrom)}`}
        </Button>
      </div>
    </main>
  );
}
