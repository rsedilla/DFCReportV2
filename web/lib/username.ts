import { apiRequest } from './api-client';
import { authenticatedRequest } from './session';

/**
 * Usernames (SKILL.md section 6, decision 0337): a suggestion, and the holder setting their
 * own. Sign-in takes the username or the email address.
 */

/** A suggested username, and the plain one it moved from where that was taken. */
export interface UsernameSuggestion {
  username: string;
  taken: string | null;
}

/** At activation, where the activation token is the credential. Does not use it up. */
export async function suggestActivationUsername(token: string): Promise<UsernameSuggestion> {
  return apiRequest<UsernameSuggestion>('/api/v1/auth/activate/username-suggestion', {
    method: 'POST',
    body: { token },
  });
}

/** The signed-in person's own suggestion. */
export async function getUsernameSuggestion(signal?: AbortSignal): Promise<UsernameSuggestion> {
  return authenticatedRequest('/api/v1/auth/username-suggestion', { signal });
}

/** Sets or changes the signed-in person's own username. */
export async function setOwnUsername(
  username: string,
  idempotencyKey: string,
): Promise<{ username: string }> {
  return authenticatedRequest('/api/v1/auth/username', {
    method: 'POST',
    body: { username },
    idempotencyKey,
  });
}

/** What the field says under a suggestion (decision 0337, point 4). */
export function usernameHint(taken: string | null): string {
  return taken === null
    ? 'Suggested from your name. You can change it. Sign in with it or with your email address.'
    : `Suggested from your name. ${taken} is already taken, so a number was added. You can change it.`;
}
