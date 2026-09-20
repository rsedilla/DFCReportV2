import { authenticatedRequest } from './session';

/**
 * What `GET /auth/me` says about the signed-in account (SKILL.md sections 6 and 7).
 *
 * **Nothing here decides what a user may do.** The API is the sole authority for
 * authorization and UI filtering is never sufficient on its own (section 1,
 * principle 4). What this is for is not offering a control that would only ever
 * be refused: a leader with no church-wide grant should not be shown a Whole
 * Church option that answers `SCOPE_DENIED` every time they pick it.
 *
 * The two readings are different and the difference matters. Hiding a control the
 * server would refuse is courtesy; *showing* one and treating the click as
 * permission would be the mistake principle 4 names.
 */
export interface GrantSummary {
  capability: string;
  scope_type: string;
  scope_network: string | null;
  read_only: boolean;
  source: string;
}

export interface SessionDescription {
  account_id: string;
  person_id: string;
  email: string | null;
  first_name: string | null;
  /**
   * The roles the server honours for this account (decision 0263).
   *
   * A list because `account_roles` permits more than one row; provisioning issues one,
   * which is a rule about provisioning rather than about this field. Empty where every
   * row an account holds is one this system refuses to honour.
   */
  roles: AccountRole[];
  capabilities: GrantSummary[];
}

export type AccountRole = 'ADMIN' | 'SENIOR_PASTOR' | 'LEADER';

/** Section 7's roles, in the words a leader would use for them. */
export function roleLabel(role: AccountRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'SENIOR_PASTOR':
      return 'Senior Pastor';
    case 'LEADER':
      return 'Leader';
    default:
      return role;
  }
}

export async function getMe(signal?: AbortSignal): Promise<SessionDescription> {
  return authenticatedRequest<SessionDescription>('/api/v1/auth/me', { signal });
}

/**
 * Whether this account advertises a church-wide grant of a capability.
 *
 * Read off the grant list rather than from a role, because section 7 makes the
 * capability and its scope the thing that decides. `/auth/me` names the account's role
 * since decision 0263, and it is still not what this asks: a role says which defaults
 * an account started with, and a grant says what it holds now.
 */
export function holdsWholeChurch(me: SessionDescription | undefined, capability: string): boolean {
  return (me?.capabilities ?? []).some(
    (grant) => grant.capability === capability && grant.scope_type === 'WHOLE_CHURCH',
  );
}
