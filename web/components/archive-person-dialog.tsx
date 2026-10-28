'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { RadioGroup } from '@/components/ui/radio-group';
import { getAccountForPerson } from '@/lib/accounts';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { ARCHIVE_REASONS, archivePerson, archiveReasonLabel, type ArchiveReason } from '@/lib/lifecycle';
import { describeFailure } from '@/lib/messages';

/** The comment's length, counted as the server counts it. */
const NOTE_MAX = 500;

/**
 * Archive a person (SKILL.md sections 3 and 6, decision 0397), opened from *Absent 3+ Months*
 * and from the person's page, by the Admin alone, after talking with the Senior Pastors.
 *
 * **It asks why**, from the seven reasons, and a comment that *Other* needs. **Where they have
 * an account that is not disabled it asks about access**, *Disable account access* chosen to
 * start with (section 6). Somebody who leads a Cell is never offered it: their row and page say
 * what to resolve first, and the API refuses them anyway.
 */
export function ArchivePersonDialog({
  open,
  onClose,
  onArchived,
  person,
}: {
  open: boolean;
  onClose: () => void;
  onArchived?: () => void;
  person: { id: string; full_name: string };
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<ArchiveReason | ''>('');
  const [note, setNote] = useState('');
  const [access, setAccess] = useState<'DISABLE' | 'KEEP'>('DISABLE');

  const account = useQuery({
    queryKey: ['account-for-person', person.id],
    queryFn: ({ signal }) => getAccountForPerson(person.id, signal),
    enabled: open,
  });
  const asksAboutAccess =
    account.data?.account != null && account.data.account.status !== 'DISABLED';

  const send = useMutation({
    mutationFn: () =>
      archivePerson(
        person.id,
        {
          reason: reason as ArchiveReason,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          ...(asksAboutAccess ? { account_access: access } : {}),
        },
        idempotencyKeyFor('archive-person', person.id, reason, note.trim(), asksAboutAccess ? access : ''),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person', person.id] });
      await queryClient.invalidateQueries({ queryKey: ['people-absent'] });
      await queryClient.invalidateQueries({ queryKey: ['people-archived'] });
      await queryClient.invalidateQueries({ queryKey: ['account-for-person', person.id] });
      onArchived?.();
      close();
    },
  });

  function close() {
    send.reset();
    setReason('');
    setNote('');
    setAccess('DISABLE');
    onClose();
  }

  const ready =
    reason !== '' && (reason !== 'OTHER' || note.trim() !== '') && account.isSuccess && !send.isPending;

  return (
    <Dialog open={open} onClose={close} title={`Archive ${person.full_name}`}>
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
          Archiving never deletes. From now they are left out of every count, their Cell
          membership ends, and anyone they pastor appears on Awaiting Leader Assignment. You can
          restore them later.
        </p>

        <RadioGroup
          legend="Why?"
          name="reason"
          value={reason}
          onChange={(next) => {
            send.reset();
            setReason(next);
          }}
          options={ARCHIVE_REASONS.map((value) => ({ value, label: archiveReasonLabel(value) }))}
        />

        <div>
          <label htmlFor="archive-note" className="field-label block">
            {reason === 'OTHER' ? 'Comment (required)' : 'Comment (optional)'}
          </label>
          <textarea
            id="archive-note"
            value={note}
            onChange={(event) => {
              send.reset();
              setNote(event.target.value);
            }}
            rows={3}
            maxLength={NOTE_MAX}
            className="border-edge focus-visible:outline-accent mt-2 w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </div>

        {asksAboutAccess ? (
          <RadioGroup
            legend="Their account"
            description="Archiving does not decide this for you (SKILL.md section 6)."
            name="account_access"
            value={access}
            onChange={(next) => {
              send.reset();
              setAccess(next);
            }}
            options={[
              { value: 'DISABLE', label: 'Disable account access' },
              { value: 'KEEP', label: 'Keep account access' },
            ]}
          />
        ) : null}

        <FailureNotice
          failure={
            account.isError
              ? describeFailure(account.error)
              : send.isError
                ? describeFailure(send.error)
                : null
          }
        />

        {/* A column below `lg`, so each button is full width in the sheet. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready}>
            {send.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
