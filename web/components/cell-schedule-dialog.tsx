'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { changeCellSchedule, dayOfWeekLabel, listCellMeetings } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { monthLabel, reportingMonthOf, shiftMonth } from '@/lib/reporting-month';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The ISO 8601 weekday of a `YYYY-MM-DD` day, 1 Monday through 7 Sunday (section 20). */
function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

/**
 * Changing when a Cell meets (SKILL.md section 10; decisions 0057 and 0138).
 *
 * **It takes effect at the start of the following month, and the dialog says so three
 * times**: in the day's legend, in the sentence under the time, and on the button. A
 * leader filing this mid-month expects next week's meeting to move, and it does not.
 *
 * **What the Cell meets on now is read from this month's meetings**, which the Cell's
 * page already asks for: the weekday of a scheduled date and its time. A month that
 * scheduled nothing shows no line rather than a guess.
 *
 * **A second change before the month turns replaces the first** (section 10), and no
 * route shows a pending change, so the sentence under the time is the only place a
 * leader learns it.
 */
export function CellScheduleDialog({
  open,
  onClose,
  onSaved,
  cellId,
  cellHandle,
}: {
  open: boolean;
  onClose: () => void;
  /** Told the month the change starts in, so the page can say it was saved. */
  onSaved: (effectiveFrom: string) => void;
  cellId: string;
  cellHandle: string | null;
}) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState('');
  const [time, setTime] = useState('19:00');

  const currentMonth = reportingMonthOf();
  const effectiveFrom = shiftMonth(currentMonth, 1);

  const now = useQuery({
    queryKey: ['cell-meetings', cellId, currentMonth],
    queryFn: ({ signal }) => listCellMeetings(cellId, currentMonth, signal),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () =>
      changeCellSchedule(
        cellId,
        { day_of_week: Number(day), time_of_day: time },
        idempotencyKeyFor('schedule', cellId, day, time),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      await queryClient.invalidateQueries({ queryKey: ['cell-meetings', cellId] });
      onSaved(effectiveFrom);
      close();
    },
  });

  function close() {
    save.reset();
    setDay('');
    setTime('19:00');
    onClose();
  }

  const ready = day !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const firstMeeting = now.data?.meetings[0];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={cellHandle ? `Change when ${cellHandle} meets` : 'Change when this Cell meets'}
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            save.mutate();
          }
        }}
      >
        {firstMeeting ? (
          <p className="text-sm">
            Meets now on{' '}
            <strong>
              {dayOfWeekLabel(isoWeekday(firstMeeting.scheduled_date))} at{' '}
              {firstMeeting.scheduled_time}
            </strong>
            .
          </p>
        ) : null}

        <RadioGroup
          legend={`Which day, from ${monthLabel(effectiveFrom)}`}
          name="day_of_week"
          value={day}
          onChange={setDay}
          options={DAYS.map((value) => ({ value: String(value), label: dayOfWeekLabel(value) }))}
        />

        <Field
          label="What time"
          description="Manila time, 24-hour clock."
          type="time"
          name="time_of_day"
          autoComplete="off"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />

        <p className="text-muted text-sm leading-relaxed">
          Starts on 1 {monthLabel(effectiveFrom)}. Meetings still to come this month do not
          move. If a change for {monthLabel(effectiveFrom)} was already made, this one replaces
          it.
        </p>

        <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!ready || save.isPending}>
            {save.isPending
              ? 'Saving…'
              : `Move to ${day === '' ? 'a new day' : dayOfWeekLabel(Number(day))} from 1 ${monthLabel(effectiveFrom)}`}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
