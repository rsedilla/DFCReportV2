'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { addCellMember, membershipFailure } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';

/**
 * Adding somebody to one Cell (SKILL.md sections 7 and 10).
 *
 * **The search is church-wide and the server decides** (decision 0244). Section 10's
 * same-Network rule and section 7's authority over the Cell are the API's to refuse, and
 * the same-Network refusal is said in plain words by `membershipFailure`.
 *
 * **Somebody already in another Cell moves here.** A move is an add: the route ends the
 * current membership and opens this one, so the dialog sends one request.
 */
export function AddMemberDialog({
  open,
  onClose,
  onAdded,
  cellId,
  cellHandle,
}: {
  open: boolean;
  onClose: () => void;
  /** Told who was added, so the page can say so. */
  onAdded: (name: string) => void;
  cellId: string;
  cellHandle: string | null;
}) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<{ id: string; full_name: string } | null>(null);

  const add = useMutation({
    mutationFn: (person: { id: string; full_name: string }) =>
      addCellMember(cellId, person.id, idempotencyKeyFor('add', cellId, person.id)),
    onSuccess: async (_result, person) => {
      await queryClient.invalidateQueries({ queryKey: ['cell-members', cellId] });
      onAdded(person.full_name);
      close();
    },
  });

  function close() {
    add.reset();
    setChosen(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={cellHandle ? `Add a member to ${cellHandle}` : 'Add a member'}
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen) {
            add.mutate(chosen);
          }
        }}
      >
        <PersonPicker
          legend="Who to add"
          description="Search everyone in the church by name. They must be in the same Network as this Cell's leader."
          searchLabel="Search for a person by name"
          selectedId={chosen?.id ?? null}
          selectedName={chosen?.full_name ?? null}
          onSelect={(person) => {
            add.reset();
            setChosen(person);
          }}
        />

        <p className="text-muted text-sm leading-relaxed">
          It takes effect today. Somebody already in another Cell moves here.
        </p>

        <FailureNotice
          failure={
            add.isError && chosen
              ? membershipFailure(add.error, chosen.full_name, cellHandle ?? 'This Cell')
              : null
          }
        />

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!chosen || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
