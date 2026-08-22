import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../../auth/authorization/access-token.guard';

/** The claim this request holds on its `Idempotency-Key`. */
export interface CurrentClaim {
  key: string;
  accountId: string;
  /**
   * Identifies this claim, not merely this key. A takeover under the lease mints
   * a new one, so a request that has lost the key completes nothing rather than
   * completing the claim that replaced it (SKILL.md section 22).
   */
  claimId: string;
}

/**
 * The claim `IdempotencyInterceptor` took for this request.
 *
 * A write endpoint needs it to record its completion inside the transaction that
 * performs the write (SKILL.md section 22). It is handed down rather than
 * reconstructed from the header, because the header identifies the *key* and what
 * a completion must match is the *claim* — and the two differ exactly when the
 * lease has let another request take over, which is the case that matters.
 */
export const CurrentIdempotency = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentClaim => {
    const claim = context.switchToHttp().getRequest<AuthenticatedRequest>().idempotency;

    if (!claim) {
      // Reaching here means the endpoint is not one the interceptor claimed for:
      // a read, or an unauthenticated route. That is a programming error at the
      // call site rather than anything a client did.
      //
      // A plain Error rather than an ApiError, deliberately. `describeFailure`
      // recognises an ApiError and hands its message straight to the client
      // *without logging it* -- so a misconfigured endpoint would explain itself
      // to a user and to nobody else. Unrecognised, it takes the filter's
      // unexpected-failure path: logged in full, reported without detail.
      throw new Error(
        'An endpoint asked for its idempotency claim and does not have one. It is either not a ' +
          'state-changing route, or it is @Public, and in both cases the interceptor never took ' +
          'a claim for it (SKILL.md section 22).',
      );
    }

    return claim;
  },
);
