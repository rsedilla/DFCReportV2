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
  /** The same, excluding the actor. Used by `cell.request_leadership` alone. */
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
 * and an audit entry. Each arrives with the module that owns it, and until then the
 * resolver has no rule for it and denies. That is the intended behaviour, not a gap:
 * an endpoint cannot be authorized against a target the system does not yet know how
 * to place in the tree.
 *
 * **A Cell has arrived, and deliberately did not become a member of this union.**
 * Section 7 places a Cell "through the Cell's leader", so the guard asks
 * `CELL_SCOPE_PORT` for that leader and hands the resolver a `person` — `cells` owns
 * `cell_leaderships` and this module may not read it (section 2), and a member here
 * would have meant either that boundary or a second resolver. The three still to come
 * may or may not go the same way; each decides it when it arrives.
 */
export type Target =
  /** A Person. Scope resolves through their pastoral position. */
  | { kind: 'person'; personId: string }
  /** An Account. Scope resolves through its Person. */
  | { kind: 'account'; accountId: string }
  /** A church-wide object, a setting being the example. Whole Church only. */
  | { kind: 'church' }
  /**
   * A **report scope selector**, which section 7 makes the target itself.
   *
   * It did become a member of this union where a Cell did not, and the reason is the
   * instant. A Cell resolves through a leader the guard can ask a port for and hand on
   * as a `person`; a report scope selector resolves through the pastoral tree **in force
   * at the period's end** (decision 0214), and a `person` target carries no instant, so
   * flattening it to one would silently resolve the wrong tree.
   *
   * `leaderPersonId` is `null` for a Whole Church selector, which is covered by a Whole
   * Church grant and refused otherwise -- section 7: `SCOPE_DENIED`, "never silently
   * narrowed to what they do hold".
   *
   * `at` is the instant the figures are computed against, handed in rather than derived
   * here. Decision 0214 fixes that the guard uses **the same** instant the report does,
   * and deliberately does not fix which instant that is: section 20 states two, three
   * lines apart, and `CLAUDE.md` carries that as open.
   */
  | { kind: 'report_scope'; leaderPersonId: string | null; at: Date };

export type TargetKind = Target['kind'];
