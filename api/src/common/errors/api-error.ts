/**
 * The one error envelope (SKILL.md section 22, Errors).
 *
 * `code` is stable and machine-readable; clients branch on it and never on
 * `message`. Three clients consume this API concurrently and mobile builds cannot
 * be force-updated, so a code, once shipped, means what it meant.
 */

export const ApiErrorCode = {
  /** No valid access token. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** The actor lacks the capability (section 7). */
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  /** The actor holds the capability but not over this target. */
  SCOPE_DENIED: 'SCOPE_DENIED',
  /** Malformed or missing input. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** The record changed since it was read (section 14). */
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  /** The reporting month is closed (section 13). */
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  /** The key was already used for a different request. Never retry. */
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  /** The original request with this key has not finished. Retry after a delay. */
  REQUEST_IN_FLIGHT: 'REQUEST_IN_FLIGHT',
  /** A domain rule rejects the write: cycle, cross-Network edge, two active assignments. */
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  /**
   * A Tier 1 duplicate candidate must be acknowledged before the Person is
   * created (section 3). The candidates are in `details`; the client shows them
   * and resubmits with an acknowledgement.
   */
  DUPLICATE_ACKNOWLEDGEMENT_REQUIRED: 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED',
  /** No such record, or its existence must not be disclosed. */
  NOT_FOUND: 'NOT_FOUND',
  /**
   * The write could not be serialized against another operation and reached no
   * decision. Transient: retry shortly, **with the same key**.
   *
   * Three conditions (section 22): the wait timed out (section 5, Database
   * enforcement), the database chose this transaction as a deadlock victim, or a
   * premise read before a lock no longer held under it — the third added by the
   * ruling of 2026-08-31, which places a refusal by asking whether this same body,
   * resubmitted unchanged, could succeed.
   *
   * **A 5xx deliberately, and that is not cosmetic.** Section 22 stores a 4xx
   * against the idempotency key and releases the key on a 5xx, because the first
   * is a decision the rules reached and the second carries no decision at all.
   * Contention reached no decision, so storing it would pin a transient failure to
   * that key for the whole retention and leave the client with no way past it —
   * which is the failure the release rule exists to prevent. Falling on the 5xx
   * side of that split makes the right thing happen structurally, rather than by a
   * special case in the interceptor that somebody has to remember.
   */
  RESOURCE_BUSY: 'RESOURCE_BUSY',

  // The table in section 22 is a minimum. These two carry no domain meaning and
  // exist so that every response, including a failure nobody anticipated, is one
  // envelope with a code a client can branch on.
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  CAPABILITY_DENIED: 403,
  SCOPE_DENIED: 403,
  VALIDATION_FAILED: 422,
  VERSION_CONFLICT: 409,
  PERIOD_CLOSED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_FLIGHT: 409,
  INVARIANT_VIOLATION: 409,
  DUPLICATE_ACKNOWLEDGEMENT_REQUIRED: 409,
  NOT_FOUND: 404,
  RESOURCE_BUSY: 503,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = 'Sign in to continue.', details: Record<string, unknown> = {}) {
    super(ApiErrorCode.UNAUTHENTICATED, message, details);
  }
}

export class CapabilityDeniedError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(ApiErrorCode.CAPABILITY_DENIED, message, details);
  }
}

export class ScopeDeniedError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(ApiErrorCode.SCOPE_DENIED, message, details);
  }
}

export class InvariantViolationError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(ApiErrorCode.INVARIANT_VIOLATION, message, details);
  }
}

/**
 * Section 3: the system never merges automatically and never blocks creation. It
 * surfaces candidates and a person decides -- so this is not a refusal to create,
 * it is a request for the acknowledgement section 3 requires before a Tier 1
 * candidate is passed over.
 *
 * Deliberately not `VALIDATION_FAILED`. The input is well-formed and the answer
 * is a human decision; a client branching on a validation code would render this
 * as a field error, which is the same argument section 22 makes for
 * `IDEMPOTENCY_KEY_REUSED`.
 */
export class DuplicateAcknowledgementRequiredError extends ApiError {
  constructor(candidates: readonly unknown[]) {
    super(
      ApiErrorCode.DUPLICATE_ACKNOWLEDGEMENT_REQUIRED,
      'This may be someone already recorded. Review the candidates, then resubmit acknowledging them.',
      { candidates },
    );
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found.', details: Record<string, unknown> = {}) {
    super(ApiErrorCode.NOT_FOUND, message, details);
  }
}

/**
 * A write that could not be serialized against another operation and reached no
 * decision (SKILL.md section 22).
 *
 * Three conditions, and the third is why the message is overridable. A wait that
 * elapsed and a deadlock victim are the same event to a caller and say nothing worth
 * saying beyond "retry". A **stale premise** — a value read before a lock that differs
 * underneath it — is placed here by section 22's question, *could this same body,
 * resubmitted unchanged, succeed?*, and the answer being yes is the whole of what
 * decides it. But a caller who is told only "another change is in progress" cannot see
 * which premise moved, and these refusals happen at the end of a long operation.
 *
 * **A 503 rather than a 409, and the advice follows the status.** Section 22 stores a
 * 4xx against the idempotency key and replays it for the retention, while a 5xx
 * releases it. So a message here says to retry, and says nothing about minting a new
 * key: the same key is the right one, and telling a client otherwise would send it to
 * mint a key it does not need for a body it has not changed.
 */
export class ResourceBusyError extends ApiError {
  constructor(
    details: Record<string, unknown> = {},
    message = 'Another change to this record is in progress. Retry in a moment.',
  ) {
    super(ApiErrorCode.RESOURCE_BUSY, message, details);
  }
}

export class ValidationFailedError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(ApiErrorCode.VALIDATION_FAILED, message, details);
  }
}
