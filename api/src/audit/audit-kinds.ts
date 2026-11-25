import type { AuditAction } from '../database/schema';

/**
 * The chips of the Admin's Audit Log tab (SKILL.md section 19, decision 0428), each a group of
 * actions. `EVERYTHING` belongs to no action: it lists every action but `LOOKUPS`' (decision 0493).
 */
export const AUDIT_KINDS = [
  'EVERYTHING',
  'PEOPLE',
  'MOVES',
  'CELLS',
  'ATTENDANCE',
  'GROWTH',
  'ACCOUNTS',
  'SETTINGS',
  'LOOKUPS',
] as const;

export type AuditKind = (typeof AUDIT_KINDS)[number];

/**
 * Which chip finds each action. A `Record` over every action, so a new action added to the
 * vocabulary does not compile until it is placed (decision 0428, point 2).
 *
 * *Moves* is somebody leaving one leader or Cell for another, which an administrator looks for
 * on its own; joining a first Cell or leaving one without another is *Cells*. It also holds
 * every effective date set in the past, which is one action whatever it dates: a move, a
 * Cell closure or a sex correction. The last two have their own entries under *Cells* and
 * *People*.
 */
export const KIND_OF_ACTION: Record<AuditAction, Exclude<AuditKind, 'EVERYTHING'>> = {
  'person.created': 'PEOPLE',
  'person.updated': 'PEOPLE',
  'person.archived': 'PEOPLE',
  'person.restored': 'PEOPLE',
  'person.merged': 'PEOPLE',
  'network.changed': 'PEOPLE',
  'sex.corrected': 'PEOPLE',
  'effective_date.backdated': 'MOVES',
  'pastoral_assignment.transferred': 'MOVES',
  'cell_membership.moved': 'MOVES',
  'setting.changed': 'SETTINGS',
  'encounter_season.created': 'SETTINGS',
  'encounter_season.changed': 'SETTINGS',
  'account.created': 'ACCOUNTS',
  'account.activated': 'ACCOUNTS',
  'account.activation_resent': 'ACCOUNTS',
  'account.password_reset_sent': 'ACCOUNTS',
  'account.email_corrected': 'ACCOUNTS',
  'account.email_changed': 'ACCOUNTS',
  'account.email_replaced': 'ACCOUNTS',
  'account.disabled': 'ACCOUNTS',
  'account.reactivated': 'ACCOUNTS',
  'account.full_view_changed': 'ACCOUNTS',
  'account.approves_cells_changed': 'ACCOUNTS',
  'account.moves_people_changed': 'ACCOUNTS',
  'account.coordinates_life_class_changed': 'ACCOUNTS',
  'account.coordinates_sol_1_changed': 'ACCOUNTS',
  'account.username_set': 'ACCOUNTS',
  'second_step.set_up': 'ACCOUNTS',
  'second_step.reset': 'ACCOUNTS',
  'second_step.recovery_code_used': 'ACCOUNTS',
  'second_step.paused': 'ACCOUNTS',
  'directory.searched': 'LOOKUPS',
  'equipping_class.clash_checked': 'LOOKUPS',
  'directory.matched': 'LOOKUPS',
  'password.reset': 'ACCOUNTS',
  'password.changed': 'ACCOUNTS',
  'sign_in.paused': 'ACCOUNTS',
  'current_password.paused': 'ACCOUNTS',
  'role.granted': 'ACCOUNTS',
  'cell.created': 'CELLS',
  'cell.closed': 'CELLS',
  'cell_category.changed': 'CELLS',
  'cell_schedule.changed': 'CELLS',
  'cell_membership.added': 'CELLS',
  'cell_membership.ended': 'CELLS',
  'cell_leadership.opened': 'CELLS',
  'cell_leadership.ended': 'CELLS',
  'cell_leadership.changed': 'CELLS',
  'cell_leadership.account_pending': 'CELLS',
  'cell_leadership_request.submitted': 'CELLS',
  'cell_leadership_request.approved': 'CELLS',
  'cell_leadership_request.declined': 'CELLS',
  'dcc_event.created': 'ATTENDANCE',
  'dcc_attendance.submitted_on_behalf': 'ATTENDANCE',
  'dcc_attendance.corrected': 'ATTENDANCE',
  'dcc_attendance.amended': 'ATTENDANCE',
  'cell_attendance.submitted_on_behalf': 'ATTENDANCE',
  'cell_attendance.corrected': 'ATTENDANCE',
  'cell_attendance.amended': 'ATTENDANCE',
  'cell_meeting.rescheduled': 'ATTENDANCE',
  'cell_meeting.not_held': 'ATTENDANCE',
  'cell_meeting.status_corrected': 'ATTENDANCE',
  'cell_meeting.facilitator_recorded': 'ATTENDANCE',
  'suynl_lesson.confirmed': 'GROWTH',
  'suynl_lesson.corrected': 'GROWTH',
  'training_graduation.confirmed': 'GROWTH',
  'training_graduation.corrected': 'GROWTH',
  // Section 29 (decision 0499): the school sits beside Training under Growth until the
  // Audit Log is given a kind of its own for it.
  'equipping_registration.created': 'GROWTH',
  'equipping_registration.cancelled': 'GROWTH',
  'equipping_class.created': 'GROWTH',
  'equipping_class.teacher_named': 'GROWTH',
  'equipping_class.corrected': 'GROWTH',
  'equipping_class.cancelled': 'GROWTH',
  'equipping_class.guide_named': 'GROWTH',
  'equipping_class.guide_removed': 'GROWTH',
  'equipping_enrollment.guide_changed': 'GROWTH',
  'equipping_lesson.recorded': 'GROWTH',
  'equipping_lesson.corrected': 'GROWTH',
  'equipping_make_up.recorded': 'GROWTH',
  'equipping_enrollment.created': 'GROWTH',
  'equipping_enrollment.ended': 'GROWTH',
  'equipping_encounter_enrollment.created': 'GROWTH',
  'equipping_encounter_attendance.recorded': 'GROWTH',
  'equipping_class.checked': 'GROWTH',
  'equipping_final_grade.posted': 'GROWTH',
  'equipping_final_grade.passed_later': 'GROWTH',
};

/** The actions one chip finds. */
export function actionsOfKind(kind: Exclude<AuditKind, 'EVERYTHING'>): AuditAction[] {
  return (Object.keys(KIND_OF_ACTION) as AuditAction[]).filter(
    (action) => KIND_OF_ACTION[action] === kind,
  );
}
