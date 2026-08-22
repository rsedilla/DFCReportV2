/**
 * The role catalog of SKILL.md section 7, transcribed.
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
 */
import { Capability } from './capabilities';
import { ScopeType } from './scopes';

import type { AccountRole } from '../../database/schema';

export type RoleDefaults = Partial<Record<Capability, ScopeType>>;

const SENIOR_PASTOR: RoleDefaults = {
  [Capability.PeopleViewSubtree]: ScopeType.WholeChurch,
  [Capability.PeopleCreate]: ScopeType.WholeChurch,
  [Capability.PeopleEditBasic]: ScopeType.WholeChurch,
  [Capability.PeopleManageLifecycle]: ScopeType.WholeChurch,
  [Capability.PeopleManagePastoralAssignment]: ScopeType.WholeChurch,
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
  // Held at subtree scope by every role: naming oneself on a request is
  // prohibited for everyone (section 10).
  [Capability.CellRequestCreation]: ScopeType.SubtreeExclSelf,
  [Capability.CellManageLifecycle]: ScopeType.WholeChurch,
  [Capability.ReportsViewSubtree]: ScopeType.WholeChurch,
  [Capability.AuditView]: ScopeType.WholeChurch,
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
  [Capability.CellRequestCreation]: ScopeType.SubtreeExclSelf,
  [Capability.CellApproveCreation]: ScopeType.WholeChurch,
  [Capability.CellManageLifecycle]: ScopeType.WholeChurch,
  [Capability.ReportsViewSubtree]: ScopeType.WholeChurch,
  [Capability.AuditView]: ScopeType.WholeChurch,
  [Capability.RecordsBackdateEffectiveDate]: ScopeType.WholeChurch,
  [Capability.SettingsManage]: ScopeType.WholeChurch,
  [Capability.AccountsManage]: ScopeType.WholeChurch,
  [Capability.RolesManage]: ScopeType.WholeChurch,
  [Capability.PeopleMerge]: ScopeType.WholeChurch,
};

const LEADER: RoleDefaults = {
  [Capability.PeopleViewSubtree]: ScopeType.OwnSubtree,
  [Capability.PeopleCreate]: ScopeType.OwnSubtree,
  [Capability.PeopleEditBasic]: ScopeType.OwnSubtree,
  [Capability.PeopleManagePastoralAssignment]: ScopeType.OwnSubtree,
  [Capability.DccTakeAttendance]: ScopeType.OwnSubtree,
  [Capability.DccViewSubtree]: ScopeType.OwnSubtree,
  [Capability.DccSubmitOnBehalf]: ScopeType.OwnSubtree,
  [Capability.DccCorrectSubtree]: ScopeType.OwnSubtree,
  [Capability.CellTakeAttendance]: ScopeType.OwnSubtree,
  [Capability.CellViewSubtree]: ScopeType.OwnSubtree,
  [Capability.CellSubmitOnBehalf]: ScopeType.OwnSubtree,
  [Capability.CellCorrectSubtree]: ScopeType.OwnSubtree,
  [Capability.CellManageMembership]: ScopeType.OwnSubtree,
  [Capability.CellManageLeadership]: ScopeType.OwnSubtree,
  [Capability.CellRequestCreation]: ScopeType.SubtreeExclSelf,
  [Capability.CellManageLifecycle]: ScopeType.OwnSubtree,
  [Capability.ReportsViewSubtree]: ScopeType.OwnSubtree,
};

export const ROLE_DEFAULTS: Record<AccountRole, RoleDefaults> = {
  SENIOR_PASTOR: SENIOR_PASTOR,
  ADMIN: ADMIN,
  LEADER: LEADER,
};
