import { SetMetadata, type CustomDecorator } from '@nestjs/common';

import type { Capability } from './capabilities';
import type { TargetKind } from './scopes';

export const CAPABILITY_METADATA = 'dfc:capability';
export const PUBLIC_METADATA = 'dfc:public';
export const AUTHENTICATED_ONLY_METADATA = 'dfc:authenticated-only';

/**
 * Where the guard finds the target's identifier on the request.
 *
 * `from` is a dotted path against the request, e.g. `params.id` or
 * `body.leader_id`. `actor` needs no path: the target is the actor's own Person.
 */
export type TargetSpec =
  | { kind: Extract<TargetKind, 'person' | 'account'>; from: string }
  | { kind: 'church' }
  | { kind: 'actor' };

export interface CapabilityRequirement {
  capability: Capability;
  target: TargetSpec;
}

/**
 * Declares the capability an endpoint requires and the target its scope is
 * evaluated against. Both halves are named, always: a capability without a scope
 * grants nothing, and a scope without a capability grants nothing.
 *
 * An endpoint that declares nothing is denied (see `CapabilityGuard`). That is
 * what makes this declarative rather than a convention: forgetting the decorator
 * closes the endpoint instead of opening it.
 */
export function RequiresCapability(
  capability: Capability,
  target: TargetSpec,
): CustomDecorator<string> {
  return SetMetadata(CAPABILITY_METADATA, { capability, target } satisfies CapabilityRequirement);
}

/**
 * An endpoint reachable without an access token. Sign-in and the password flows
 * are the whole of this set: everything else is behind authentication.
 *
 * The reason is required so that every use of this escape hatch explains itself
 * where it is written, and so the set can be listed with one search.
 */
export function Public(reason: string): CustomDecorator<string> {
  return SetMetadata(PUBLIC_METADATA, reason);
}

/**
 * An endpoint that requires authentication and no capability, because it acts on
 * the caller's own session rather than on church data: reading one's own token
 * claims, signing out, ending one's own sessions.
 *
 * This is the only way past the capability guard, and it is deliberately narrow.
 * It never covers an endpoint that reads or writes a Person, a Cell, attendance
 * or a report, whoever the subject is. The reason is required and is reviewed.
 */
export function AuthenticatedOnly(reason: string): CustomDecorator<string> {
  return SetMetadata(AUTHENTICATED_ONLY_METADATA, reason);
}
