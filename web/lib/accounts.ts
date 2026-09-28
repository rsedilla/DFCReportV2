import { authenticatedRequest } from './session';

/**
 * Account administration as this client sees it (SKILL.md sections 6 and 22; decision
 * 0276): whether a person has an account, giving them one, and resending its activation
 * email. All three need `accounts.manage`, which the API checks.
 */

export type AccountRole = 'ADMIN' | 'SENIOR_PASTOR' | 'LEADER';

export interface PersonAccount {
  id: string;
  email: string;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';
  roles: AccountRole[];
  created_at: string;
  /** Whether it signs in with a second step, and since when (decision 0302). */
  second_step: { required: boolean; set_up_at: string | null };
}

export async function getAccountForPerson(
  personId: string,
  signal?: AbortSignal,
): Promise<{ account: PersonAccount | null }> {
  return authenticatedRequest(`/api/v1/accounts/for-person/${personId}`, { signal });
}

/** The key is the caller's, for the reason `createPerson` gives. */
export async function provisionAccount(
  input: { person_id: string; email: string; role: AccountRole },
  idempotencyKey: string,
): Promise<unknown> {
  return authenticatedRequest('/api/v1/accounts', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

export async function resendActivation(accountId: string, idempotencyKey: string): Promise<void> {
  return authenticatedRequest(`/api/v1/accounts/${accountId}/activation-email`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** Corrects an unactivated account's address and sends the email there (decision 0300). */
export async function correctAccountEmail(
  accountId: string,
  email: string,
  idempotencyKey: string,
): Promise<{ id: string; email: string; status: PersonAccount['status'] }> {
  return authenticatedRequest(`/api/v1/accounts/${accountId}/email`, {
    method: 'POST',
    body: { email },
    idempotencyKey,
  });
}

/**
 * Resets a Senior Pastor's second sign-in step, ending their sessions (decision 0302).
 * The API refuses an administrator's, which is reset on the server.
 */
export async function resetSecondStep(accountId: string, idempotencyKey: string): Promise<void> {
  return authenticatedRequest(`/api/v1/accounts/${accountId}/second-step/reset`, {
    method: 'POST',
    idempotencyKey,
  });
}

export function roleLabel(role: AccountRole): string {
  return role === 'ADMIN' ? 'Admin' : role === 'SENIOR_PASTOR' ? 'Senior Pastor' : 'Leader';
}

export function accountStatusLabel(status: PersonAccount['status']): string {
  return status === 'PENDING_ACTIVATION'
    ? 'Waiting for activation'
    : status === 'ACTIVE'
      ? 'Active'
      : 'Disabled';
}
