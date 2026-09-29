'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CellPicker } from '@/components/cell-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { addCellMember, membershipFailure, type CellSummary, type PersonCells } from '@/lib/cells';
import { directLeaderOf, getPastoralPath } from '@/lib/hierarchy';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { getPerson, networkLabel, networkOfSex } from '@/lib/people';

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
 * **The choices are the Cells of the actor's scope, and the server still decides.** They
 * are found through the Cells index (`CellPicker`). Section 10's same-Network rule and
 * section 7's authority over the Cell being left are the API's to refuse, and a refusal
 * arrives in its own words.
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
  const [chosen, setChosen] = useState<CellSummary | null>(null);

  // Whose Cell to lift to the top (owner's choice, 2026-09-21). Read under the key the
  // Network screen uses. A path that cannot be read leaves the list as it was rather than
  // failing the dialog: the grouping is a convenience, and choosing still works without it.
  const path = useQuery({
    queryKey: ['pastoral-path', personId],
    queryFn: ({ signal }) => getPastoralPath(personId, signal),
    enabled: open && personId !== '',
  });
  const leader = directLeaderOf(path.data?.data ?? []);

  // Their Network, which follows their sex (section 4), narrows the choices to the Cells
  // section 10 lets them join. Unread, nothing is narrowed and the add route refuses as before.
  const person = useQuery({
    queryKey: ['person', personId],
    queryFn: ({ signal }) => getPerson(personId, signal),
    enabled: open && personId !== '',
    retry: false,
  });
  const network = person.data ? networkOfSex(person.data.sex) : null;

  const move = useMutation({
    mutationFn: (cell: CellSummary) =>
      addCellMember(cell.id, personId, idempotencyKeyFor('add', cell.id, personId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person-cells', personId] });
      // The people-without-a-Cell list opens this dialog too, and a placed person leaves it.
      await queryClient.invalidateQueries({ queryKey: ['people-without-a-cell'] });
      close();
    },
  });

  function close() {
    move.reset();
    setChosen(null);
    onClose();
  }

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
          Nothing while closed, and nothing until their Network is known, so the choices
          are never offered wider than section 10 lets them join.
        */}
        {!open ? null : person.isLoading ? (
          <p className="text-muted text-sm">Loading&hellip;</p>
        ) : (
          <CellPicker
            label="Cell"
            description={
              network === null
                ? 'The Cells in your scope.'
                : `Only ${networkLabel(network)} Cells are listed: a member and their Cell’s leader share one Network.`
            }
            leaderId={leader?.id ?? null}
            leaderName={leader?.full_name ?? null}
            network={network}
            excludeId={current?.id ?? null}
            selected={chosen}
            onSelect={setChosen}
          />
        )}

        <p className="text-muted text-sm leading-relaxed">
          {current
            ? `It takes effect today. Past months keep counting them in ${current.cell_id}.`
            : 'It takes effect today.'}
        </p>

        <FailureNotice
          failure={
            move.isError
              ? membershipFailure(move.error, personName, chosen?.cell_id ?? 'That Cell')
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
