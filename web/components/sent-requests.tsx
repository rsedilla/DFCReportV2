'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { listSentRequests, type SentRequest } from '@/lib/cells';
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
 */
export function SentRequests() {
  const sent = useQuery({
    queryKey: ['sent-requests'],
    queryFn: ({ signal }) => listSentRequests(signal),
  });

  if (!sent.data || sent.data.length === 0) {
    return null;
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
            <span className="border-ink border px-2 py-1 text-xs font-bold tracking-[0.06em] uppercase">
              {STATE[request.state]}
              {request.state === 'APPROVED' && request.cell?.cell_id ? (
                <>
                  {' · '}
                  <Link href={`/cells/${request.cell.id}/meetings`} className={LINK}>
                    {request.cell.cell_id}
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function title(request: SentRequest): string {
  const name = request.prospective_leader.full_name;

  if (request.kind === 'HANDOVER') {
    return `Hand ${request.cell?.cell_id ?? 'a Cell'} to ${name}`;
  }

  return request.restart_of
    ? `Restart ${request.restart_of.cell_id ?? 'a closed Cell'} with ${name}`
    : `New Cell led by ${name}`;
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
