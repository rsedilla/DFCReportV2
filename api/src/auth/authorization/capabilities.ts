/**
 * The capabilities of SKILL.md section 7, as a closed enumeration.
 *
 * A guard cannot fail closed against an open list. Adding a capability is an
 * amendment to the specification, a migration on the `capability` type, and a
 * change here, in one change: `capability_grants.capability` stores one of these
 * identifiers and nothing else.
 */

export const Capability = {
  PeopleViewSubtree: 'people.view_subtree',
  PeopleEditBasic: 'people.edit_basic',
  PeopleManageLifecycle: 'people.manage_lifecycle',
  PeopleManagePastoralAssignment: 'people.manage_pastoral_assignment',
  DccTakeAttendance: 'dcc.take_attendance',
  DccViewSubtree: 'dcc.view_subtree',
  DccSubmitOnBehalf: 'dcc.submit_on_behalf',
  DccCorrectSubtree: 'dcc.correct_subtree',
  CellTakeAttendance: 'cell.take_attendance',
  CellViewSubtree: 'cell.view_subtree',
  CellSubmitOnBehalf: 'cell.submit_on_behalf',
  CellCorrectSubtree: 'cell.correct_subtree',
  CellManageMembership: 'cell.manage_membership',
  CellManageLeadership: 'cell.manage_leadership',
  CellRequestCreation: 'cell.request_creation',
  CellApproveCreation: 'cell.approve_creation',
  CellManageLifecycle: 'cell.manage_lifecycle',
  ReportsViewSubtree: 'reports.view_subtree',
  PeopleMerge: 'people.merge',
  RecordsBackdateEffectiveDate: 'records.backdate_effective_date',
  SettingsManage: 'settings.manage',
  AccountsManage: 'accounts.manage',
  RolesManage: 'roles.manage',
  AuditView: 'audit.view',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/** In the order SKILL.md section 7 lists them. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.values(Capability);

/**
 * The five read capabilities. `read_only` is valid only on one of these; a write
 * capability granted read-only is rejected at creation rather than stored as a row
 * that grants nothing (SKILL.md section 7).
 */
export const READ_CAPABILITIES: readonly Capability[] = [
  Capability.PeopleViewSubtree,
  Capability.DccViewSubtree,
  Capability.CellViewSubtree,
  Capability.ReportsViewSubtree,
  Capability.AuditView,
];

export function isReadCapability(capability: Capability): boolean {
  return READ_CAPABILITIES.includes(capability);
}

export function isCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}
