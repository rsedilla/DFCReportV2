'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  categoryLabel,
  dayOfWeekLabel,
  requestCellRestart,
  type CellCategory,
  type CellSummary,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

const CATEGORIES: readonly CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Restart this Cell (decisions 0264, 0265 and 0266).
 *
 * **A request, not a reopening.** Section 10 never reverses a closure, so this asks Admin
 * to approve a new Cell that records the one it resumes, and the closed Cell stays
 * exactly as it is. The words on the button say so rather than "Reopen".
 *
 * **The leader is fixed, not chosen.** A restart names the Cell's last leader (decision
 * 0264); somebody else taking those people on is an ordinary new Cell. So the leader is
 * shown as a sentence rather than as a field somebody could change.
 *
 * **Category, day and time start from the closed Cell and may change**, because people
 * come back to a Cell and not to a timetable (decision 0264).
 *
 * **No member list.** The former members are added to the new Cell after approval,
 * through the membership route, where a membership's refusals and its audit entry live.
 */
export function RestartCellDialog({
  open,
  onClose,
  onSent,
  cell,
}: {
  open: boolean;
  onClose: () => void;
  onSent: (cellId: string) => void;
  cell: CellSummary;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<CellCategory | ''>(cell.category);
  const [day, setDay] = useState(String(cell.schedule.day_of_week));
  const [time, setTime] = useState(cell.schedule.time_of_day);

  const send = useMutation({
    mutationFn: () =>
      requestCellRestart(
        {
          restart_of_cell_id: cell.id,
          prospective_leader_id: cell.leader.person_id,
          category: category as CellCategory,
          day_of_week: Number(day),
          time_of_day: time,
        },
        idempotencyKeyFor('restart', cell.id, category, day, time),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      onSent(cell.id);
      close();
    },
  });

  function close() {
    send.reset();
    setCategory(cell.category);
    setDay(String(cell.schedule.day_of_week));
    setTime(cell.schedule.time_of_day);
    onClose();
  }

  const ready = category !== '' && day !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <Dialog open={open} onClose={close} title={`Restart ${cell.cell_id}`}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            send.mutate();
          }
        }}
      >
        <p className="text-sm leading-relaxed">
          This asks Admin to approve a new Cell that resumes {cell.cell_id}. The closed Cell
          stays as it is, with its history.
        </p>

        <p className="text-sm leading-relaxed">
          Led by <strong>{cell.leader.full_name}</strong>, who led it before. A restart always
          names the leader who led it; somebody else taking these people on is a new Cell.
        </p>

        <RadioGroup
          legend="Category"
          name="category"
          value={category}
          onChange={setCategory}
          options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
        />

        <RadioGroup
          legend="Which day"
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
          Filled in from how it met before. Once Admin approves, add its members to the new
          Cell.
        </p>

        <FailureNotice failure={send.isError ? describeFailure(send.error) : null} />

        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          <Button type="submit" disabled={!ready || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send for approval'}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
