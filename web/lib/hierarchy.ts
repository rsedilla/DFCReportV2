import { authenticatedRequest } from './session';

/**
 * A person's place in the pastoral tree (SKILL.md sections 5 and 8).
 *
 * **The path runs root first, down to the person**, and says which end is a root
 * (decision 0131). A chain that did not say so would read the same whether it
 * reached a Network root or simply ran out of people the viewer may see, and those
 * are different facts.
 */
export interface PathEntry {
  id: string;
  member_id: string;
  full_name: string;
  /** True only on the first entry, and only where that person holds a root seat. */
  network_root: boolean;
}

export interface PastoralPath {
  data: PathEntry[];
  next_cursor: string | null;
}

/** The person's direct pastoral leader: the entry above them on the path, or null. */
export function directLeaderOf(path: readonly PathEntry[]): PathEntry | null {
  return path.length >= 2 ? path[path.length - 2] : null;
}

/**
 * What to say where nobody is above the person on the path.
 *
 * A Network root and a Person with no assignment both produce a one-entry path, and only
 * `network_root` tells them apart (decision 0131), so the words follow the flag.
 */
export function noLeaderLabel(path: readonly PathEntry[]): string {
  return path[0]?.network_root ? 'Network root' : 'No pastoral leader yet';
}

export async function getPastoralPath(
  personId: string,
  signal?: AbortSignal,
): Promise<PastoralPath> {
  return authenticatedRequest<PastoralPath>(`/api/v1/people/${personId}/pastoral-path`, {
    signal,
  });
}

/**
 * Move a person to a different pastoral leader (section 5).
 *
 * **This is the highest-risk authorization surface in the system**, and none of
 * that risk is managed here. Section 5 refuses a leader outside the actor's own
 * subtree in either direction, refuses the actor changing their own assignment or
 * anyone upline of them, refuses a cycle, refuses a cross-Network edge, and
 * refuses an archived Person — and backdating an effective date additionally
 * requires its own capability. Every one of those is the API's, tested there, and
 * a client that tried to anticipate them would be building half the rule.
 *
 * `effective_date` is deliberately not offered by the screen that calls this. A
 * backdated assignment rewrites which subtree a person belonged to in periods
 * that may already be closed, which section 5 gates behind a separate capability
 * and an audit entry; a date field on an ordinary reassignment form invites
 * somebody to reach for it without knowing that.
 */
export async function reassignPastoralLeader(
  personId: string,
  pastoralLeaderId: string,
  reason: string | undefined,
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest<unknown>(`/api/v1/people/${personId}/pastoral-leader`, {
    method: 'PUT',
    body: { pastoral_leader_id: pastoralLeaderId, ...(reason ? { reason } : {}) },
    idempotencyKey,
  });
}
