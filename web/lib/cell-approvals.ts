import { authenticatedRequest } from './session';

import type { CellCategory } from './cells';

/** A person as the approval queue names them. */
export interface QueuePerson {
  person_id: string;
  full_name: string;
  member_id: string;
}

/**
 * A Cell leadership request waiting for a decision, as the approver reads it (SKILL.md
 * section 10, decisions 0352 and 0353): only the requests this reader may decide.
 */
export interface ApprovalRequest {
  id: string;
  kind: 'NEW_CELL' | 'HANDOVER';
  /** A new Cell that resumes a closed one (decision 0264). */
  restart: boolean;
  requested_at: string;
  prospective_leader: QueuePerson;
  /** Who sent it; null where the sending account has no Person, which provisioning forbids. */
  requested_by_person: QueuePerson | null;
  /** What a new Cell asks for, or a handover's Cell as it stands. */
  cell: {
    cell_id: string | null;
    category: CellCategory | null;
    day_of_week: number | null;
    time_of_day: string | null;
  };
  /** A handover's present leader. */
  outgoing_leader: QueuePerson | null;
  /** The three members a new Cell is asked with (decision 0353); none on an older request. */
  members: QueuePerson[];
  /** The leader whose branch it is in, directly under a Network root. */
  branch_of: QueuePerson | null;
}

export type DeclineReason =
  | 'LEADER_DEVELOPMENT_CONTINUING'
  | 'TIMING_DEFERRED'
  | 'DUPLICATE_REQUEST'
  | 'SUBMITTED_IN_ERROR'
  | 'OTHER';

export const DECLINE_REASONS: readonly { value: DeclineReason; label: string }[] = [
  { value: 'LEADER_DEVELOPMENT_CONTINUING', label: 'Still being developed as a leader' },
  { value: 'TIMING_DEFERRED', label: 'Not the right time yet' },
  { value: 'DUPLICATE_REQUEST', label: 'Already asked for' },
  { value: 'SUBMITTED_IN_ERROR', label: 'Sent by mistake' },
  { value: 'OTHER', label: 'Other (say why)' },
];

/**
 * The requests the reader may decide: their own branch, or the whole church for an Admin.
 * Every page, so the tab's count and its list never stop at the first 50 (decision 0352).
 */
export async function listApprovalRequests(signal?: AbortSignal): Promise<ApprovalRequest[]> {
  const all: ApprovalRequest[] = [];
  let cursor: string | null = null;

  do {
    const query: string = cursor === null ? '?limit=200' : `?limit=200&cursor=${encodeURIComponent(cursor)}`;
    const page: { data: ApprovalRequest[]; next_cursor: string | null } = await authenticatedRequest(
      `/api/v1/cells/leadership-requests${query}`,
      { signal },
    );
    all.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor !== null);

  return all;
}

export async function approveRequest(id: string, idempotencyKey: string): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/cells/leadership-requests/${id}/approve`, {
    method: 'POST',
    body: {},
    idempotencyKey,
  });
}

export async function declineRequest(
  id: string,
  reason: DeclineReason,
  note: string | null,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/cells/leadership-requests/${id}/decline`, {
    method: 'POST',
    body: { reason, note: note ?? undefined },
    idempotencyKey,
  });
}
