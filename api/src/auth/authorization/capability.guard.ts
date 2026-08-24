import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CapabilityDeniedError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../common/errors/api-error';
import { isUuid } from '../../common/identifiers';

import {
  AUTHENTICATED_ONLY_METADATA,
  CAPABILITY_METADATA,
  PUBLIC_METADATA,
  type CapabilityRequirement,
  type TargetSpec,
} from './authorization.decorators';
import { AuthorizationService, type Actor } from './authorization.service';

import type { AuthenticatedRequest } from './access-token.guard';
import type { Target } from './scopes';

/**
 * The capability and scope check, applied to every endpoint (SKILL.md section 7).
 *
 * **An endpoint that declares no capability is denied.** That is the whole point
 * of applying this declaratively: on a team, a check remembered inside every
 * handler is only as reliable as the least familiar developer writing the newest
 * route, and section 2 chose a framework whose guards fail closed for exactly
 * this reason. Forgetting `@RequiresCapability` closes an endpoint rather than
 * opening it.
 *
 * Two decorators pass an endpoint through without a capability, and both name
 * their reason where they are written: `@Public` for sign-in and the password
 * flows, and `@AuthenticatedOnly` for an endpoint acting on the caller's own
 * session. Neither ever covers an endpoint that touches church data.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return false;
    }

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<string | undefined>(PUBLIC_METADATA, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;
    if (!actor) {
      // AccessTokenGuard runs first and sets this. Reaching here means the guard
      // order changed, and the answer to an authorization question we cannot ask
      // is no.
      throw new UnauthenticatedError();
    }

    const requirement = this.reflector.getAllAndOverride<CapabilityRequirement | undefined>(
      CAPABILITY_METADATA,
      targets,
    );

    if (!requirement) {
      if (
        this.reflector.getAllAndOverride<string | undefined>(AUTHENTICATED_ONLY_METADATA, targets)
      ) {
        return true;
      }

      throw new CapabilityDeniedError(
        'This endpoint declares no capability and is therefore closed. Declare one with @RequiresCapability.',
      );
    }

    const target = this.resolveTarget(requirement.target, request, actor);
    await this.authorization.authorize(actor, requirement.capability, target);
    return true;
  }

  private resolveTarget(spec: TargetSpec, request: AuthenticatedRequest, actor: Actor): Target {
    if (spec.kind === 'church') {
      return { kind: 'church' };
    }

    if (spec.kind === 'actor') {
      return { kind: 'person', personId: actor.personId };
    }

    const value = readPath(request, spec.from);
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new ValidationFailedError(`${spec.from} must be a UUID identifying the target.`, {
        field: spec.from,
      });
    }

    return spec.kind === 'person'
      ? { kind: 'person', personId: value }
      : { kind: 'account', accountId: value };
  }
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, source);
}
