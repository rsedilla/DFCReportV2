'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { InfoToggle } from '@/components/ui/info-toggle';
import {
  cellShortName,
  listSentRequests,
  type SentRequest,
  type SentRequestCell,
} from '@/lib/cells';
import { todayInManila } from '@/lib/reporting-month';

const LINK =
  'focus-visible:outline-accent text-accent inline-flex min-h-6 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2';

const DECLINE_REASON: Record<NonNullable<SentRequest['decline_reason']>, string> = {
  LEADER_DEVELOPMENT_CONTINUING: 'The leader is still being developed',
  TIMING_DEFERRED: 'The timing is deferred',
  DUPLICATE_REQUEST: 'Another request already covers it',
  SUBMITTED_IN_ERROR: 'Sent in error',
  OTHER: 'Other',
};

const STATE: Record<SentRequest['state'], string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

/**
 * "Your requests" on the Record page: the Cell leadership requests the reader sent,
 * pending or decided within 30 days (SKILL.md section 19, decision 0269).
 *
 * The state is an outlined word and never a colour (section 19). Nothing renders when
 * the reader has sent none, or while the list is loading or could not be read: the
 * block is the reader's own record, and an empty heading would claim there is one.
 *
 * `plain` is My Cell's shape (decision 0458): the leader's name and what was asked, as ruled
 * rows rather than boxes, the sentence about the list behind an ⓘ.
 */
export function SentRequests({ plain = false }: { plain?: boolean }) {
  const sent = useQuery({
    queryKey: ['sent-requests'],
    queryFn: ({ signal }) => listSentRequests(signal),
  });

  if (!sent.data || sent.data.length === 0) {
    return null;
  }

  if (plain) {
    return (
      <section className="mt-7" aria-labelledby="sent-requests-heading">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 id="sent-requests-heading" className="field-label">
            Your requests
          </h2>
          <InfoToggle label="About your requests" small inline>
            Cell leadership requests you sent. Shown until a month after they&rsquo;re decided.
          </InfoToggle>
        </div>
        <ul className="mt-2">
          {sent.data.map((request) => (
            <li
              key={request.id}
              className="border-line flex flex-col items-start gap-2 border-t py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">{request.prospective_leader.full_name}</p>
                <p className="text-muted mt-0.5 text-sm">{plainLine(request)}</p>
              </div>
              <State request={request} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="mt-10" aria-labelledby="sent-requests-heading">
      <h2 id="sent-requests-heading" className="text-lg font-bold tracking-tight">
        Your requests
      </h2>
      <p className="text-muted mt-1 max-w-2xl text-sm leading-relaxed">
        Cell leadership requests you sent. Shown until a month after they&rsquo;re decided.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {sent.data.map((request) => (
          <li
            key={request.id}
            className="border-line flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border p-4"
          >
            <div>
              <p className="font-medium">{title(request)}</p>
              <p className="text-muted mt-1 text-sm">{subline(request)}</p>
            </div>
            <State request={request} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where a request stands, an outlined word (section 19), and the Cell an approval opened. */
function State({ request }: { request: SentRequest }) {
  return (
    <span className="bg-accent-tint text-ink rounded-full px-3 py-1 text-sm font-semibold">
      {STATE[request.state]}
      {request.state === 'APPROVED' && request.cell?.cell_id ? (
        <>
          {' · '}
          <Link href={`/cells/${request.cell.id}/meetings`} className={LINK}>
            {nameOf(request.cell)}
          </Link>
        </>
      ) : null}
    </span>
  );
}

/** What was asked and where it stands, under the leader's name: "New Cell · approved 19 Oct". */
function plainLine(request: SentRequest): string {
  const asked =
    request.kind === 'HANDOVER'
      ? `Hand over ${request.cell ? nameOf(request.cell) : 'a Cell'}`
      : request.restart_of
        ? `Restart ${nameOf(request.restart_of)}`
        : 'New Cell';

  if (request.decided_at === null) {
    return `${asked} · sent ${day(request.requested_at)}`;
  }

  if (request.state === 'APPROVED') {
    return `${asked} · approved ${day(request.decided_at)}`;
  }

  const reason = request.decline_reason ? DECLINE_REASON[request.decline_reason] : null;
  const why = [reason, request.note].filter((part) => part).join(': ');

  return `${asked} · declined ${day(request.decided_at)}${why ? ` · ${why}` : ''}`;
}

function title(request: SentRequest): string {
  const name = request.prospective_leader.full_name;

  if (request.kind === 'HANDOVER') {
    return `Hand ${request.cell ? nameOf(request.cell) : 'a Cell'} to ${name}`;
  }

  return request.restart_of
    ? `Restart ${nameOf(request.restart_of)} with ${name}`
    : `New Cell led by ${name}`;
}

/**
 * "Young Pro · Sat", the way a list names a Cell; its code is shown on its own page and where
 * one is chosen (decision 0306), and only where there is no category or day to name it by.
 */
function nameOf(cell: SentRequestCell): string {
  return cellShortName({
    cell_id: cell.cell_id ?? 'a Cell',
    category: cell.category ?? null,
    day_of_week: cell.day_of_week ?? null,
  });
}

function subline(request: SentRequest): string {
  const sentOn = `Sent ${day(request.requested_at)}`;

  if (request.decided_at === null) {
    return sentOn;
  }

  if (request.state === 'APPROVED') {
    return `${sentOn} · approved ${day(request.decided_at)}`;
  }

  const reason = request.decline_reason ? DECLINE_REASON[request.decline_reason] : null;
  const why = [reason, request.note].filter((part) => part).join(': ');

  return `${sentOn} · declined ${day(request.decided_at)}${why ? ` · ${why}` : ''}`;
}

/** "21 Sept", the Manila day of an instant, as the meeting form writes it. */
function day(instant: string): string {
  return new Date(`${todayInManila(new Date(instant))}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
