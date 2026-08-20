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

import { ApiError, ApiErrorCode, type ApiErrorBody } from './api-error';

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
            code: this.codeForStatus(exception.getStatus()),
            message: exception.message,
            details: {},
          },
        },
      };
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

  private codeForStatus(status: HttpStatus): ApiErrorCode {
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
}
