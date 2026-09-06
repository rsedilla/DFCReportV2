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
 * `body.pastoral_leader_id`. `actor` needs no path: the target is the actor's own Person.
 */
export type TargetSpec =
  | { kind: Extract<TargetKind, 'person' | 'account'>; from: string }
  /**
   * A Cell. Its scope resolves through its leader (SKILL.md section 7), which the
   * guard asks `CELL_SCOPE_PORT` for — `cells` owns `cell_leaderships` and this
   * module may not read it (section 2).
   */
  | { kind: 'cell'; from: string }
  /**
   * A Cell **meeting**, which section 7 places per record rather than per Cell.
   *
   * `from` is the Cell's identifier and `onFrom` is the meeting's scheduled date — its
   * identity (section 13), and a `YYYY-MM-DD` Manila date rather than a UUID. Section
   * 7 resolves this through the Cell's current leader while the Cell is ACTIVE, and
   * through whoever led it on that date once the Cell is closed and while the month's
   * window is open.
   *
   * **The date comes from the path, which is what keeps it out of the actor's hands.**
   * Section 7: "an actor could declare an actual date inside their own past tenure and
   * recover authority through a request field" — so `onFrom` names a path parameter and
   * a spec pointing it at the body would be the defect that sentence describes.
   */
  | { kind: 'cell_meeting'; from: string; onFrom: string }
  | { kind: 'church' }
  /**
   * A **report scope selector** (SKILL.md section 7), which is the target itself.
   *
   * Three paths rather than one, because the selector is three values: which scope is
   * asked for, the leader it names where that scope is `LEADER`, and the period, which
   * decision 0207 makes the instant the selector resolves at.
   *
   * **The period comes from the request, and that is correct here where it would not be
   * on a write.** Section 7 refuses authority resolved as of an effective date the actor
   * chooses, because an actor could reach back into their own past tenure and recover it.
   * Decision 0207 states in terms that this "moves no write": a viewing capability
   * confers none, and a reported period is one that already happened rather than a date
   * an actor picks to act at.
   */
  | { kind: 'report_scope'; scopeFrom: string; leaderFrom: string; periodFrom: string }
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
