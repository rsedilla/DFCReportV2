import { apiRequest } from './api-client';
import { authenticatedRequest } from './session';

/**
 * Changing the email of an account in use (SKILL.md section 6, decision 0415): the holder
 * asks, and confirms from the link sent to the new address.
 */

/** Asks for a link at the new address, giving the current password. Nothing changes yet. */
export async function requestOwnEmailChange(
  newEmail: string,
  currentPassword: string,
  idempotencyKey: string,
): Promise<void> {
  await authenticatedRequest<void>('/api/v1/auth/email', {
    method: 'POST',
    body: { new_email: newEmail, current_password: currentPassword },
    idempotencyKey,
  });
}

/** Confirms the new address from its link, where the link is the credential. */
export async function confirmEmailChange(token: string): Promise<{ email: string }> {
  return apiRequest<{ email: string }>('/api/v1/auth/email/confirm', {
    method: 'POST',
    body: { token },
  });
}
