import { ROLE_DEFAULTS } from './role-defaults';
import { ScopeType } from './scopes';

import type { Capability } from './capabilities';

/**
 * The capabilities SKILL.md section 7's catalog gives at Whole Church and nowhere
 * else, for which a **narrower** grant covers nothing.
 *
 * Section 7 gives several capabilities exactly one scope, and the guard alone
 * cannot hold that: it asks whether a grant covers the target, so a grant issued
 * at `OWN_SUBTREE` passes for anyone inside that subtree. The 2026-08-23 ruling
 * settled this for `people.correct_sex`, naming the escalation — moving a person
 * between Networks without ever holding `people.manage_pastoral_assignment`. The
 * same hole was open on every other one, and `accounts.manage` was the worst of
 * them: a subtree-scoped grant of it is a route to provisioning yourself an Admin
 * account and signing in as one.
 *
 * **Derived from the catalog rather than transcribed beside it.** A hand-kept list
 * is a second copy that goes stale the moment `ROLE_DEFAULTS` changes, and the
 * failure would be silent in the direction that matters — a capability dropping
 * out of the list still authorizes, it just stops being protected. Deriving it
 * means adding a Whole-Church-only capability to the catalog protects it in the
 * same change.
 *
 * A **wider** grant is untouched, which is deliberate: section 7 contemplates
 * Admin issuing authority beyond a role's defaults, and this rule is about a grant
 * that cannot mean what it appears to mean, not about capping anyone.
 */
export const WHOLE_CHURCH_ONLY: ReadonlySet<Capability> = deriveWholeChurchOnly();

function deriveWholeChurchOnly(): ReadonlySet<Capability> {
  const seen = new Map<Capability, Set<ScopeType>>();

  for (const defaults of Object.values(ROLE_DEFAULTS)) {
    for (const [capability, scopeType] of Object.entries(defaults)) {
      const scopes = seen.get(capability as Capability) ?? new Set<ScopeType>();
      scopes.add(scopeType);
      seen.set(capability as Capability, scopes);
    }
  }

  const only = new Set<Capability>();

  for (const [capability, scopes] of seen) {
    if (scopes.size === 1 && scopes.has(ScopeType.WholeChurch)) {
      only.add(capability);
    }
  }

  return only;
}

/**
 * Whether a grant of this capability at this scope can mean anything.
 *
 * Answers the question section 7 asks of `read_only` on a write capability, and is
 * refused the same way and in the same place: a row that cannot mean what it
 * appears to mean grants nothing, rather than being honoured in part.
 */
export function grantCoversNothing(capability: Capability, scopeType: ScopeType): boolean {
  return WHOLE_CHURCH_ONLY.has(capability) && scopeType !== ScopeType.WholeChurch;
}
