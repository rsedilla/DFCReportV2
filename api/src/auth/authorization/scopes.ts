/**
 * Scope, the second half of every authorization decision (SKILL.md section 7).
 *
 * Four values, closed. A guard cannot fail closed against an open enumeration, so
 * a fifth is an amendment to the specification rather than a convenience.
 */
import type { NetworkName } from '../../database/schema';

export const ScopeType = {
  /** The actor's pastoral subtree, including the actor. */
  OwnSubtree: 'OWN_SUBTREE',
  /** The same, excluding the actor. Used by `cell.request_creation` alone. */
  SubtreeExclSelf: 'SUBTREE_EXCL_SELF',
  /** One Network, named on the grant. */
  Network: 'NETWORK',
  WholeChurch: 'WHOLE_CHURCH',
} as const;

export type ScopeType = (typeof ScopeType)[keyof typeof ScopeType];

export const ALL_SCOPE_TYPES: readonly ScopeType[] = Object.values(ScopeType);

export interface Scope {
  type: ScopeType;
  /** Required where `type` is NETWORK, null otherwise. */
  network: NetworkName | null;
}

/**
 * The target a scope is evaluated against: the request's primary target, the
 * record being read or written.
 *
 * Section 7 also resolves scope for a Cell, a DCC event, a report scope selector
 * and an audit entry. Each of those arrives with the module that owns it, and
 * until then the resolver has no rule for them and denies. That is the intended
 * behaviour, not a gap: an endpoint cannot be authorized against a target the
 * system does not yet know how to place in the tree.
 */
export type Target =
  /** A Person. Scope resolves through their pastoral position. */
  | { kind: 'person'; personId: string }
  /** An Account. Scope resolves through its Person. */
  | { kind: 'account'; accountId: string }
  /** A church-wide object, a setting being the example. Whole Church only. */
  | { kind: 'church' };

export type TargetKind = Target['kind'];
