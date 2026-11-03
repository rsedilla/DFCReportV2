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
  it('is exactly the ten section 7 argues the escalation for', () => {
    // Changing this list is a change to SKILL.md section 7 and a deploy, the way
    // ROLE_DEFAULTS is. If a capability is added here without section 7 stating
    // why a narrower grant would be an escalation, that is the review question.
    expect([...WHOLE_CHURCH_ONLY].sort()).toEqual(
      [
        Capability.AccountsManage,
        Capability.AuditView,
        Capability.CellApproveLeadership,
        Capability.PeopleCorrectSex,
        Capability.PeopleManageLifecycle,
        Capability.PeopleSetTitle,
        Capability.PeopleMerge,
        Capability.RecordsBackdateEffectiveDate,
        Capability.RolesManage,
        Capability.SettingsManage,
      ].sort(),
    );
  });

  it('includes audit.view since decision 0430, whatever narrower scope it is granted at', () => {
    // Section 7 once kept it grantable narrower, an entry resolving through its target.
    // Decision 0430 retired that: an entry carries the values it changed, birthdays and
    // mobile numbers among them, so the log is the Admin's alone.
    for (const scope of [ScopeType.OwnSubtree, ScopeType.SubtreeExclSelf, ScopeType.Network]) {
      expect(grantCoversNothing(Capability.AuditView, scope)).toBe(true);
    }
    expect(grantCoversNothing(Capability.AuditView, ScopeType.WholeChurch)).toBe(false);
  });

  it('excludes every capability a Leader holds by default', () => {
    // The weaker property the derived version accidentally keyed on. It is true —
    // a capability Leaders hold at own/subtree obviously may be held there — but
    // it is not sufficient, which is the whole lesson: it admitted `audit.view` when
    // section 7 still let it be granted narrowly, before decision 0430.
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

  it('voids an explicit narrower grant of cell.approve_leadership, and not the role default Approves Cells selects (decision 0352)', () => {
    // The tick is the one way a Leader holds it narrower; an Admin-issued grant at any
    // scope below Whole Church still covers nothing. The source defaults to a grant, so
    // a caller that forgets to pass it is refused rather than widened.
    for (const scope of [ScopeType.OwnSubtree, ScopeType.SubtreeExclSelf, ScopeType.Network]) {
      expect(grantCoversNothing(Capability.CellApproveLeadership, scope, 'grant')).toBe(true);
      expect(grantCoversNothing(Capability.CellApproveLeadership, scope)).toBe(true);
    }
    expect(
      grantCoversNothing(Capability.CellApproveLeadership, ScopeType.SubtreeExclSelf, 'role'),
    ).toBe(false);

    // The exemption is for that one capability: a role default of any other member of
    // the set is still voided below Whole Church.
    expect(grantCoversNothing(Capability.AccountsManage, ScopeType.OwnSubtree, 'role')).toBe(true);
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
