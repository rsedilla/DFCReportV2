import { Capability } from './capabilities';
import { ScopeType } from './scopes';

/**
 * The capabilities SKILL.md section 7 gives at Whole Church and nowhere else, for
 * which a **narrower** grant covers nothing.
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
 * **Stated rather than derived, and the first version was derived.** Computing it
 * from `ROLE_DEFAULTS` — "every role that holds this holds it at Whole Church" —
 * looked self-maintaining and had the wrong predicate. Since `ADMIN` and
 * `SENIOR_PASTOR` hold every capability at Whole Church, it reduced to "`LEADER`
 * does not hold it by default", which is a different property: it is a statement
 * about who gets it automatically, not about the scope at which it may be held.
 *
 * That produced a false positive on `audit.view`, and section 7 says so twice over.
 * "An audit entry resolves through its target" is machinery with no purpose unless
 * the capability can be held narrower — at Whole Church the target is never
 * consulted. And the very next line, "a **setting** is Whole Church only, and is
 * never in scope at any narrower value", is this specification's own way of saying
 * what this file says; audit is deliberately not written that way. A narrower
 * `audit.view` grants strictly *less* than the default, so there is no escalation
 * to close — and the rule was removing authority section 7 contemplates.
 *
 * A stated list is a second copy that can go stale, which is the real objection to
 * it. `single-scope.spec.ts` is the answer: it asserts the membership, so a role
 * default edited in Stage 3 cannot silently add or remove protection.
 *
 * A **wider** grant is untouched, which is deliberate: section 7 contemplates
 * Admin issuing authority beyond a role's defaults, and this rule is about a grant
 * that cannot mean what it appears to mean, not about capping anyone.
 */
export const WHOLE_CHURCH_ONLY: ReadonlySet<Capability> = new Set([
  // Section 7 states the escalation for each of these: moving a person between
  // Networks without holding `people.manage_pastoral_assignment`; granting
  // authority; merging identities; rewriting periods already reported; changing
  // behaviour for the whole church from one control; provisioning an account and
  // the role that qualifies it; archiving, which reduces a leader's own People
  // count and is the incentive section 3 guards against; and approving a Cell,
  // which mints a Cell Leader and provisions their credentials.
  Capability.PeopleCorrectSex,
  Capability.PeopleManageLifecycle,
  Capability.PeopleMerge,
  Capability.RecordsBackdateEffectiveDate,
  Capability.SettingsManage,
  Capability.AccountsManage,
  Capability.RolesManage,
  Capability.CellApproveCreation,
]);

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
