import { authenticatedRequest } from './session';

/**
 * The Privacy Notice this website shows, named by its "Last updated" date (decision 0496).
 *
 * Sent by the activation page, which has no session to ask the API which notice is in force.
 * The API's `PRIVACY_NOTICE_VERSION` is the authority and refuses a tick against any other date,
 * so this copy moves with it and with the wording of `app/privacy/page.tsx`, in one change.
 * *Before you continue* sends the date `/auth/me` names instead.
 */
export const PRIVACY_NOTICE_VERSION = '2026-11-16';

/**
 * The caller ticks that they read the notice `/auth/me` names as in force, so the two never
 * disagree. The key is the caller's (decision 0127).
 */
export async function acknowledgePrivacyNotice(
  version: string,
  idempotencyKey: string,
): Promise<{ version: string; acknowledged_at: string }> {
  return authenticatedRequest('/api/v1/auth/privacy-notice', {
    method: 'POST',
    body: { version },
    idempotencyKey,
  });
}
