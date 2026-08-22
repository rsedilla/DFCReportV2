import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, of, throwError } from 'rxjs';

import { PUBLIC_METADATA } from '../../auth/authorization/authorization.decorators';
import {
  ApiError,
  ApiErrorCode,
  UnauthenticatedError,
  ValidationFailedError,
} from '../errors/api-error';
import { describeFailure } from '../errors/api-exception.filter';

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
 * has nothing to key a row by. What this exempts is exactly section 7's closed
 * unauthenticated list, which is not restated here: section 22 stopped restating
 * it because two attempts to copy it both left a member out, and a third copy in
 * the file doing the exempting would be the same mistake in the same week.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

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

    if (isPublic) {
      return next.handle();
    }

    const actor = request.actor;
    if (!actor) {
      // Not an exemption. Section 22 makes the exempt set exactly section 7's
      // closed unauthenticated list, and a non-public request arriving here with
      // no actor is not on it -- it means the guard order changed. Passing it
      // through would be a second exemption, open-ended and silent, which is the
      // shape section 7 refuses for capabilities.
      throw new UnauthenticatedError();
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
      requestPath(request),
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
            // Nest sets the handler's status *before* the interceptor chain runs,
            // so this call overrides it. Without it a replayed 409 would go out
            // carrying the status the route itself declares rather than the one
            // the original request produced.
            context.switchToHttp().getResponse<Response>().status(claim.status);
            return of(claim.body);
          }

          case 'claimed': {
            const claimId = claim.claimId;

            // Handed to the handler so a write endpoint can record its own
            // completion inside the transaction that performs the write
            // (SKILL.md section 22). Read through `CurrentIdempotency`.
            request.idempotency = { key, accountId, claimId };

            return next.handle().pipe(
              // **On the handler alone, and deliberately before the store call
              // below.** Piped after it, this would also catch a failure of
              // `complete` -- which runs once the handler has already committed --
              // classify it as a server error, release the key, and let the next
              // retry execute a committed write a second time. That is the one
              // outcome sections 22 and 23 exist to prevent.
              catchError((error: unknown) => {
                // Classified by the same function the exception filter renders
                // with, so the two cannot disagree about whether a response is a
                // 4xx. Deciding it here independently would mean a NotFoundException
                // rendered to the client as a 404 while the key was dropped as a
                // server error.
                const failure = describeFailure(error);
                const status = failure?.status ?? 500;

                // A 5xx carries no decision and rolls back, so the claim is
                // released and the client may retry. A 4xx is this request's
                // outcome and is stored, so a repeat of the same body is given the
                // same answer rather than executing again.
                const settle =
                  status >= 500
                    ? this.idempotency.release({ key, accountId, claimId })
                    : this.idempotency.complete({
                        key,
                        accountId,
                        claimId,
                        status,
                        body: (failure?.body ?? null) as unknown as Json | null,
                      });

                return from(settle).pipe(mergeMap(() => throwError(() => error)));
              }),
              mergeMap((body: unknown) =>
                from(
                  this.idempotency.complete({
                    key,
                    accountId,
                    claimId,
                    // Already the handler's status: Nest calls setStatus before
                    // the interceptor chain, so this is 201 for a POST and
                    // whatever @HttpCode declares wherever one is present.
                    status: context.switchToHttp().getResponse<Response>().statusCode,
                    body: (body ?? null) as Json | null,
                  }),
                ).pipe(mergeMap(() => of(body))),
              ),
            );
          }
        }
      }),
    );
  }
}

/**
 * The request path, with the query string sorted rather than dropped.
 *
 * Section 22 defines the fingerprint over "method, path and body". The query is
 * kept because two writes differing only in a query parameter are two different
 * requests, and hashing them alike would answer the second with the first's
 * stored response. It is sorted because a client reordering its own parameters on
 * a retry would otherwise be told `IDEMPOTENCY_KEY_REUSED` -- permanent, by
 * section 22 -- which is the dead end canonicalizing the body exists to avoid. A
 * trailing slash is normalized away for the same reason.
 */
function requestPath(request: AuthenticatedRequest): string {
  const [rawPath, rawQuery] = request.originalUrl.split('?');
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  if (!rawQuery) {
    return path;
  }

  // Serialized as structure, not as a string. `URLSearchParams` percent-decodes
  // each half, so re-joining with `=` and `&` loses the distinction between one
  // parameter whose value contains those characters and two parameters that do
  // not: `?a=b%26c%3Dd` and `?a=b&c=d` both flatten to `a=b&c=d`. Two different
  // requests would then share a fingerprint, and the second would be answered
  // with the first's stored response -- the exact outcome keeping the query is
  // meant to prevent.
  const sorted = [...new URLSearchParams(rawQuery).entries()].sort((a, b) =>
    a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0]),
  );

  return `${path}?${JSON.stringify(sorted)}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
