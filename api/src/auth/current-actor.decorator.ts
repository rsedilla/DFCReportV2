import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { UnauthenticatedError } from '../common/errors/api-error';

import type { AuthenticatedRequest } from './authorization/access-token.guard';
import type { Actor } from './authorization/authorization.service';

/** The authenticated account and its Person, as set by `AccessTokenGuard`. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) {
      throw new UnauthenticatedError();
    }
    return request.actor;
  },
);
