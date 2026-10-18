'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { PersonPicker } from '@/components/person-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { TextLink } from '@/components/ui/text-link';
import { ApiRequestError } from '@/lib/api-client';
import { cellShortName, type PersonCells } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { getBranch } from '@/lib/network';
import { correctSex, networkOfSex, sexLabel, type Network, type Sex } from '@/lib/people';
import { todayInManila } from '@/lib/reporting-month';

function networkLabel(network: Network): string {
  return network === 'MENS' ? 'Men’s Network' : 'Women’s Network';
}

/** Somebody the refusal names, from the API's details. */
interface Named {
  id: string;
  full_name: string;
}

/**
 * Correcting a person's sex (SKILL.md section 4, decision 0367): an administrator's action
 * of its own on the person page, never a field in Edit details, because sex decides Network
 * and the correction moves the person to the other one.
 *
 * **What it changes is stated rather than chosen.** Sex has two values, so the new one is the
 * other, and the Network it moves to is said beside it.
 *
 * **A person with a pastoral leader moves to a leader in the new Network at the same
 * instant**, so the dialog asks for one and searches that Network only. Somebody with no
 * leader is asked for none, since the API refuses a leader it would ignore.
 *
 * **What refuses it is said before the form**, from reads the page already makes or this
 * dialog makes once: a Network root is not corrected here (section 5), and somebody who leads
 * people or a Cell has those moved first, each named with a link. The API still decides, and
 * a refusal it gives is shown with whoever it names.
 *
 * **An earlier date is offered only to an account that may backdate**, and a blank one means
 * now. The reason is required: every correction carries one (section 4).
 */
export function CorrectSexDialog({
  open,
  onClose,
  personId,
  personName,
  sex,
  isRoot,
  leaderName,
  cells,
  mayBackdate,
}: {
  open: boolean;
  onClose: () => void;
  personId: string;
  personName: string;
  sex: Sex;
  isRoot: boolean;
  /** Their pastoral leader now, or null when they have none. */
  leaderName: string | null;
  cells: PersonCells | undefined;
  mayBackdate: boolean;
}) {
  const queryClient = useQueryClient();
  const reasonId = useId();

  const to: Sex = sex === 'MALE' ? 'FEMALE' : 'MALE';
  // Never null for a recorded sex: the mapping is total (section 4).
  const from = networkOfSex(sex) as Network;
  const toNetwork = networkOfSex(to) as Network;

  const [reason, setReason] = useState('');
  const [leader, setLeader] = useState<{ id: string; full_name: string } | null>(null);
  const [date, setDate] = useState('');

  // Their direct disciples, so a correction that must wait for them says so first. Fifty is
  // more than any branch's direct disciples here; past it the API's refusal names the rest.
  const branch = useQuery({
    queryKey: ['branch', personId, 'correct-sex'],
    queryFn: ({ signal }) => getBranch(personId, undefined, signal, '50'),
    enabled: open && !isRoot,
    retry: false,
  });
  const disciples = branch.data?.data ?? [];
  const ledCells = cells?.leads ?? [];
  const blocked = isRoot || disciples.length > 0 || ledCells.length > 0;

  const save = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim();
      return correctSex(
        personId,
        {
          sex: to,
          reason: trimmed,
          ...(leader ? { pastoral_leader_id: leader.id } : {}),
          ...(date !== '' ? { effective_date: date } : {}),
        },
        idempotencyKeyFor('correct-sex', personId, to, trimmed, leader?.id ?? '', date),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['person', personId] });
      await queryClient.invalidateQueries({ queryKey: ['pastoral-path'] });
      await queryClient.invalidateQueries({ queryKey: ['person-cells', personId] });
      close();
    },
  });

  function close() {
    save.reset();
    setReason('');
    setLeader(null);
    setDate('');
    onClose();
  }

  const needsLeader = leaderName !== null;
  const ready = reason.trim() !== '' && (!needsLeader || leader !== null);
  const refusedNames = save.error instanceof ApiRequestError ? namedIn(save.error.details) : [];

  return (
    <Dialog open={open} onClose={close} title={`Correct ${personName}’s sex`}>
      <p className="text-sm">
        {sexLabel(sex)}, {networkLabel(from)} →{' '}
        <strong>
          {sexLabel(to)}, {networkLabel(toNetwork)}
        </strong>
      </p>

      {isRoot ? (
        <p className="mt-4 text-sm leading-relaxed">
          {personName} is a Network root, and a root’s sex is not corrected here. Who holds a
          Network root is decided for the Network.
        </p>
      ) : branch.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading…</p>
      ) : blocked ? (
        <div className="mt-4 text-sm leading-relaxed">
          <p>
            {personName} leads people in the {networkLabel(from)}. Move them first, then come
            back here.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {disciples.map((disciple) => (
              <li key={disciple.id}>
                <TextLink href={`/people/${disciple.id}`}>{disciple.full_name}</TextLink>
              </li>
            ))}
            {ledCells.map((cell) => (
              <li key={cell.id}>
                Leads <TextLink href={`/cells/${cell.id}/members`}>{cellShortName(cell)}</TextLink>
                {' '}· hand it over or close it
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) {
              save.mutate();
            }
          }}
        >
          <div>
            <label htmlFor={reasonId} className="field-label block">
              Why is it being corrected? (required)
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

          {needsLeader ? (
            <PersonPicker
              legend={`New Cell Leader in the ${networkLabel(toNetwork)}`}
              description={`Needed because ${leaderName}, who pastors them now, is in the ${networkLabel(from)}.`}
              network={toNetwork}
              networkReason={`${personName} moves to the ${networkLabel(toNetwork)}`}
              searchLabel="Search for a leader by name"
              selectedId={leader?.id ?? null}
              selectedName={leader?.full_name ?? null}
              onSelect={setLeader}
            />
          ) : null}

          {mayBackdate ? (
            <Field
              label="As of an earlier date (optional)"
              description="Leave it blank for now. An earlier date is recorded in the audit log."
              type="date"
              name="effective_date"
              autoComplete="off"
              max={todayInManila()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          ) : null}

          <FailureNotice failure={save.isError ? describeFailure(save.error) : null} />
          {refusedNames.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {refusedNames.map((named) => (
                <li key={named.id}>
                  <TextLink href={`/people/${named.id}`}>{named.full_name}</TextLink>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
            <Button type="submit" disabled={!ready || save.isPending}>
              {save.isPending ? 'Correcting…' : `Correct to ${sexLabel(to)}`}
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {blocked ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}

/** The disciples a refusal names (section 4), when it names any. */
function namedIn(details: Record<string, unknown>): Named[] {
  const disciples = details.disciples;

  return Array.isArray(disciples)
    ? disciples.filter(
        (entry): entry is Named =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Named).id === 'string' &&
          typeof (entry as Named).full_name === 'string',
      )
    : [];
}
