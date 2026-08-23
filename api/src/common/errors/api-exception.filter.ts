import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ApiError, ApiErrorCode, ResourceBusyError, type ApiErrorBody } from './api-error';
import { isLockTimeout } from './postgres-errors';

/**
 * Every failure leaves this API as the one envelope of SKILL.md section 22.
 * No redirects, no HTML error pages: only one of the three client surfaces is a
 * browser, and the other two parse JSON or fail.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const { status, body } = this.render(exception, request);
    response.status(status).json(body);
  }

  private render(exception: unknown, request: Request): { status: number; body: ApiErrorBody } {
    const known = describeFailure(exception);
    if (known) {
      return known;
    }

    // An unexpected failure is logged in full and reported without detail. An
    // error message is not a place to disclose the shape of the database.
    this.logger.error(
      `Unhandled error on ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: ApiErrorCode.INTERNAL_ERROR,
          message: 'Something went wrong. The failure has been logged.',
          details: {},
        },
      },
    };
  }
}

/**
 * What a thrown value renders as, or null where nothing recognises it.
 *
 * Exported because the idempotency interceptor has to make the same judgement
 * (SKILL.md section 22: a 4xx is this request's outcome and is stored, a 5xx is
 * released so the client may retry). Two independent classifications would drift,
 * and the failure would be silent -- a response the filter renders as a 404 while
 * the interceptor files it as a server error and drops the key.
 *
 * Null means "nothing here recognises this", which the filter answers with a
 * logged 500 and the interceptor treats as releasable.
 */
export function describeFailure(exception: unknown): { status: number; body: ApiErrorBody } | null {
  // An elapsed lock wait, wherever it was raised. `lockPersonsWithin` sets
  // `lock_timeout` for the whole of its caller's transaction (SKILL.md section 5),
  // so a row lock taken *after* it — the write's own, or the idempotency key's in
  // `completeWithin` — can time out at a call site that knows nothing about locks.
  // Unrecognised, that would be an unhandled 500 for what is ordinary contention,
  // and section 22's release rule turns on the status: released at 5xx and stored
  // otherwise, so misclassifying it as anything below 500 would pin a transient
  // failure to the idempotency key.
  if (isLockTimeout(exception)) {
    const busy = new ResourceBusyError();
    return { status: busy.status, body: busy.toBody() };
  }

  if (exception instanceof ApiError) {
    return { status: exception.status, body: exception.toBody() };
  }

  if (exception instanceof ThrottlerException) {
    return {
      status: HttpStatus.TOO_MANY_REQUESTS,
      body: {
        error: {
          code: ApiErrorCode.RATE_LIMITED,
          message: 'Too many requests. Try again shortly.',
          details: {},
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    return {
      status: exception.getStatus(),
      body: {
        error: {
          code: codeForStatus(exception.getStatus()),
          message: exception.message,
          details: {},
        },
      },
    };
  }

  return null;
}

function codeForStatus(status: HttpStatus): ApiErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      // A framework-level 403 with no capability or scope decision behind it is
      // reported as the narrower of the two: a denial nobody explained is not a
      // capability the actor demonstrably lacks.
      return ApiErrorCode.SCOPE_DENIED;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.UNPROCESSABLE_ENTITY:
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.VALIDATION_FAILED;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.INVARIANT_VIOLATION;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ApiErrorCode.RATE_LIMITED;
    default:
      return ApiErrorCode.INTERNAL_ERROR;
  }
}
