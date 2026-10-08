'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell, PAGE_WIDTH } from '@/components/app-shell';
import { PersonPicker } from '@/components/person-picker';
import { SentRequests } from '@/components/sent-requests';
import { Button, buttonClasses } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  categoryLabel,
  cellShortName,
  dayOfWeekLabel,
  listCells,
  requestNewCell,
  type CellCategory,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { monthLabel, reportingMonthOf } from '@/lib/reporting-month';

const CATEGORIES: readonly CellCategory[] = ['YOUTH', 'YOUNG_PRO', 'COUPLE'];
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export default function MyCellPage() {
  return (
    <AppShell>
      <MyCell />
    </AppShell>
  );
}

/**
 * `My Cell`, on the recording screens (section 19, decision 0323): the reader's own Cells,
 * each with its members and this month's meetings, asking for a new Cell, and the requests
 * the reader has sent. A Cell's own pages are the ones every account uses.
 */
function MyCell() {
  const month = reportingMonthOf();
  const [asking, setAsking] = useState(false);

  const cells = useQuery({
    queryKey: ['cells', month, true],
    queryFn: ({ signal }) => listCells({ month, ledBy: 'me' }, signal),
  });

  return (
    <main id="main" className={PAGE_WIDTH.INDEX}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">My Cell</h1>
          <p className="text-muted text-sm">The Cells you lead, in {monthLabel(month)}.</p>
        </div>
        <Button variant="secondary" onClick={() => setAsking(true)}>
          Ask for a new Cell
        </Button>
      </div>

      <div className="mt-6">
        <FailureNotice failure={cells.isError ? describeFailure(cells.error) : null} />
      </div>

      {cells.isPending ? (
        <p className="text-muted mt-6 text-sm">Loading&hellip;</p>
      ) : cells.data && cells.data.data.length === 0 ? (
        <p className="text-muted mt-6 max-w-2xl text-sm leading-relaxed">
          You do not lead a Cell. Ask for a new one, and an administrator approves it.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {(cells.data?.data ?? []).map((cell) => (
            <li key={cell.id} className="border-line rounded-md border p-4">
              <h2 className="text-lg font-bold tracking-tight">
                {cellShortName({ ...cell, day_of_week: cell.schedule.day_of_week })}
              </h2>
              <p className="text-muted mt-1 text-sm">
                {cell.cell_id} · {dayOfWeekLabel(cell.schedule.day_of_week)}s at{' '}
                {cell.schedule.time_of_day} · {cell.member_count}{' '}
                {cell.member_count === 1 ? 'member' : 'members'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/cells/${cell.id}/members`} className={buttonClasses('secondary')}>
                  Members
                </Link>
                <Link
                  href={`/cells/${cell.id}/meetings?month=${month}`}
                  className={buttonClasses('secondary')}
                >
                  This month&rsquo;s meetings
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SentRequests />

      <AskForNewCell open={asking} onClose={() => setAsking(false)} />
    </main>
  );
}

/**
 * Ask for a new Cell (section 10). The leader is somebody the asker oversees, found by
 * the person picker over their own scope; the server refuses anybody else, the asker
 * included, with its own message.
 */
function AskForNewCell({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [leader, setLeader] = useState<{ id: string; full_name: string } | null>(null);
  const [category, setCategory] = useState<CellCategory | ''>('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');

  const send = useMutation({
    mutationFn: () =>
      requestNewCell(
        {
          prospective_leader_id: leader?.id ?? '',
          category: category as CellCategory,
          day_of_week: Number(day),
          time_of_day: time,
        },
        idempotencyKeyFor('new-cell', leader?.id ?? '', category, day, time),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sent-requests'] });
      close();
    },
  });

  function close() {
    send.reset();
    setLeader(null);
    setCategory('');
    setDay('');
    setTime('');
    onClose();
  }

  const ready =
    leader !== null && category !== '' && day !== '' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <Dialog open={open} onClose={close} title="Ask for a new Cell">
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
          This asks an administrator to approve a new Cell, led by somebody you oversee.
        </p>

        <PersonPicker
          legend="Who will lead it"
          description="Somebody you oversee. You cannot name yourself."
          searchLabel="Search for the leader by name"
          selectedId={leader?.id ?? null}
          selectedName={leader?.full_name ?? null}
          churchWide={false}
          onSelect={(person) => {
            send.reset();
            setLeader(person);
          }}
        />

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
