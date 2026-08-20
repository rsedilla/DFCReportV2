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
  /** No such record, or its existence must not be disclosed. */
  NOT_FOUND: 'NOT_FOUND',

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
  NOT_FOUND: 404,
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

export class NotFoundError extends ApiError {
  constructor(message = 'Not found.', details: Record<string, unknown> = {}) {
    super(ApiErrorCode.NOT_FOUND, message, details);
  }
}

export class ValidationFailedError extends ApiError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(ApiErrorCode.VALIDATION_FAILED, message, details);
  }
}
