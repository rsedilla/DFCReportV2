import { ApiRequestError } from './api-client';

/**
 * What to tell a leader when something fails, and whether it is about them.
 *
 * SKILL.md section 22: branch on `code`, never on `message`. The codes are
 * stable across the life of `/api/v1` and the wording is not, so anything this
 * client *decides* on reads the code. Where there is nothing to decide, the
 * API's own `message` is shown, which section 22 states is human-readable and
 * safe to display — inventing a second wording here would mean three clients
 * saying three different things about one refusal.
 *
 * **`aboutInput` is the half that carries a domain rule.** Section 23 settles
 * `field-invalid` as the only token of its kind and scopes it to a form field
 * failing validation, arguing it from what such a message *is*: a statement
 * about something the person just typed, made to them, resolved by them in the
 * next few seconds. A server error, a dropped connection, or a link that
 * arrived without its token are none of those things, and colouring them with
 * the same token widens a deliberately narrow rule by use rather than by
 * amendment — which is exactly the drift section 23 says to expect, since "a
 * token is used by whoever writes the next screen, on whatever it seems to fit".
 *
 * So the flag is set here, once, from the code — rather than being implied by
 * which component happens to render the message.
 *
 * It is true for a **refusal of what was submitted** and false otherwise. In
 * particular it is false for `SCOPE_DENIED` and `CAPABILITY_DENIED`: those are
 * statements about an actor's authority, and a person is not a form field.
 * Sections 13, 17 and 19 forbid rendering a judgement about a person in colour,
 * and "you may not do this" is nearer to that than to a mistyped date.
 */
export interface Failure {
  message: string;
  /** True where the failure is a refusal of what the person just submitted. */
  aboutInput: boolean;
}

export function describeFailure(error: unknown, refusalMessage: string): Failure {
  if (!(error instanceof ApiRequestError)) {
    // A network failure, a DNS failure, or the client being offline. None of
    // these came from the API and none carries a code.
    return {
      message: 'Could not reach the server. Check your connection and try again.',
      aboutInput: false,
    };
  }

  switch (error.code) {
    case 'UNAUTHENTICATED':
      // The API's wording is deliberately not used on a credential form: a
      // message distinguishing "no such account" from "wrong password" is an
      // account enumeration oracle, and section 6 already requires the reset
      // path to answer identically whether or not the address exists.
      return { message: refusalMessage, aboutInput: true };

    case 'VALIDATION_FAILED':
    case 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED':
      return { message: error.message, aboutInput: true };

    case 'RATE_LIMITED':
      return { message: 'Too many attempts. Wait a minute and try again.', aboutInput: false };

    case 'RESOURCE_BUSY':
    case 'REQUEST_IN_FLIGHT':
      // Section 22 defines both as "retry after a short delay", so the wording
      // says that rather than presenting a transient wait as a refusal.
      return { message: 'The server is busy. Try again in a moment.', aboutInput: false };

    case 'INTERNAL_ERROR':
      return { message: 'Something went wrong at our end. Try again shortly.', aboutInput: false };

    default:
      return { message: error.message, aboutInput: false };
  }
}

/**
 * The message the API attached to one field, where it named one.
 *
 * Section 22's error envelope carries `details`, and the password rules in
 * section 6 answer `VALIDATION_FAILED` with `details.field`. Where that names
 * the field being edited, the message belongs *on* that field — which is the
 * case section 23 settles `field-invalid` for, and the only one.
 */
export function fieldErrorFor(error: unknown, field: string): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'VALIDATION_FAILED') {
    return null;
  }

  return error.details.field === field ? error.message : null;
}
