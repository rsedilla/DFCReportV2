import { ALL_CAPABILITIES, Capability } from '../../src/auth/authorization/capabilities';
import { GRANT_MAKING, isGrantMaking } from '../../src/auth/authorization/grant-making';
import { ROLE_DEFAULTS } from '../../src/auth/authorization/role-defaults';

/**
 * The capabilities never held by a Senior Pastor, however granted (SKILL.md
 * section 7).
 *
 * **This file is why the set may be stated rather than derived**, which is the
 * argument `single-scope.spec.ts` already makes for its own list: a hand-kept set
 * goes stale silently, and stale in the direction that matters removes protection
 * while everything stays green.
 */
describe('the grant-making pair (section 7)', () => {
  it('is exactly the two section 7 argues the self-perpetuation for', () => {
    // Adding a capability here is a change to SKILL.md section 7 and a migration.
    // The question at review is whether section 7 argues that granting it removes
    // the second party *permanently* — which is what separates this pair from the
    // other five the role is withheld.
    expect([...GRANT_MAKING].sort()).toEqual(
      [Capability.AccountsManage, Capability.RolesManage].sort(),
    );
  });

  it('excludes the withheld capabilities that are audited rather than refused', () => {
    // Named individually rather than asserted as a count, because the reason
    // differs by capability and a count hides that.
    //
    // `records.backdate_effective_date`, `people.merge` and `people.correct_sex`
    // are withheld by section 7 on a stated ground — each moves totals for periods
    // already reported — and each use is one audited operation whose authority an
    // Admin can still revoke. `settings.manage` and `cell.approve_leadership` the
    // table withholds and section 7 argues nowhere.
    //
    // `people.correct_sex` is listed first because a first version of this branch
    // filed it among the unargued ones, in four places. Section 7 argues it
    // explicitly, on the same ground as `people.merge`.
    for (const capability of [
      Capability.PeopleCorrectSex,
      Capability.PeopleMerge,
      Capability.RecordsBackdateEffectiveDate,
      Capability.SettingsManage,
      Capability.CellApproveLeadership,
    ]) {
      expect(isGrantMaking(capability)).toBe(false);
    }
  });

  it('names only capabilities that exist', () => {
    // A member that is not a capability would silently never match, so the set
    // would protect nothing and nothing would say so.
    for (const capability of GRANT_MAKING) {
      expect(ALL_CAPABILITIES).toContain(capability);
    }
  });

  it('covers only capabilities a Senior Pastor lacks by default', () => {
    // The rule refuses a *grant* of these, so a capability the role already holds
    // by default would make the set incoherent: the account would carry it
    // regardless and the refusal would be theatre. That cannot happen today and
    // this is what would notice if section 7's table were ever widened.
    for (const capability of GRANT_MAKING) {
      expect(ROLE_DEFAULTS.SENIOR_PASTOR[capability]).toBeUndefined();
    }
  });
});
