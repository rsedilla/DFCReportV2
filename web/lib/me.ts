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
  capabilities: GrantSummary[];
}

export async function getMe(signal?: AbortSignal): Promise<SessionDescription> {
  return authenticatedRequest<SessionDescription>('/api/v1/auth/me', { signal });
}

/**
 * Whether this account advertises a church-wide grant of a capability.
 *
 * Read off the grant list rather than from a role, because section 7 makes the
 * capability and its scope the thing that decides, and `/auth/me` deliberately
 * returns no role at all.
 */
export function holdsWholeChurch(me: SessionDescription | undefined, capability: string): boolean {
  return (me?.capabilities ?? []).some(
    (grant) => grant.capability === capability && grant.scope_type === 'WHOLE_CHURCH',
  );
}
