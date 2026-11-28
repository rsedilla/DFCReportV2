import { authenticatedRequest } from './session';

/**
 * Account administration as this client sees it (SKILL.md sections 6 and 22; decision
 * 0276): whether a person has an account, giving them one, and resending its activation
 * email. All three need `accounts.manage`, which the API checks.
 */

export type AccountRole = 'ADMIN' | 'SENIOR_PASTOR' | 'LEADER' | 'REGISTRAR';

export interface PersonAccount {
  id: string;
  email: string;
  /** Set only by the holder; shown here so an administrator can tell them (decision 0337). */
  username: string | null;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';
  roles: AccountRole[];
  created_at: string;
  /** Archiving the record disables it, with no choice offered (decision 0499). Absent from older servers. */
  disabled_with_record?: boolean;
  /** Whether it signs in with a second step, and since when (decision 0302). */
  second_step: { required: boolean; set_up_at: string | null };
  /** Full view (decision 0323); meaningful on a Leader account only. */
  full_view: boolean;
  /** Approves Cells (decision 0352); meaningful on a Leader account only. */
  approves_cells: boolean;
  /** Moves people (decision 0356); meaningful on a Leader account only. */
  moves_people: boolean;
  /** Life Class Coordinator (decision 0501); meaningful on a Leader account only. */
  coordinates_life_class?: boolean;
  /** SOL 1 Coordinator (decision 0514); meaningful on a Leader account only. */
  coordinates_sol_1?: boolean;
  /** SOL 2 Coordinator (decision 0516); meaningful on a Leader account only. */
  coordinates_sol_2?: boolean;
  /**
   * When the holder ticked the Privacy Notice in force, or null where they have not (decision
   * 0496). Absent from a server that predates it.
   */
  privacy_notice_acknowledged_at?: string | null;
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

/** Ticks or clears SOL 1 Coordinator on a Leader account (decision 0514). Needs `roles.manage`. */
export function setCoordinatesSol1(
  accountId: string,
  coordinates: boolean,
  idempotencyKey: string,
): Promise<{ id: string; coordinates_sol_1: boolean }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/coordinates-sol-1`, {
    method: 'POST',
    body: { coordinates_sol_1: coordinates },
    idempotencyKey,
  });
}

/** Ticks or clears SOL 2 Coordinator on a Leader account (decision 0516). Needs `roles.manage`. */
export function setCoordinatesSol2(
  accountId: string,
  coordinates: boolean,
  idempotencyKey: string,
): Promise<{ id: string; coordinates_sol_2: boolean }> {
  return authenticatedRequest(`/api/v1/accounts/${encodeURIComponent(accountId)}/coordinates-sol-2`, {
    method: 'POST',
    body: { coordinates_sol_2: coordinates },
    idempotencyKey,
  });
}

/** One level's Coordinators, for the Admin's Coordinators list (decision 0514). */
export interface LevelCoordinators {
  level: 'LIFE_CLASS' | 'SOL_1' | 'SOL_2';
  people: { account_id: string; person_id: string; name: string }[];
}

/** Who coordinates each level (decision 0514), the Admin's alone. */
export function getCoordinators(): Promise<{ data: LevelCoordinators[] }> {
  return authenticatedRequest('/api/v1/accounts/coordinators');
}

/** Ticks or clears Life Class Coordinator on a Leader account (decision 0501). Needs `roles.manage`. */
export async function setCoordinatesLifeClass(
  accountId: string,
  coordinates: boolean,
  idempotencyKey: string,
): Promise<{ id: string; coordinates_life_class: boolean }> {
  return authenticatedRequest(
    `/api/v1/accounts/${encodeURIComponent(accountId)}/coordinates-life-class`,
    { method: 'POST', body: { coordinates_life_class: coordinates }, idempotencyKey },
  );
}

export function accountStatusLabel(status: PersonAccount['status']): string {
  return status === 'PENDING_ACTIVATION'
    ? 'Waiting for activation'
    : status === 'ACTIVE'
      ? 'Active'
      : 'Disabled';
}

/** The Admin area's Accounts filters (decision 0419); `ALL` is every account. */
export const ACCOUNT_FILTERS = [
  'ALL',
  'ACTIVE',
  'PENDING_ACTIVATION',
  'PAUSED',
  'NO_SECOND_STEP',
  'DISABLED',
] as const;

export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];

/** One row of the Admin area's Accounts list (decision 0419). */
export interface AccountListRow {
  account_id: string;
  person_id: string;
  name: string;
  email: string;
  username: string | null;
  roles: AccountRole[];
  status: PersonAccount['status'];
  created_at: string;
  /** Sign-in paused after ten wrong passwords (decision 0413), until this instant. */
  paused_until: string | null;
  second_step: { required: boolean; set_up_at: string | null };
  full_view: boolean;
  approves_cells: boolean;
  moves_people: boolean;
  coordinates_life_class?: boolean;
  coordinates_sol_1?: boolean;
  coordinates_sol_2?: boolean;
}

export async function listAccounts(
  params: { q?: string; filter?: AccountFilter; cursor?: string | null },
  signal?: AbortSignal,
): Promise<{ data: AccountListRow[]; next_cursor: string | null }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.filter && params.filter !== 'ALL') query.set('filter', params.filter);
  if (params.cursor) query.set('cursor', params.cursor);
  const suffix = query.toString();
  return authenticatedRequest(`/api/v1/accounts${suffix ? `?${suffix}` : ''}`, { signal });
}

/** How many accounts each filter holds, keyed by the filter in lower case. */
export type AccountCounts = Record<Lowercase<AccountFilter>, number>;

export async function getAccountCounts(signal?: AbortSignal): Promise<AccountCounts> {
  return authenticatedRequest<AccountCounts>('/api/v1/accounts/counts', { signal });
}
