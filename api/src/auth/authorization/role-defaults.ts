/**
 * The role catalog of SKILL.md section 7, transcribed for the capabilities this
 * application declares. The nine Conquest, SUYNL and Training rows arrived with
 * those modules (sections 27 and 28), where section 7 gives all three roles the
 * same scopes it gives the DCC and Cell capabilities they are modelled on.
 *
 * Role defaults are specification, not data. This table is not editable at
 * runtime, and `roles.manage` governs which roles an account holds, never what a
 * role means. Changing a default is a change to SKILL.md and a deploy, which is
 * what keeps the catalog and the running system from diverging.
 *
 * A capability absent from a role is a dash in the specification's table, and the
 * four deliberate absences are worth naming here because each looks like an
 * oversight and is not:
 *
 *   - Senior Pastors hold neither `roles.manage` nor `accounts.manage`, so the
 *     church's two highest-visibility accounts cannot escalate their own authority
 *   - Senior Pastors do not hold `records.backdate_effective_date`; backdating is
 *     data correction, not a pastoral act
 *   - Senior Pastors do not hold `people.merge`; a merge is irreversible and can
 *     lower totals for periods already reported
 *   - Leaders do not hold `people.manage_lifecycle`; archiving reduces a leader's
 *     own People count, which is the incentive Person Lifecycle guards against
 *   - Leaders and Senior Pastors hold none of `dcc.submit_on_behalf`,
 *     `cell.submit_on_behalf` and `suynl.confirm_on_behalf`: reporting is done on the
 *     ground by the leader who owes it, and only Admin steps in (decision 0322)
 */
import { Capability } from './capabilities';
import { ScopeType } from './scopes';

import type { AccountRole } from '../../database/schema';

export type RoleDefaults = Partial<Record<Capability, ScopeType>>;

/**
 * The nine Growth capabilities at one scope, written once for the three roles.
 *
 * Section 7 gives them the same scope as the role's other subtree capabilities —
 * Whole Church for a Senior Pastor and an Admin, own subtree for a Leader — except
 * `suynl.confirm_on_behalf`, which only Admin holds (decision 0322). So the scope and
 * that one flag are what vary between the three roles.
 */
function growthAt(scope: ScopeType, suynlOnBehalf: boolean): RoleDefaults {
  return {
    [Capability.ConquestViewSubtree]: scope,
    [Capability.ConquestConfirm]: scope,
    [Capability.ConquestConfirmOnBehalf]: scope,
    [Capability.SuynlViewSubtree]: scope,
    [Capability.SuynlConfirm]: scope,
    // Admin's alone (decision 0322); Training and Conquest keep theirs.
    ...(suynlOnBehalf ? { [Capability.SuynlConfirmOnBehalf]: scope } : {}),
    [Capability.TrainingViewSubtree]: scope,
    [Capability.TrainingConfirm]: scope,
    [Capability.TrainingConfirmOnBehalf]: scope,
  };
}

const SENIOR_PASTOR: RoleDefaults = {
  [Capability.PeopleViewSubtree]: ScopeType.WholeChurch,
  [Capability.PeopleCreate]: ScopeType.WholeChurch,
  [Capability.PeopleEditBasic]: ScopeType.WholeChurch,
  [Capability.PeopleManageLifecycle]: ScopeType.WholeChurch,
  [Capability.PeopleManagePastoralAssignment]: ScopeType.WholeChurch,
  [Capability.DccTakeAttendance]: ScopeType.WholeChurch,
  [Capability.DccViewSubtree]: ScopeType.WholeChurch,
  [Capability.DccCorrectSubtree]: ScopeType.WholeChurch,
  [Capability.CellTakeAttendance]: ScopeType.WholeChurch,
  [Capability.CellViewSubtree]: ScopeType.WholeChurch,
  [Capability.CellCorrectSubtree]: ScopeType.WholeChurch,
  [Capability.CellManageMembership]: ScopeType.WholeChurch,
  [Capability.CellManageLeadership]: ScopeType.WholeChurch,
  [Capability.CellManageConfiguration]: ScopeType.WholeChurch,
  // Held at subtree scope by every role, because section 10 prohibits naming oneself
  // for everyone. **The default carries the prohibition; it does not enforce it** — a
  // wider grant is an ordinary row section 7 does not refuse, and `scopeCovers` returns
  // before the target is read at Whole Church. `CellsLeadershipRequestService.request`
  // is what makes section 10's "at any scope" true.
  [Capability.CellRequestLeadership]: ScopeType.SubtreeExclSelf,
  [Capability.CellManageLifecycle]: ScopeType.WholeChurch,
  [Capability.ReportsViewSubtree]: ScopeType.WholeChurch,
  [Capability.AuditView]: ScopeType.WholeChurch,
  ...growthAt(ScopeType.WholeChurch, false),
};

const ADMIN: RoleDefaults = {
  [Capability.PeopleViewSubtree]: ScopeType.WholeChurch,
  [Capability.PeopleCreate]: ScopeType.WholeChurch,
  [Capability.PeopleEditBasic]: ScopeType.WholeChurch,
  [Capability.PeopleManageLifecycle]: ScopeType.WholeChurch,
  [Capability.PeopleManagePastoralAssignment]: ScopeType.WholeChurch,
  // Admin alone. Section 7: correcting sex moves a Person between Networks and
  // can change totals for periods already reported, which is the same reason
  // people.merge and records.backdate_effective_date are Admin-only.
  [Capability.PeopleCorrectSex]: ScopeType.WholeChurch,
  [Capability.DccTakeAttendance]: ScopeType.WholeChurch,
  [Capability.DccViewSubtree]: ScopeType.WholeChurch,
  [Capability.DccSubmitOnBehalf]: ScopeType.WholeChurch,
  [Capability.DccCorrectSubtree]: ScopeType.WholeChurch,
  [Capability.CellTakeAttendance]: ScopeType.WholeChurch,
  [Capability.CellViewSubtree]: ScopeType.WholeChurch,
  [Capability.CellSubmitOnBehalf]: ScopeType.WholeChurch,
  [Capability.CellCorrectSubtree]: ScopeType.WholeChurch,
  [Capability.CellManageMembership]: ScopeType.WholeChurch,
  [Capability.CellManageLeadership]: ScopeType.WholeChurch,
  [Capability.CellManageConfiguration]: ScopeType.WholeChurch,
  [Capability.CellRequestLeadership]: ScopeType.SubtreeExclSelf,
  [Capability.CellApproveLeadership]: ScopeType.WholeChurch,
  [Capability.CellManageLifecycle]: ScopeType.WholeChurch,
  [Capability.ReportsViewSubtree]: ScopeType.WholeChurch,
  [Capability.AuditView]: ScopeType.WholeChurch,
  [Capability.RecordsBackdateEffectiveDate]: ScopeType.WholeChurch,
  [Capability.SettingsManage]: ScopeType.WholeChurch,
  [Capability.AccountsManage]: ScopeType.WholeChurch,
  [Capability.RolesManage]: ScopeType.WholeChurch,
  [Capability.PeopleMerge]: ScopeType.WholeChurch,
  ...growthAt(ScopeType.WholeChurch, true),
};

const LEADER: RoleDefaults = {
  [Capability.PeopleViewSubtree]: ScopeType.OwnSubtree,
  [Capability.PeopleCreate]: ScopeType.OwnSubtree,
  [Capability.PeopleEditBasic]: ScopeType.OwnSubtree,
  [Capability.PeopleManagePastoralAssignment]: ScopeType.OwnSubtree,
  [Capability.DccTakeAttendance]: ScopeType.OwnSubtree,
  [Capability.DccViewSubtree]: ScopeType.OwnSubtree,
  [Capability.DccCorrectSubtree]: ScopeType.OwnSubtree,
  [Capability.CellTakeAttendance]: ScopeType.OwnSubtree,
  [Capability.CellViewSubtree]: ScopeType.OwnSubtree,
  [Capability.CellCorrectSubtree]: ScopeType.OwnSubtree,
  [Capability.CellManageMembership]: ScopeType.OwnSubtree,
  [Capability.CellManageLeadership]: ScopeType.OwnSubtree,
  [Capability.CellManageConfiguration]: ScopeType.OwnSubtree,
  [Capability.CellRequestLeadership]: ScopeType.SubtreeExclSelf,
  [Capability.CellManageLifecycle]: ScopeType.OwnSubtree,
  [Capability.ReportsViewSubtree]: ScopeType.OwnSubtree,
  ...growthAt(ScopeType.OwnSubtree, false),
};

/**
 * What a Leader account holds only with Full view (section 7, decision 0323): reports and
 * the Training and Conquest capabilities. An account that also holds `SENIOR_PASTOR` or
 * `ADMIN` keeps those roles' defaults whatever Full view says, because only the Leader
 * role's defaults are withheld.
 */
export const LEADER_FULL_VIEW_ONLY: ReadonlySet<Capability> = new Set([
  Capability.ReportsViewSubtree,
  Capability.TrainingViewSubtree,
  Capability.TrainingConfirm,
  Capability.TrainingConfirmOnBehalf,
  Capability.ConquestViewSubtree,
  Capability.ConquestConfirm,
  Capability.ConquestConfirmOnBehalf,
]);

export const ROLE_DEFAULTS: Record<AccountRole, RoleDefaults> = {
  SENIOR_PASTOR: SENIOR_PASTOR,
  ADMIN: ADMIN,
  LEADER: LEADER,
};
