'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  type QueuePerson,
} from '@/lib/cell-approvals';
import { categoryLabel, dayOfWeekLabel, timeLabel } from '@/lib/cells';
import { idempotencyKeyFor } from '@/lib/idempotency';
import { describeFailure } from '@/lib/messages';
import { todayInManila } from '@/lib/reporting-month';
import { LoadingBlocks } from '@/components/ui/loading-blocks';

/**
 * Cells to Approve, the third tab of the Cells page (SKILL.md section 10, decisions 0352 and
 * 0353): the Cell leadership requests the reader may decide, oldest first. An account ticked
 * Approves Cells sees those of its own branch; an Admin the whole church, each request naming
 * whose branch it is in. Approving creates the Cell at once, with its three members;
 * declining asks for one of section 10's fixed reasons.
 *
 * **Each request reads as plain text, and Approve asks once** (owner, 2026-11-06): the leader,
 * the group, when it meets, who asked, and the members one per line, each with their Member ID,
 * so the approver sees who is in the Cell; then "Create this Cell now?" with Yes and Back, so a
 * stray tap creates nothing.
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
        <LoadingBlocks shape="rows" className="mt-4" />
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
  const [confirming, setConfirming] = useState(false);
  const question = useRef<HTMLParagraphElement>(null);
  // The question takes focus when it appears, so a keyboard or screen reader lands on it.
  useEffect(() => {
    if (confirming) question.current?.focus();
  }, [confirming]);
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
      <h3 className="text-[1.0625rem] font-bold">{title(request)}</h3>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.9375rem]">
        {details(request, wholeChurch).map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {request.members.length > 0 ? (
        <>
          <h4 className="mt-4 text-[0.9375rem] font-bold">Members ({request.members.length})</h4>
          <ol className="mt-1.5 list-decimal pl-6 text-[0.9375rem] leading-relaxed">
            {request.members.map((member) => (
              <li key={member.person_id}>
                <Named person={member} />
              </li>
            ))}
          </ol>
        </>
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
      ) : confirming ? (
        <div className="border-line mt-4 flex flex-col gap-3 border-t pt-4">
          <p ref={question} tabIndex={-1} className="font-bold focus:outline-none">
            {confirmQuestion(request)}
          </p>
          <p className="text-muted text-sm leading-relaxed">{confirmLine(request)}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={busy} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : 'Yes, approve'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button disabled={busy} onClick={() => setConfirming(true)}>
            Approve
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
  const cell = request.cell.cell_id;
  if (request.kind === 'HANDOVER') {
    return cell === null ? 'Handover' : `Hand over ${cell}`;
  }
  if (request.restart) {
    return cell === null ? 'Restart a closed Cell' : `Restart ${cell}`;
  }
  return 'New Cell';
}

/** A person by name, their Member ID after it in grey and kept whole. */
function Named({ person }: { person: QueuePerson }) {
  return (
    <>
      {person.full_name}{' '}
      <span className="text-muted whitespace-nowrap">&middot; {person.member_id}</span>
    </>
  );
}

/** The request's lines, in reading order, each a term and its value. */
function details(request: ApprovalRequest, wholeChurch: boolean): [string, ReactNode][] {
  const { category, day_of_week: dayOfWeek, time_of_day: time } = request.cell;
  const rows: [string, ReactNode][] = [];

  if (request.kind === 'HANDOVER') {
    if (request.outgoing_leader) {
      rows.push(['Led now by', <Named key="now" person={request.outgoing_leader} />]);
    }
    rows.push(['New leader', <Named key="new" person={request.prospective_leader} />]);
  } else {
    rows.push(['Leader', <Named key="leader" person={request.prospective_leader} />]);
  }
  if (category !== null) {
    rows.push(['Group', categoryLabel(category)]);
  }
  if (dayOfWeek !== null) {
    rows.push(['Meets', `${dayOfWeekLabel(dayOfWeek)}s${time === null ? '' : ` at ${timeLabel(time)}`}`]);
  }
  rows.push([
    'Asked by',
    request.requested_by_person
      ? `${request.requested_by_person.full_name}, ${day(request.requested_at)}`
      : day(request.requested_at),
  ]);
  if (wholeChurch && request.branch_of) {
    rows.push(['Branch', `${request.branch_of.full_name}’s`]);
  }
  return rows;
}

function confirmQuestion(request: ApprovalRequest): string {
  if (request.kind === 'HANDOVER') return 'Hand this Cell over now?';
  return request.restart ? 'Restart this Cell now?' : 'Create this Cell now?';
}

function confirmLine(request: ApprovalRequest): string {
  const leader = request.prospective_leader.full_name;
  if (request.kind === 'HANDOVER') {
    return request.outgoing_leader
      ? `${leader} becomes its leader in place of ${request.outgoing_leader.full_name}.`
      : `${leader} becomes its leader.`;
  }
  const count = request.members.length;
  if (count === 0) return `${leader} becomes its leader.`;
  return `${leader} becomes its leader, with the ${count === 1 ? 'member' : `${count} members`} above.`;
}

/** "14 Oct", the Manila day of an instant. */
function day(instant: string): string {
  return new Date(`${todayInManila(new Date(instant))}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
