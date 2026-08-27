import { ApiRequestError } from './api-client';

/**
 * Turn a failure into something worth showing a leader.
 *
 * SKILL.md section 22: branch on `code`, never on `message`. The codes are
 * stable across the life of `/api/v1` and the wording is not, so anything this
 * client *decides* on reads the code. Where there is nothing to decide, the
 * API's own `message` is shown, which section 22 states is human-readable and
 * safe to display — inventing a second wording here would mean three clients
 * saying three different things about one refusal.
 *
 * `UNAUTHENTICATED` is the one case where the API's wording is deliberately not
 * used. A sign-in form is the place where a precise message becomes an account
 * enumeration oracle, and section 6 already requires the password-reset path to
 * answer identically whether or not the address exists.
 */
export function messageFor(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) {
    // A network failure, a DNS failure, or the client being offline. None of
    // these came from the API and none carries a code.
    return 'Could not reach the server. Check your connection and try again.';
  }

  switch (error.code) {
    case 'UNAUTHENTICATED':
      return fallback;
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute and try again.';
    case 'RESOURCE_BUSY':
    case 'REQUEST_IN_FLIGHT':
      // Section 22 defines both as "retry after a short delay", so the wording
      // says that rather than presenting a transient wait as a refusal.
      return 'The server is busy. Try again in a moment.';
    case 'INTERNAL_ERROR':
      return 'Something went wrong at our end. Try again shortly.';
    default:
      return error.message;
  }
}
