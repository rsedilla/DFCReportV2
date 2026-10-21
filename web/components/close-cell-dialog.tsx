'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  CLOSURE_REASONS,
  cellShortName,
  closeCell,
  closureReasonLabel,
  listCellMembers,
  listCells,
  type CellClosureReason,
  type CellMember,
  type CellSummary,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

/** The closure note's length (section 10), counted as the server counts it. */
const EXPLANATION_MAX = 500;

/**
 * Close this Cell (SKILL.md section 10, decision 0355).
 *
 * **An administrator's act, after talking it through with the Senior Pastors.** The screens
 * offer it only to an account the server says may close; the route still decides.
 *
 * **A reason, an explanation and a decision about every member.** The explanation is what the
 * Senior Pastors read on the closed Cell. Section 10 asks that members be dealt with
 * explicitly: here they are all left without a Cell, to appear on Cells' *Awaiting CG Assignment* (decision 0381), or
 * all moved to one Cell the administrator finds by its ID or leader.
 *
 * **A closure is never reversed** (section 10), so the button says what it does.
 */
export function CloseCellDialog({
  open,
  onClose,
  onClosed,
  cell,
}: {
  open: boolean;
  onClose: () => void;
  onClosed: (cellId: string) => void;
  /** The Cell, as the screen opening this names it. */
  cell: { id: string; name: string; leaderName: string | null };
}) {
  const queryClient = useQueryClient();
  const name = cell.name;
  const [reason, setReason] = useState<CellClosureReason | ''>('');
  const [explanation, setExplanation] = useState('');
  // Nothing chosen to start with: the members decision is made by explicit choice (section 10).
  const [where, setWhere] = useState<'' | 'NONE' | 'MOVE'>('');
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [destination, setDestination] = useState<CellSummary | null>(null);

  // Every member, every page: the closure names each one or is refused (section 10).
  const members = useQuery({
    queryKey: ['cell-members-all', cell.id],
    queryFn: async ({ signal }) => {
      const all: CellMember[] = [];
      let cursor: string | null = null;
      do {
        const page = await listCellMembers(cell.id, cursor, signal);
        all.push(...page.data);
        cursor = page.next_cursor;
      } while (cursor);
      return all;
    },
    enabled: open,
  });

  const found = useQuery({
    queryKey: ['close-destination', asked],
    queryFn: ({ signal }) =>
      listCells({ month: reportingMonthOf(), q: asked, limit: 10 }, signal),
    enabled: open && where === 'MOVE' && asked.trim().length >= 2,
  });

  const send = useMutation({
    mutationFn: () => {
      const people = members.data ?? [];
      const toCell = where === 'MOVE' ? (destination?.id ?? null) : null;
      return closeCell(
        cell.id,
        {
          reason: reason as CellClosureReason,
          note: explanation.trim(),
          members: people.map((member) => ({
            person_id: member.person_id,
            destination_cell_id: toCell,
          })),
        },
        idempotencyKeyFor(
          'close-cell',
          cell.id,
          reason,
          explanation.trim(),
          toCell ?? '',
          ...people.map((member) => member.person_id),
        ),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cells'] });
      await queryClient.invalidateQueries({ queryKey: ['cells-counts'] });
      onClosed(cell.id);
      close();
    },
  });

  function close() {
    send.reset();
    setReason('');
    setExplanation('');
    setWhere('');
    setTerm('');
    setAsked('');
    setDestination(null);
    onClose();
  }

  const count = members.data?.length ?? 0;
  // With nobody in the Cell there is nothing to decide; otherwise the choice must be made.
  const ready =
    reason !== '' &&
    explanation.trim() !== '' &&
    members.isSuccess &&
    (count === 0 || where === 'NONE' || (where === 'MOVE' && destination !== null));

  return (
    <Dialog open={open} onClose={close} title={`Close ${name}`}>
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
          {cell.leaderName ? (
            <>
              Led by <strong>{cell.leaderName}</strong>.{' '}
            </>
          ) : null}
          A closure is never reversed: if the Cell starts again, it is restarted as a new Cell.
        </p>

        <RadioGroup
          legend="Why is it closing?"
          name="reason"
          value={reason}
          onChange={(next) => {
            send.reset();
            setReason(next as CellClosureReason);
          }}
          options={CLOSURE_REASONS.map((value) => ({ value, label: closureReasonLabel(value) }))}
        />

        <div>
          <label htmlFor="closure-explanation" className="field-label block">
            Explanation for the Senior Pastors (required)
          </label>
          <textarea
            id="closure-explanation"
            value={explanation}
            onChange={(event) => {
              send.reset();
              setExplanation(event.target.value);
            }}
            rows={3}
            maxLength={EXPLANATION_MAX}
            className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>

        {members.isSuccess && count === 0 ? (
          <p className="text-sm">It has no members.</p>
        ) : (
          <RadioGroup
            legend={
              members.isPending
                ? 'Its members'
                : `Its ${count === 1 ? 'member' : `${count} members`}`
            }
            name="members"
            value={where}
            onChange={(next) => {
              send.reset();
              setWhere(next as 'NONE' | 'MOVE');
            }}
            options={[
              { value: 'NONE', label: 'Leave them without a Cell' },
              { value: 'MOVE', label: 'Move them all to another Cell' },
            ]}
          />
        )}

        {members.data && members.data.length > 0 ? (
          <p className="text-muted text-sm leading-relaxed">
            {members.data.map((member) => member.full_name).join(', ')}.
            {where === 'NONE' ? ' They will appear under Awaiting CG Assignment on Cells.' : null}
          </p>
        ) : null}

        {where === 'MOVE' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field
                label="Find the Cell by its ID or leader"
                type="search"
                name="destination"
                autoComplete="off"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className="min-w-0 sm:flex-1"
              />
              <Button
                variant="secondary"
                disabled={term.trim().length < 2}
                onClick={() => setAsked(term.trim())}
              >
                Search
              </Button>
            </div>
            {found.data ? (
              <RadioGroup
                legend="Move them to"
                name="destination_cell"
                value={destination?.id ?? ''}
                onChange={(id) =>
                  setDestination(found.data?.data.find((other) => other.id === id) ?? null)
                }
                options={found.data.data
                  .filter((other) => other.id !== cell.id)
                  .map((other) => ({
                    value: other.id,
                    label: `${cellShortName({ ...other, day_of_week: other.schedule.day_of_week })}, led by ${other.leader.full_name}`,
                  }))}
              />
            ) : null}
            <FailureNotice failure={found.isError ? describeFailure(found.error) : null} />
          </div>
        ) : null}

        <FailureNotice
          failure={
            members.isError
              ? describeFailure(members.error)
              : send.isError
                ? describeFailure(send.error)
                : null
          }
        />

        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          <Button type="submit" disabled={!ready || send.isPending}>
            {send.isPending ? 'Closing…' : 'Close this Cell'}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
