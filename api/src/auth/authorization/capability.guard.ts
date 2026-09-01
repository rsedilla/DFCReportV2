import {
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CapabilityDeniedError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../common/errors/api-error';
import { isUuid, NIL_UUID } from '../../common/identifiers';

import {
  AUTHENTICATED_ONLY_METADATA,
  CAPABILITY_METADATA,
  PUBLIC_METADATA,
  type CapabilityRequirement,
  type TargetSpec,
} from './authorization.decorators';
import { AuthorizationService, type Actor } from './authorization.service';
import { CELL_SCOPE_PORT, type CellScopePort } from './cell-scope.port';

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
    /**
     * Optional so that this module stays independent of `cells`, and denying when
     * it is absent rather than throwing on construction: a deployment that never
     * binds it simply has no Cell-scoped endpoint that works, which is the
     * fail-closed direction.
     */
    @Optional() @Inject(CELL_SCOPE_PORT) private readonly cellScope?: CellScopePort,
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

    const target = await this.resolveTarget(requirement.target, request, actor);
    await this.authorization.authorize(actor, requirement.capability, target);
    return true;
  }

  private async resolveTarget(
    spec: TargetSpec,
    request: AuthenticatedRequest,
    actor: Actor,
  ): Promise<Target> {
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

    if (spec.kind === 'cell') {
      // Section 7: a Cell resolves through its leader. Asked of the port rather
      // than read here, because `cells` owns `cell_leaderships` (section 2).
      if (!this.cellScope) {
        // A deployment fault rather than a client one, and it names itself as such:
        // no binding means no Cell-scoped endpoint works at all.
        throw new CapabilityDeniedError(
          'This deployment cannot resolve a Cell scope, so the endpoint is closed.',
          { target: 'cell' },
        );
      }

      const leaderId = await this.cellScope.leaderForScope(value);

      // **A Cell that cannot be placed becomes a target nothing covers, rather than
      // a refusal thrown from here**, and two earlier versions threw.
      //
      // Throwing at this point runs *before* `authorize`, which checks the
      // capability first and the scope second — so it answered an actor holding no
      // `cell.manage_membership` at all with a scope refusal, for a request whose
      // capability half was never evaluated, and section 7 makes the code name the
      // half that failed. It also left the two refusals distinguishable, by code for
      // that actor and by message and `details` for every other.
      //
      // **This closes that by making an absence look like a denial, and section 22
      // names the mirror image** — "where revealing that a record exists would itself
      // disclose something, return `NOT_FOUND` rather than a denial". Both close the
      // oracle; only one is the remedy the specification writes down, and an earlier
      // version of this comment credited section 22 for the direction not taken.
      // **Section 22 has since settled that a Cell is not such a case**, and this
      // comment claimed the opposite for one slice after it did. A Cell identifier
      // cannot be enumerated, so an actor holding one obtained it legitimately and
      // confirming it exists tells them nothing they did not have; what protects the
      // record is the indistinguishability below rather than the code. Section 22 also
      // answers the "both codes for one fact" objection this comment used to raise:
      // each actor gets one consistent answer decided by their own scope, and
      // `NOT_FOUND` is reached only by an actor whose scope *would* have covered the
      // Cell — a Whole Church one, since `scopeCovers` returns true before the target
      // is read. `CellsMembershipService` and the closure both answer that way.
      //
      // Handing `authorize` a target that resolves to nobody is what the Account
      // path already does: `personBehind` returns null *inside* `scopeCovers`, after
      // the capability check, and an absent Account and an out-of-scope one produce
      // the identical message and details. The nil UUID is a Person nothing can be,
      // so an unknown Cell and an out-of-scope Cell now answer identically too.
      return { kind: 'person', personId: leaderId ?? NIL_UUID };
    }

    if (spec.kind === 'cell_meeting') {
      // Section 7 places a Cell meeting **per record**: through the Cell's current
      // leader while the Cell is ACTIVE, and through whoever led it on the meeting's
      // date once the Cell is closed and the month's window is still open. The port
      // decides which, because `cells` owns both `cell_leaderships` and `cells.state`.
      if (!this.cellScope) {
        throw new CapabilityDeniedError(
          'This deployment cannot resolve a Cell scope, so the endpoint is closed.',
          { target: 'cell_meeting' },
        );
      }

      // **The date is validated here rather than trusted**, which section 7 requires
      // of a path parameter the guard resolves against. A malformed one would reach
      // the port and be compared as a `date` in SQL, answering with a database error
      // rather than a refusal — and it decides *authority*, so a value the guard
      // cannot read is one it must not guess at.
      const on = readPath(request, spec.onFrom);
      if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
        throw new ValidationFailedError(
          `${spec.onFrom} must be a YYYY-MM-DD date identifying the meeting.`,
          { field: spec.onFrom },
        );
      }

      const meetingLeaderId = await this.cellScope.leaderForMeetingScope(value, on);

      // Null resolves to the nil UUID for the reason the Cell branch above gives at
      // length: an absence is made to look like a denial, so that a closed month, a
      // Cell that never had a leader on that date, and a Cell out of the actor's scope
      // are indistinguishable to a caller who is not covered anyway.
      return { kind: 'person', personId: meetingLeaderId ?? NIL_UUID };
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
