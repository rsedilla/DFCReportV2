import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, of, throwError } from 'rxjs';

import { PUBLIC_METADATA } from '../../auth/authorization/authorization.decorators';
import { ApiError, ApiErrorCode, ValidationFailedError } from '../errors/api-error';

import { IdempotencyService } from './idempotency.service';

import type { AuthenticatedRequest } from '../../auth/authorization/access-token.guard';
import type { Json } from '../../database/schema';
import type { Observable } from 'rxjs';
import type { Response } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `Idempotency-Key` on every authenticated state-changing request (SKILL.md
 * section 22, Idempotency; section 23, Required from the first write endpoint).
 *
 * **This applies by default rather than per endpoint**, for the reason section 2
 * gives for the capability guard: a convention remembered inside each handler is
 * only as reliable as the least familiar developer writing the newest route. A
 * new write endpoint is covered the moment it exists, and nothing has to be
 * remembered for it to be.
 *
 * **Unauthenticated writes are outside it, and that follows from section 22's own
 * shape.** `idempotency_keys` is keyed by account, so a request with no account
 * has nothing to key a row by. The endpoints this exempts are exactly section 7's
 * closed unauthenticated list -- sign-in, token refresh, password reset,
 * activation -- so the exemption is closed too, and widening it means amending
 * that list rather than deciding it in a controller.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * The status this handler will produce, derived the way Nest derives it.
   *
   * It cannot be read off the response. Nest applies the status *after* the
   * interceptor chain resolves, so `response.statusCode` here is still Express's
   * default rather than the handler's -- a POST would be stored as 200, and every
   * replay of it would answer 200 where the original answered 201.
   */
  private successStatus(context: ExecutionContext): number {
    const declared = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );

    if (typeof declared === 'number') {
      return declared;
    }

    return context.switchToHttp().getRequest<AuthenticatedRequest>().method.toUpperCase() === 'POST'
      ? 201
      : 200;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!STATE_CHANGING.has(request.method.toUpperCase())) {
      return next.handle();
    }

    // A public endpoint has no account to key a row by (above). The check reads
    // the same metadata the capability guard reads, so the two cannot disagree
    // about which endpoints are unauthenticated.
    const isPublic = this.reflector.getAllAndOverride<string | undefined>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    const actor = request.actor;
    if (isPublic || !actor) {
      return next.handle();
    }

    const key = headerValue(request.headers['idempotency-key']);

    if (key === null) {
      throw new ValidationFailedError(
        'This request must carry an Idempotency-Key header holding a UUID you generated.',
        { header: 'Idempotency-Key' },
      );
    }

    if (!UUID.test(key)) {
      throw new ValidationFailedError('Idempotency-Key must be a UUID.', {
        header: 'Idempotency-Key',
      });
    }

    const accountId = actor.accountId;
    const fingerprint = this.idempotency.fingerprint(
      request.method,
      // The routed path rather than the raw URL, so that a query string a client
      // reorders is not a different request. Section 22's filters are named
      // parameters, and the values are in the body for a write.
      request.originalUrl.split('?')[0],
      request.body,
    );

    return from(this.idempotency.claim({ key, accountId, fingerprint })).pipe(
      mergeMap((claim) => {
        switch (claim.outcome) {
          case 'reused':
            // Permanent, and deliberately not VALIDATION_FAILED: a client
            // branching on that code would show a field error for a replay
            // (section 22).
            return throwError(
              () =>
                new ApiError(
                  ApiErrorCode.IDEMPOTENCY_KEY_REUSED,
                  'This Idempotency-Key was already used for a different request. Do not retry it.',
                  { header: 'Idempotency-Key' },
                ),
            );

          case 'in_flight':
            return throwError(
              () =>
                new ApiError(
                  ApiErrorCode.REQUEST_IN_FLIGHT,
                  'The first request with this Idempotency-Key has not finished. Retry shortly.',
                  { header: 'Idempotency-Key' },
                ),
            );

          case 'replay': {
            // Nest applies the handler's status after this observable resolves,
            // so setting it here is what makes the replay carry the status the
            // original produced rather than the framework default.
            context.switchToHttp().getResponse<Response>().status(claim.status);
            return of(claim.body);
          }

          case 'claimed':
            return next.handle().pipe(
              mergeMap((body: unknown) =>
                from(
                  this.idempotency.complete({
                    key,
                    accountId,
                    status: this.successStatus(context),
                    body: (body ?? null) as Json | null,
                  }),
                ).pipe(mergeMap(() => of(body))),
              ),
              catchError((error: unknown) => {
                const status = error instanceof ApiError ? error.status : 500;

                // A 5xx carries no decision and rolls back, so the claim is
                // released and the client may retry. A 4xx is this request's
                // outcome and is stored, so a repeat of the same body is given
                // the same answer rather than executing again.
                const settle =
                  status >= 500
                    ? this.idempotency.release({ key, accountId })
                    : this.idempotency.complete({
                        key,
                        accountId,
                        status,
                        body: (error instanceof ApiError
                          ? error.toBody()
                          : null) as unknown as Json | null,
                      });

                return from(settle).pipe(mergeMap(() => throwError(() => error)));
              }),
            );
        }
      }),
    );
  }
}

function headerValue(raw: string | string[] | undefined): string | null {
  if (typeof raw === 'string') {
    return raw.trim() === '' ? null : raw.trim();
  }

  if (Array.isArray(raw) && raw.length > 0) {
    return headerValue(raw[0]);
  }

  return null;
}
