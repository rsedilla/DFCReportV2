'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { SelectField } from '@/components/ui/select-field';
import {
  addCellMember,
  categoryLabel,
  listAllCells,
  membershipFailure,
  type PersonCells,
} from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { reportingMonthOf } from '@/lib/reporting-month';

/**
 * Moving a person to another Cell, or placing them in one (SKILL.md section 10).
 *
 * **A move is an add.** Section 10 makes a move one change that ends the current
 * membership and opens the next, and `POST /cells/{id}/members` performs both, so this
 * sends one request and never a removal first.
 *
 * **It takes effect today, and there is no date to choose.** The route takes no
 * effective date. Past months keep counting the person in the Cell they leave, because
 * section 12 reads a month against the membership window.
 *
 * **The list is the Cells of the actor's scope, and the server still decides.** It is
 * read from the Cells index. Section 10's same-Network rule and section 7's authority
 * over the Cell being left are the API's to refuse, and a refusal arrives in its own
 * words.
 */
export function MoveCellDialog({
  open,
  onClose,
  personId,
  personName,
  current,
}: {
  open: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  current: PersonCells['membership'];
}) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState('');
  const month = reportingMonthOf();

  const cells = useQuery({
    queryKey: ['cells-all', month],
    queryFn: ({ signal }) => listAllCells(month, signal),
    enabled: open,
  });

  const move = useMutation({
    mutationFn: (cellId: string) =>
      addCellMember(cellId, personId, idempotencyKeyFor('add', cellId, personId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person-cells', personId] });
      // The people-without-a-Cell list opens this dialog too, and a placed person leaves it.
      await queryClient.invalidateQueries({ queryKey: ['people-without-a-cell'] });
      close();
    },
  });

  function close() {
    move.reset();
    setChosen('');
    onClose();
  }

  const choices = (cells.data ?? []).filter((cell) => cell.id !== current?.id);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={current ? `Move ${personName} to another Cell` : `Add ${personName} to a Cell`}
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen) {
            move.mutate(chosen);
          }
        }}
      >
        {current ? (
          <p className="text-sm leading-relaxed">
            Leaving {current.cell_id}
            {current.leader ? `, led by ${current.leader.full_name}` : ''}.
          </p>
        ) : null}

        {/*
          Nothing while closed: the list is only fetched once the dialog opens, and a
          closed dialog saying "Loading…" is a loading marker that never clears.
        */}
        {!open ? null : cells.isPending ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : cells.isError ? (
          <FailureNotice failure={describeFailure(cells.error)} />
        ) : choices.length === 0 ? (
          <p className="text-muted text-sm leading-relaxed">
            There is no other Cell in your scope to choose.
          </p>
        ) : (
          <SelectField
            label="Cell"
            name="cell"
            required
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">Choose a Cell</option>
            {choices.map((cell) => (
              <option key={cell.id} value={cell.id}>
                {cell.cell_id} · {categoryLabel(cell.category)} · led by {cell.leader.full_name}
              </option>
            ))}
          </SelectField>
        )}

        <p className="text-muted text-sm leading-relaxed">
          {current
            ? `It takes effect today. Past months keep counting them in ${current.cell_id}.`
            : 'It takes effect today.'}
        </p>

        <FailureNotice
          failure={
            move.isError
              ? membershipFailure(
                  move.error,
                  personName,
                  choices.find((cell) => cell.id === chosen)?.cell_id ?? 'That Cell',
                )
              : null
          }
        />

        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
          <Button type="submit" disabled={!chosen || move.isPending}>
            {move.isPending ? (current ? 'Moving…' : 'Adding…') : current ? 'Move' : 'Add'}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
