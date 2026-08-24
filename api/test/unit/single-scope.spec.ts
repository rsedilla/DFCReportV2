import { Capability } from '../../src/auth/authorization/capabilities';
import { ROLE_DEFAULTS } from '../../src/auth/authorization/role-defaults';
import { ScopeType } from '../../src/auth/authorization/scopes';
import { WHOLE_CHURCH_ONLY, grantCoversNothing } from '../../src/auth/authorization/single-scope';

/**
 * The capabilities a narrower grant cannot mean anything for (SKILL.md section 7).
 *
 * **This file is the reason the set may be stated rather than derived.** The
 * objection to a hand-kept list is that it goes stale, and stale in the direction
 * that matters is silent: a capability dropping out still authorizes, it just
 * stops being protected. Nothing else would fail.
 */
describe('capabilities held only at Whole Church (section 7)', () => {
  it('is exactly the eight section 7 argues the escalation for', () => {
    // Changing this list is a change to SKILL.md section 7 and a deploy, the way
    // ROLE_DEFAULTS is. If a capability is added here without section 7 stating
    // why a narrower grant would be an escalation, that is the review question.
    expect([...WHOLE_CHURCH_ONLY].sort()).toEqual(
      [
        Capability.AccountsManage,
        Capability.CellApproveCreation,
        Capability.PeopleCorrectSex,
        Capability.PeopleManageLifecycle,
        Capability.PeopleMerge,
        Capability.RecordsBackdateEffectiveDate,
        Capability.RolesManage,
        Capability.SettingsManage,
      ].sort(),
    );
  });

  it('excludes audit.view, which section 7 contemplates at a narrower scope', () => {
    // **The false positive that came of deriving this set.** Section 7 says an
    // audit entry "resolves through its target", which is machinery with no
    // purpose unless the capability can be held narrower — at Whole Church the
    // target is never consulted. And the line immediately after it, "a setting is
    // Whole Church only, and is never in scope at any narrower value", is the
    // specification's own way of saying what this file says; audit is deliberately
    // not written that way.
    //
    // A narrower `audit.view` grants strictly less than the Whole Church default,
    // so there is no escalation to close and the rule was removing authority
    // section 7 offers.
    expect(WHOLE_CHURCH_ONLY.has(Capability.AuditView)).toBe(false);
    expect(grantCoversNothing(Capability.AuditView, ScopeType.OwnSubtree)).toBe(false);
  });

  it('excludes every capability a Leader holds by default', () => {
    // The weaker property the derived version accidentally keyed on. It is true —
    // a capability Leaders hold at own/subtree obviously may be held there — but
    // it is not sufficient, which is the whole lesson: it admitted `audit.view`,
    // which no Leader holds and which may still be granted narrowly.
    for (const capability of Object.keys(ROLE_DEFAULTS.LEADER) as Capability[]) {
      expect(WHOLE_CHURCH_ONLY.has(capability)).toBe(false);
    }
  });

  it('refuses every scope but Whole Church, for a member of the set', () => {
    for (const scope of [ScopeType.OwnSubtree, ScopeType.SubtreeExclSelf, ScopeType.Network]) {
      expect(grantCoversNothing(Capability.AccountsManage, scope)).toBe(true);
    }

    expect(grantCoversNothing(Capability.AccountsManage, ScopeType.WholeChurch)).toBe(false);
  });

  it('touches nothing outside the set', () => {
    // A wider grant is untouched too: section 7 contemplates Admin issuing
    // authority beyond a role's defaults, and this rule is about a grant that
    // cannot mean what it says, not a cap.
    for (const scope of Object.values(ScopeType)) {
      expect(grantCoversNothing(Capability.PeopleViewSubtree, scope)).toBe(false);
      expect(grantCoversNothing(Capability.ReportsViewSubtree, scope)).toBe(false);
    }
  });
});
