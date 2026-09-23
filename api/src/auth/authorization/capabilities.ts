/**
 * The capabilities of SKILL.md section 7, as a closed enumeration.
 *
 * The nine Conquest, SUYNL and Training capabilities joined this list and the
 * `capability` enum together, in migration `0017_growth.sql`, which is what this
 * file said would happen when those modules were built (sections 27 and 28).
 *
 * A guard cannot fail closed against an open list. Adding a capability is an
 * amendment to the specification, a migration on the `capability` type, and a
 * change here, in one change: `capability_grants.capability` stores one of these
 * identifiers and nothing else.
 */

export const Capability = {
  PeopleViewSubtree: 'people.view_subtree',
  PeopleCreate: 'people.create',
  PeopleEditBasic: 'people.edit_basic',
  PeopleManageLifecycle: 'people.manage_lifecycle',
  PeopleManagePastoralAssignment: 'people.manage_pastoral_assignment',
  PeopleCorrectSex: 'people.correct_sex',
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
  CellManageConfiguration: 'cell.manage_configuration',
  CellRequestLeadership: 'cell.request_leadership',
  CellApproveLeadership: 'cell.approve_leadership',
  CellManageLifecycle: 'cell.manage_lifecycle',
  ReportsViewSubtree: 'reports.view_subtree',
  PeopleMerge: 'people.merge',
  RecordsBackdateEffectiveDate: 'records.backdate_effective_date',
  SettingsManage: 'settings.manage',
  AccountsManage: 'accounts.manage',
  RolesManage: 'roles.manage',
  AuditView: 'audit.view',
  ConquestViewSubtree: 'conquest.view_subtree',
  ConquestConfirm: 'conquest.confirm',
  ConquestConfirmOnBehalf: 'conquest.confirm_on_behalf',
  SuynlViewSubtree: 'suynl.view_subtree',
  SuynlConfirm: 'suynl.confirm',
  SuynlConfirmOnBehalf: 'suynl.confirm_on_behalf',
  TrainingViewSubtree: 'training.view_subtree',
  TrainingConfirm: 'training.confirm',
  TrainingConfirmOnBehalf: 'training.confirm_on_behalf',
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

/** In the order SKILL.md section 7 lists them. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.values(Capability);

/**
 * The eight read capabilities of the list above. `read_only` is valid only on one
 * of these; a write capability granted read-only is rejected at creation rather
 * than stored as a row that grants nothing (SKILL.md section 7).
 */
export const READ_CAPABILITIES: readonly Capability[] = [
  Capability.PeopleViewSubtree,
  Capability.DccViewSubtree,
  Capability.CellViewSubtree,
  Capability.ReportsViewSubtree,
  Capability.AuditView,
  Capability.ConquestViewSubtree,
  Capability.SuynlViewSubtree,
  Capability.TrainingViewSubtree,
];

export function isReadCapability(capability: Capability): boolean {
  return READ_CAPABILITIES.includes(capability);
}

export function isCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}
