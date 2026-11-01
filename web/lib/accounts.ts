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
  /** Set only by the holder; shown here so an administrator can tell them (decision 0337). */
  username: string | null;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';
  roles: AccountRole[];
  created_at: string;
  /** Whether it signs in with a second step, and since when (decision 0302). */
  second_step: { required: boolean; set_up_at: string | null };
  /** Full view (decision 0323); meaningful on a Leader account only. */
  full_view: boolean;
  /** Approves Cells (decision 0352); meaningful on a Leader account only. */
  approves_cells: boolean;
  /** Moves people (decision 0356); meaningful on a Leader account only. */
  moves_people: boolean;
}

export async function getAccountForPerson(
  personId: string,
  signal?: AbortSignal,
): Promise<{ account: PersonAccount | null }> {
  return authenticatedRequest(`/api/v1/accounts/for-person/${encodeURIComponent(personId)}`, { signal });
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
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/activation-email`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** Emails an account in use a password reset link, at its own address (decision 0393). */
export async function sendPasswordReset(accountId: string, idempotencyKey: string): Promise<void> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/password-reset-email`, {
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
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/email`, {
    method: 'POST',
    body: { email },
    idempotencyKey,
  });
}

/**
 * Starts an account in use over at a new address, for someone who has lost the mailbox
 * (decision 0415): signed out, password removed, an activation link to the new address.
 */
export async function restartAccountAtEmail(
  accountId: string,
  email: string,
  idempotencyKey: string,
): Promise<{ id: string; email: string; status: PersonAccount['status'] }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/email`, {
    method: 'POST',
    body: { email, restart: true },
    idempotencyKey,
  });
}

/**
 * Resets a Senior Pastor's second sign-in step, ending their sessions (decision 0302).
 * The API refuses an administrator's, which is reset on the server.
 */
export async function resetSecondStep(accountId: string, idempotencyKey: string): Promise<void> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/second-step/reset`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** Disables an account or re-enables it (decision 0307). The API refuses the caller's own. */
export async function setAccountAccess(
  accountId: string,
  action: 'disable' | 'reactivate',
  idempotencyKey: string,
): Promise<{ id: string; status: PersonAccount['status'] }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/${action}`, {
    method: 'POST',
    idempotencyKey,
  });
}

/** Ticks or clears Full view on a Leader account (decision 0323). Needs `roles.manage`. */
export async function setFullView(
  accountId: string,
  fullView: boolean,
  idempotencyKey: string,
): Promise<{ id: string; full_view: boolean }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/full-view`, {
    method: 'POST',
    body: { full_view: fullView },
    idempotencyKey,
  });
}

/** Ticks or clears Approves Cells on a Leader account (decision 0352). Needs `roles.manage`. */
export async function setApprovesCells(
  accountId: string,
  approvesCells: boolean,
  idempotencyKey: string,
): Promise<{ id: string; approves_cells: boolean }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/approves-cells`, {
    method: 'POST',
    body: { approves_cells: approvesCells },
    idempotencyKey,
  });
}

/** Ticks or clears Moves people on a Leader account (decision 0356). Needs `roles.manage`. */
export async function setMovesPeople(
  accountId: string,
  movesPeople: boolean,
  idempotencyKey: string,
): Promise<{ id: string; moves_people: boolean }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/moves-people`, {
    method: 'POST',
    body: { moves_people: movesPeople },
    idempotencyKey,
  });
}

export function accountStatusLabel(status: PersonAccount['status']): string {
  return status === 'PENDING_ACTIVATION'
    ? 'Waiting for activation'
    : status === 'ACTIVE'
      ? 'Active'
      : 'Disabled';
}
