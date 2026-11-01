'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FailureNotice } from '@/components/ui/failure-notice';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import {
  approveRequest,
  DECLINE_REASONS,
  declineRequest,
  listApprovalRequests,
  type ApprovalRequest,
  type DeclineReason,
} from '@/lib/cell-approvals';
import { categoryLabel, dayOfWeekLabel, timeLabel } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { todayInManila } from '@/lib/reporting-month';

/**
 * Cells to Approve, the third tab of the Cells page (SKILL.md section 10, decisions 0352 and
 * 0353): the Cell leadership requests the reader may decide, oldest first. An account ticked
 * Approves Cells sees those of its own branch; an Admin the whole church, each request naming
 * whose branch it is in. Approving creates the Cell at once, with its three members;
 * declining asks for one of section 10's fixed reasons.
 */
export function CellApprovals({ wholeChurch }: { wholeChurch: boolean }) {
  const requests = useQuery({
    queryKey: ['cell-approvals'],
    queryFn: ({ signal }) => listApprovalRequests(signal),
  });

  return (
    <section className="min-w-0 pt-5" aria-labelledby="approvals-heading">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="approvals-heading" className="text-lg font-bold tracking-tight">
          Cells to Approve
        </h2>
        <p className="text-muted text-sm">
          {wholeChurch
            ? 'Requests for a new Cell, a handover or a restart, across the church, oldest first.'
            : 'Requests for a new Cell, a handover or a restart in your branch, oldest first.'}
        </p>
      </div>

      <div className="mt-4">
        <FailureNotice failure={requests.isError ? describeFailure(requests.error) : null} />
      </div>

      {requests.isPending ? (
        <p className="text-muted mt-4 text-sm">Loading&hellip;</p>
      ) : requests.data && requests.data.length === 0 ? (
        <p className="text-muted mt-4 text-sm">Nothing waiting for you to approve.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {(requests.data ?? []).map((request) => (
            <ApprovalCard key={request.id} request={request} wholeChurch={wholeChurch} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ApprovalCard({ request, wholeChurch }: { request: ApprovalRequest; wholeChurch: boolean }) {
  const queryClient = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | ''>('');
  const [note, setNote] = useState('');

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cell-approvals'] });
    await queryClient.invalidateQueries({ queryKey: ['cells'] });
  };
  const approve = useMutation({
    mutationFn: () => approveRequest(request.id, idempotencyKeyFor('approve', request.id)),
    onSuccess: done,
  });
  const decline = useMutation({
    mutationFn: () =>
      declineRequest(
        request.id,
        reason as DeclineReason,
        note.trim() === '' ? null : note.trim(),
        idempotencyKeyFor('decline', request.id, reason, note.trim()),
      ),
    onSuccess: done,
  });
  const failed = approve.isError ? approve.error : decline.isError ? decline.error : null;
  const busy = approve.isPending || decline.isPending;

  return (
    <li className="border-line border p-4">
      <p className="font-medium">{title(request)}</p>
      <p className="text-muted mt-1 text-sm">
        {cellLine(request)}
        {request.requested_by_person ? ` · asked by ${request.requested_by_person.full_name}` : ''}{' '}
        · sent{' '}
        {day(request.requested_at)}
      </p>
      {wholeChurch && request.branch_of ? (
        <p className="text-muted mt-1 text-sm">In {request.branch_of.full_name}&rsquo;s branch</p>
      ) : null}
      {request.members.length > 0 ? (
        <p className="mt-2 text-sm">
          <span className="font-bold">Members:</span>{' '}
          {request.members.map((member) => member.full_name).join(', ')}
        </p>
      ) : null}

      <div className="mt-3">
        <FailureNotice failure={failed ? describeFailure(failed) : null} />
      </div>

      {declining ? (
        <div className="border-line mt-3 flex flex-col gap-4 border-t pt-4">
          <RadioGroup
            legend="Why is it declined?"
            name={`reason-${request.id}`}
            value={reason}
            onChange={setReason}
            options={DECLINE_REASONS.map(({ value, label }) => ({ value, label }))}
          />
          {reason === 'OTHER' ? (
            <Field
              label="Say why"
              name={`note-${request.id}`}
              autoComplete="off"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              disabled={busy || reason === '' || (reason === 'OTHER' && note.trim() === '')}
              onClick={() => decline.mutate()}
            >
              {decline.isPending ? 'Declining…' : 'Decline'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Button disabled={busy} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}

function title(request: ApprovalRequest): string {
  const leader = request.prospective_leader.full_name;
  const cell =
    request.cell.category !== null && request.cell.day_of_week !== null
      ? `${categoryLabel(request.cell.category)} · ${dayOfWeekLabel(request.cell.day_of_week).slice(0, 3)}`
      : (request.cell.cell_id ?? 'the Cell');

  if (request.kind === 'HANDOVER') {
    return `Hand ${cell} to ${leader}`;
  }
  return request.restart ? `Restart ${cell} with ${leader}` : `New Cell led by ${leader}`;
}

function cellLine(request: ApprovalRequest): string {
  const { category, day_of_week: dayOfWeek, time_of_day: time } = request.cell;
  const meets =
    category !== null && dayOfWeek !== null
      ? `${categoryLabel(category)}, ${dayOfWeekLabel(dayOfWeek)}s${time === null ? '' : ` at ${timeLabel(time)}`}`
      : (request.cell.cell_id ?? '');
  return request.kind === 'HANDOVER' && request.outgoing_leader
    ? `${meets}, now led by ${request.outgoing_leader.full_name}`
    : meets;
}

/** "14 Oct", the Manila day of an instant. */
function day(instant: string): string {
  return new Date(`${todayInManila(new Date(instant))}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
