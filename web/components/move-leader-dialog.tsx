'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { reassignPastoralLeader } from '@/lib/hierarchy';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';

/**
 * Moving a person to another pastoral leader, from their profile (SKILL.md section 5;
 * owner's choice of 2026-09-15, step 2 of the clean-up).
 *
 * **Its own action, never a side effect of an edit.** The design puts it beside Edit details
 * for that reason, and the Edit page shows the leader read-only and points here.
 *
 * **Reassignment is the highest-risk authorization surface in the system, and none of that
 * risk is managed here.** Section 5 refuses a leader outside the actor's own subtree in either
 * direction, the actor changing their own assignment or anyone upline of them, a cycle, a
 * cross-Network edge and an archived Person. Every one is the API's and is tested there; the
 * refusal is shown inside this dialog and nothing changes.
 *
 * **No effective date is offered.** Section 5 gates backdating behind its own capability, an
 * audit entry and a reason, because a backdated assignment rewrites which subtree a person
 * belonged to in periods that may already be closed. **A reason is offered and optional**,
 * matching what the API accepts.
 */
export function MoveLeaderDialog({
  open,
  onClose,
  personId,
  personName,
  currentLeaderName,
}: {
  open: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  currentLeaderName: string | null;
}) {
  const queryClient = useQueryClient();
  const reasonId = useId();

  const [chosen, setChosen] = useState<{ id: string; full_name: string } | null>(null);
  const [reason, setReason] = useState('');

  const move = useMutation({
    mutationFn: () => {
      if (chosen === null) {
        throw new Error('Nobody chosen.');
      }
      const trimmed = reason.trim();
      return reassignPastoralLeader(
        personId,
        chosen.id,
        trimmed || undefined,
        idempotencyKeyFor('reassign', personId, chosen.id, trimmed),
      );
    },
    onSuccess: async () => {
      close();
      await queryClient.invalidateQueries({ queryKey: ['pastoral-path'] });
      await queryClient.invalidateQueries({ queryKey: ['awaiting-reassignment'] });
    },
  });

  function close() {
    setChosen(null);
    setReason('');
    move.reset();
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} title={`Move ${personName} to another leader`}>
      <p className="text-sm">
        {currentLeaderName ? (
          <>
            Pastored now by <strong>{currentLeaderName}</strong>.
          </>
        ) : (
          'No pastoral leader is recorded now.'
        )}
      </p>

      <div className="mt-4">
        <PersonPicker
          legend="New pastoral leader"
          description="Search everyone in the church. Whether you may make this move is decided when you confirm it."
          searchLabel="Search for a leader by name"
          selectedId={chosen?.id ?? null}
          selectedName={chosen?.full_name ?? null}
          onSelect={setChosen}
        />
      </div>

      {chosen ? (
        <div className="mt-4">
          <label htmlFor={reasonId} className="field-label block">
            Why is this changing? (optional)
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>
      ) : null}

      <p className="text-muted mt-4 text-sm leading-relaxed">
        It takes effect now. Moving someone as of an earlier date is a separate permission.
      </p>

      <div className="mt-4">
        <FailureNotice failure={move.isError ? describeFailure(move.error) : null} />
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap">
        <Button onClick={() => move.mutate()} disabled={chosen === null || move.isPending}>
          {move.isPending ? 'Moving…' : chosen ? `Move under ${chosen.full_name}` : 'Move'}
        </Button>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
