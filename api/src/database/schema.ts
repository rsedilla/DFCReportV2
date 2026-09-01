/**
 * The database as the query builder sees it.
 *
 * Hand-written, and deliberately so: `migrations/` is the source of truth for the
 * schema, this file is the type view of it, and the two are kept in step by the
 * schema tests in `test/database/`. Nothing here creates, alters or drops
 * anything.
 */
import type { ColumnType, Generated } from 'kysely';

export type Sex = 'MALE' | 'FEMALE';
export type CivilStatus = 'SINGLE' | 'MARRIED' | 'WIDOWED';
export type NetworkName = 'MENS' | 'WOMENS';
export type LifecycleState = 'CURRENT' | 'ARCHIVED';
export type ArchiveReason = 'NO_LONGER_IN_CURRENT_NETWORK' | 'RECORD_CREATED_IN_ERROR' | 'OTHER';
export type AccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED';
export type AccountRole = 'SENIOR_PASTOR' | 'ADMIN' | 'LEADER';
export type AccountTokenPurpose = 'PASSWORD_RESET' | 'ACTIVATION';
export type ScopeTypeValue = 'OWN_SUBTREE' | 'SUBTREE_EXCL_SELF' | 'NETWORK' | 'WHOLE_CHURCH';

/** Written by the database default, never sent by the application. */
type ServerTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/**
 * A `jsonb` column's value. Null is not a member: a nullable jsonb column is
 * written `Json | null`, so the type says which columns may be absent.
 */
export type Json = string | number | boolean | Json[] | { [key: string]: Json | null };

export interface PersonsTable {
  id: Generated<string>;
  member_id: Generated<string>;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: ColumnType<string | null, string | null, string | null>;
  sex: Sex;
  civil_status: CivilStatus;
  mobile_number: string | null;
  mobile_number_normalized: string | null;
  merged_into_id: string | null;
  created_at: ServerTimestamp;
  updated_at: ServerTimestamp;
}

export interface PersonLifecycleTable {
  id: Generated<string>;
  person_id: string;
  state: LifecycleState;
  reason: ArchiveReason | null;
  note: string | null;
  actor_id: string | null;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface NetworkAssignmentsTable {
  id: Generated<string>;
  person_id: string;
  network: NetworkName;
  reason: string | null;
  actor_id: string | null;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface PastoralAssignmentsTable {
  id: Generated<string>;
  person_id: string;
  /** Null only for a Network root leader (SKILL.md section 5, Network roots). */
  leader_id: string | null;
  /**
   * The root seat for a Network, non-null on exactly the rows whose `leader_id`
   * is null (migration 0008). A partial unique index over it is what makes
   * section 5's "exactly one root leader" per Network enforced rather than
   * asserted, and a constraint trigger checks it against the person's own Network
   * so the seat cannot be claimed dishonestly.
   */
  root_network: NetworkName | null;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface AccountsTable {
  id: Generated<string>;
  person_id: string;
  email: string;
  email_normalized: string;
  password_hash: string | null;
  status: Generated<AccountStatus>;
  sessions_revoked_at: Date | null;
  last_login_at: Date | null;
  created_at: ServerTimestamp;
  updated_at: ServerTimestamp;
}

export interface AccountRolesTable {
  id: Generated<string>;
  account_id: string;
  role: AccountRole;
  /**
   * One of the two Senior Pastor slots (SKILL.md section 7). Required where the
   * role is SENIOR_PASTOR and null otherwise; a partial unique index over it is
   * what caps the role at the two Persons section 4 names.
   */
  senior_pastor_slot: number | null;
  granted_by: string | null;
  granted_at: ServerTimestamp;
  revoked_at: Date | null;
}

export interface CapabilityGrantsTable {
  id: Generated<string>;
  account_id: string;
  capability: string;
  scope_type: ScopeTypeValue;
  scope_network: NetworkName | null;
  read_only: Generated<boolean>;
  /** Required. A grant explains itself (SKILL.md section 7). */
  reason: string;
  /** Required. An explicit grant is always issued by an Admin. */
  granted_by: string;
  granted_at: ServerTimestamp;
  revoked_at: Date | null;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  device_label: string | null;
  replaced_by_id: string | null;
  /**
   * Written by the application, never left to the column default. It is compared
   * against `accounts.sessions_revoked_at` and against a JWT's `iat`, both of
   * which the application stamps, and the database's clock is a different one.
   * Required on insert so the compiler holds that at every path.
   */
  issued_at: ColumnType<Date, Date, Date>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface AccountTokensTable {
  id: Generated<string>;
  account_id: string;
  purpose: AccountTokenPurpose;
  token_hash: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  used_at: Date | null;
  created_at: ServerTimestamp;
}

/**
 * SKILL.md section 21 opens its list of auditable actions with "including", so
 * unlike the capability list in section 7 it is not a closed enumeration and is
 * deliberately not modelled as one. The column is `text` with a shape check; this
 * type carries the identifiers that exist today, so a typo is a compile error
 * while an addition stays a one-line change rather than an amendment.
 */
export type AuditAction =
  | 'person.created'
  | 'person.updated'
  | 'pastoral_assignment.transferred'
  | 'network.changed'
  | 'sex.corrected'
  | 'effective_date.backdated'
  | 'setting.changed'
  // Section 21 lists "Account creation/activation/disablement" and "Role/permission
  // changes" as separate auditable actions, so each is a separate entry rather than
  // one describing a provisioning request: a reader searching for role grants must
  // find that entry whether it arose from provisioning or from a later change.
  | 'account.created'
  | 'account.activated'
  | 'account.activation_resent'
  // `password.reset`, not `account.password_reset`: section 21's convention is
  // `<noun>.<past-tense verb>`, and "password_reset" is a noun phrase. The noun is
  // the thing the action happened to.
  | 'password.reset'
  | 'role.granted'
  // Section 21's convention, `<noun>.<past-tense verb>`. Two entries rather than
  // one, on the same reasoning as the account pair above: creating a Cell and
  // opening the leadership assignment that makes somebody a current Cell Leader
  // (section 11) are separately auditable facts, and a reader searching for who
  // began leading a Cell must find that entry whether it arose from the
  // initial-encoding path or from an approval.
  | 'cell.created'
  // **All three leadership actions target the Cell** (section 21, settled 2026-08-31).
  // Section 7 resolves an audit entry's scope through its target and resolves a
  // leadership through the Cell's leader as of the period, falling back to its last
  // leader once the Cell is closed. `opened` named the person until then, so the three
  // did not agree and nothing had decided that they should not.
  //
  // `cell_leadership.account_pending` below carries the same noun and is outside the
  // rule: section 21 lists it separately, and what is pending is a provisioning step on
  // a Person (section 6), so it names that Person.
  // Section 21 lists "DCC event removed from the calendar, with reason" and names
  // no counterpart for creating one, because its list opens with "including".
  // Generating the calendar is an act somebody scheduled that changes what every
  // month's N is measured against, so it is audited on the same footing as removing
  // a Sunday — one entry per event, targeting the event's own date, which is what
  // section 9 makes the identity of an event.
  | 'dcc_event.created'
  // Section 21 lists "Attendance submission on behalf" and "Attendance corrections"
  // and lists no ordinary first submission, so these are the two that exist. A
  // submission a leader makes for their own checklist writes no entry: it is the
  // record itself, and `dcc_attendance` is append-only and carries its actor.
  //
  // **Both target the Person**, on the reasoning that settled the Cell leadership
  // trio above. Section 7 resolves an audit entry's scope through its target, a
  // Person resolves through their pastoral position, and section 7 says in terms
  // that a DCC event "resolves through nothing" -- so an entry targeting the event
  // would be readable by nobody's scope.
  | 'dcc_attendance.submitted_on_behalf'
  | 'dcc_attendance.corrected'
  // The Cell counterpart of the pair above, on the same reading of section 21: it
  // lists "Attendance submission on behalf" without naming a domain, and lists no
  // ordinary first submission — which is the record itself. `cell_attendance` rather
  // than `cell_meeting`, so the two domains carry one noun for one concept, and
  // because what section 21 is auditing is somebody recording attendance for people
  // who are not their own.
  //
  // **It targets the Cell**, unlike its DCC twin, which targets the Person. Section 7
  // resolves an entry's scope through its target and resolves a Cell meeting through
  // the Cell's leader; the DCC twin names a Person because a DCC event "is church-wide
  // and resolves through nothing". Same rule, different targets, because the two
  // domains hang their attendance off different things.
  | 'cell_attendance.submitted_on_behalf'
  | 'cell_leadership.opened'
  // Section 21 lists this as an action in its own right: "Cell leadership assignment
  // left with account provisioning pending". It names a state rather than an actor,
  // and every Cell created outside an approval is in it until somebody provisions
  // the account (section 6, section 7).
  | 'cell_leadership.account_pending'
  // Section 21 names three: "Cell membership added, moved, or ended". Three actions
  // rather than the two an earlier version had, and a move is **one** entry rather
  // than an ending plus an opening — section 21 asks for one entry per action
  // performed, and a move is one action. Its `before` names the Cell left and its
  // `after` the Cell joined, so a reader searching for moves has something to search
  // on and a reader asking who left a Cell finds it against that Cell.
  //
  // `added` rather than `opened`, matching section 21's own noun.
  | 'cell_membership.added'
  | 'cell_membership.moved'
  | 'cell_membership.ended'
  // Section 10 requires a category change and a schedule change to be audited, and
  // section 7 governs both with one capability. Two actions rather than one, because
  // section 21 asks for one entry per action performed and these are different facts
  // with different effective dates — a category change takes effect the day it is
  // made, a schedule change at the start of the following month.
  //
  // `cell_category` and `cell_schedule` rather than `cell`, matching
  // `cell_membership` above: the noun is the thing that changed, so a reader asking
  // when a Cell last moved its meeting day has something to search on.
  | 'cell_category.changed'
  | 'cell_schedule.changed'
  // Section 21 lists "Cell closure with reason". One entry for the closure itself,
  // and the membership entries above carry the dispersals — a dispersal *is* a move
  // and leaving somebody unassigned *is* an ending, so a reader searching for either
  // must find them whichever operation performed them.
  | 'cell.closed'
  // Section 21 lists "Cell leadership opened, ended, or changed, carrying the
  // outgoing and the incoming leader where each exists — a reader asking who led a
  // Cell before a handover must find it here".
  //
  // **An earlier version of this comment argued a closure needed no such entry**,
  // because the ending "is not a separate decision, and its date is the closure's".
  // That is the argument the membership pair above rejects, and section 21 makes no
  // exception for leadership. A closure writes one with a null incoming leader.
  //
  // *Two earlier claims about this are withdrawn.* It said "the opened half arrives with
  // the handover workflow" — `cell_leadership.opened` is above, predates it, and is
  // written by direct creation. And it said the null incoming leader "is what
  // distinguishes a closure from a handover in the log", which stopped being true the
  // moment a handover got an action of its own: a handover writes neither of these, it
  // is one action and writes `changed`, below. What a closure's entry is distinguished
  // *from* is nothing — it is the only writer of this action.
  | 'cell_leadership.ended'
  // A handover, which is one action rather than an ending beside an opening: section
  // 10 has the outgoing assignment end and the incoming one open "at the same
  // instant", in one statement, so a log splitting them would report two events at one
  // timestamp and leave a reader to pair them. The entry carries both leaders, which
  // is what section 21 asks of it.
  | 'cell_leadership.changed'
  // Section 21 names three request actions, all under one noun: "Cell leadership
  // request submitted / approved / declined, with the kind" (and the reason, for a
  // decline).
  //
  // **Section 21's first line said "Cell leadership requested" and was amended rather
  // than transliterated.** Read literally it gives `cell_leadership.requested`, which
  // would put one workflow's three actions under two nouns — and a reader asking how a
  // leader was developed, which is exactly what section 10 calls the retained decline
  // record, would have to know both to find the whole of it. The convention is
  // `<noun>.<past-tense verb>` and the noun is the thing the action happened to: a
  // request is submitted, approved and declined, whereas no leadership exists yet to be
  // "requested" and none at all is touched by a decline. Section 21's list opens with
  // "including", so rewording one bullet is a wording change rather than a rule change
  // — and it is the amendment rather than a comment here that keeps the two agreeing.
  //
  // `approved` arrived with the approval endpoint rather than ahead of it, on the rule
  // this comment previously stated as a promise: a member of a closed union that
  // nothing writes is the shape this repository has already removed once, from
  // `PRECONDITION_CODES`.
  | 'cell_leadership_request.submitted'
  | 'cell_leadership_request.approved'
  | 'cell_leadership_request.declined';

export interface AuditLogTable {
  id: Generated<string>;
  /** Null only for a system action (SKILL.md section 21). */
  actor_id: string | null;
  action: AuditAction;
  target_type: string;
  /**
   * `text` rather than `uuid`, and required. Not every target is identified by a
   * UUID: `settings` is keyed by `key` (SKILL.md section 7), and a setting change
   * is on section 21's list of auditable actions.
   */
  target_id: string;
  before: Json | null;
  after: Json | null;
  reason: string | null;
  /** Groups the per-record entries of one bulk import (SKILL.md section 2). */
  batch_id: string | null;
  occurred_at: ServerTimestamp;
}

export type CellState = 'ACTIVE' | 'CLOSED';
export type CellCategory = 'YOUTH' | 'YOUNG_PRO' | 'COUPLE';
export type CellClosureReason =
  | 'MERGED_INTO_ANOTHER_CELL'
  | 'LEADER_STEPPED_DOWN'
  | 'MEMBERS_DISPERSED'
  | 'CREATED_IN_ERROR'
  | 'OTHER';
export type CellRequestKind = 'NEW_CELL' | 'HANDOVER';
export type CellRequestState = 'PENDING' | 'APPROVED' | 'DECLINED';
export type CellDeclineReason =
  | 'LEADER_DEVELOPMENT_CONTINUING'
  | 'TIMING_DEFERRED'
  | 'DUPLICATE_REQUEST'
  | 'SUBMITTED_IN_ERROR'
  | 'OTHER';

/**
 * ISO 8601 day number: 1 is Monday, 7 is Sunday, matching `EXTRACT(ISODOW ...)`
 * and the Monday week boundary of SKILL.md section 20. Not a union of literals:
 * the value is arithmetic against a calendar, and a check constraint holds the
 * range in the database.
 */
export type IsoDayOfWeek = number;

/**
 * Leader, category and schedule are deliberately not columns here. Each carries
 * history the specification guarantees and lives in its own effective-dated table
 * (SKILL.md section 10, section 26).
 */
export interface CellsTable {
  id: Generated<string>;
  cell_id: Generated<string>;
  state: Generated<CellState>;
  /** The closure's effective date, and the date its leadership and memberships ended on. */
  closed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  closure_reason: CellClosureReason | null;
  /** Required where the reason is `OTHER`, and forbidden where there is no reason. */
  closure_note: string | null;
  created_at: ServerTimestamp;
}

export interface CellCategoriesTable {
  id: Generated<string>;
  cell_id: string;
  category: CellCategory;
  actor_id: string | null;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

/**
 * `id` and `actor_id` are beyond the shape section 10 first gave, and were added
 * to it in the same change as migration 0009: every other effective-dated table
 * here has a primary key, and section 10 says a schedule change is audited as a
 * category change is.
 */
export interface CellSchedulesTable {
  id: Generated<string>;
  cell_id: string;
  day_of_week: IsoDayOfWeek;
  /** Wall-clock time in Asia/Manila (section 20), with no offset of its own. */
  time_of_day: string;
  actor_id: string | null;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface CellLeadershipsTable {
  id: Generated<string>;
  person_id: string;
  cell_id: string;
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface CellMembershipsTable {
  id: Generated<string>;
  person_id: string;
  cell_id: string;
  /** Section 10's optional "source/reason"; free text, explaining an ordinary move. */
  reason: string | null;
  /**
   * No `actor_id`. Section 10 puts the actor in the audit entry rather than on the
   * row, and `pastoral_assignments` -- the closest analogue here -- does the same.
   */
  started_at: ColumnType<Date, Date | string, Date | string>;
  ended_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

/**
 * One table, two kinds (SKILL.md section 10, Creating a Cell). `kind` decides
 * which columns are required, and `cell_id` is the one column meaning something
 * different in each: for a handover it names the Cell at request, and for a
 * creation nothing names it until approval mints it.
 *
 * `requested_by` and `decided_by` are accounts, as every actor column here is.
 * The prohibition on naming yourself therefore cannot be a check constraint --
 * `prospective_leader_id` is a Person -- and is a domain check in `cells`.
 */
export interface CellLeadershipRequestsTable {
  id: Generated<string>;
  kind: CellRequestKind;
  prospective_leader_id: string;
  requested_by: string;
  /** Required where the kind is `NEW_CELL`, and absent on a handover. */
  category: CellCategory | null;
  day_of_week: IsoDayOfWeek | null;
  time_of_day: string | null;
  state: Generated<CellRequestState>;
  decline_reason: CellDeclineReason | null;
  /** Required where the decline reason is `OTHER`. */
  note: string | null;
  decided_by: string | null;
  /** Required for a handover; null on a new Cell until approval sets it. */
  cell_id: string | null;
  requested_at: ServerTimestamp;
  decided_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export type IdempotencyState = 'IN_FLIGHT' | 'COMPLETED';

export interface IdempotencyKeysTable {
  key: string;
  account_id: string;
  request_fingerprint: string;
  state: IdempotencyState;
  response_status: number | null;
  response_body: Json | null;
  /**
   * Identifies one claim on this key. A takeover under the lease mints a new one,
   * so a request that has lost the key matches nothing rather than acting on the
   * claim that replaced it (SKILL.md section 22).
   */
  claim_id: Generated<string>;
  /**
   * When this attempt was claimed, which bounds how long it may sit unfinished
   * (SKILL.md section 22). Distinct from `expires_at`, which is how long the
   * response is retained: one bounds an attempt, the other keeps an answer.
   */
  claimed_at: ServerTimestamp;
  created_at: ServerTimestamp;
  expires_at: ColumnType<Date, Date | string, Date | string>;
}

/**
 * The key set is fixed by SKILL.md section 7, not open. A check constraint holds
 * the same two names in the database.
 */
export type SettingKey =
  | 'cell_attention_months'
  | 'initial_encoding_open'
  /**
   * The first Sunday the DCC calendar covers (section 9). Seeded null and set
   * once by the generation command's first run; an Admin may move it afterwards.
   */
  | 'dcc_calendar_start';

export interface SettingsTable {
  key: SettingKey;
  value: Json;
  /** Null only for the system action that seeds the defaults (section 7). */
  updated_by: string | null;
  updated_at: ServerTimestamp;
}

/**
 * Attendance (SKILL.md sections 9, 12, 13 and 14), migration 0011.
 *
 * **Every date-only column is `string`, and that is the section 22 rule rather than
 * a convenience.** A meeting date, an event date and a reporting month are Manila
 * calendar days; the driver is configured to hand back OID 1082 as the server's raw
 * `YYYY-MM-DD` text rather than as an instant, precisely so a day never becomes a
 * timestamp on the way through. `birth_date` above is the same type for the same
 * reason.
 */
export type CellMeetingStatus = 'HELD' | 'RESCHEDULED' | 'NOT_HELD';

/**
 * Section 13 fixes this list and says why: reasons editable at runtime make
 * reporting incomparable across periods. Adding one is an amendment to the
 * specification, a migration, and a change here.
 */
export type CellMeetingNotHeldReason =
  | 'LEADER_UNAVAILABLE'
  | 'WEATHER_OR_CALAMITY'
  | 'HOLIDAY_OR_CHURCH_EVENT'
  | 'NO_MEMBERS_AVAILABLE'
  | 'OTHER';

/** A Manila calendar day, as the server renders it. Never an instant (section 22). */
type DateOnly = ColumnType<string, string, string>;

export interface DccEventsTable {
  id: Generated<string>;
  event_date: DateOnly;
  removed_at: Date | null;
  removed_by: string | null;
  removal_reason: string | null;
  created_at: ServerTimestamp;
}

export interface DccAttendanceTable {
  id: Generated<string>;
  dcc_event_id: string;
  person_id: string;
  present: boolean;
  /**
   * The person's direct pastoral leader as of the event date, fixed (section 9).
   * Null only for a Network root, who has none; the service refuses a Person with
   * no open assignment rather than writing null for them, because the two states
   * are different and only the first is a root.
   */
  responsible_leader_id: string | null;
  recorded_by: string;
  recorded_at: ServerTimestamp;
  superseded_at: Date | null;
  /** The row that replaced this one, not an actor (section 9). */
  superseded_by: string | null;
  correction_reason: string | null;
  version: Generated<number>;
}

export interface CellMeetingsTable {
  id: Generated<string>;
  cell_id: string;
  /** The identity, with `cell_id` (ruling of 2026-08-31). */
  scheduled_date: DateOnly;
  scheduled_time: string;
  /** Derived from `scheduled_date` and checked by the database, not trusted. */
  week_starting: DateOnly;
  reporting_month: DateOnly;
  status: CellMeetingStatus;
  actual_date: DateOnly | null;
  actual_time: string | null;
  not_held_reason: CellMeetingNotHeldReason | null;
  not_held_note: string | null;
  /** Null means the responsible leader ran it, which is the ordinary case. */
  facilitated_by: string | null;
  /** Frozen at first write and never re-resolved (rulings of 2026-08-31). */
  responsible_leader_id: string;
  submitted_by: string | null;
  submitted_at: Date | null;
  /** The unit a Cell submission compares (section 14). */
  version: Generated<number>;
  created_at: ServerTimestamp;
}

export interface CellAttendanceTable {
  id: Generated<string>;
  cell_meeting_id: string;
  person_id: string;
  present: boolean;
  recorded_by: string;
  recorded_at: ServerTimestamp;
  superseded_at: Date | null;
  superseded_by: string | null;
  correction_reason: string | null;
  /** Guards a correction to one person's record, not a submission (section 14). */
  version: Generated<number>;
}

export interface CellMeetingChangesTable {
  id: Generated<string>;
  cell_meeting_id: string;
  from_status: CellMeetingStatus;
  to_status: CellMeetingStatus;
  from_date: DateOnly | null;
  from_time: string | null;
  to_date: DateOnly | null;
  to_time: string | null;
  reason: CellMeetingNotHeldReason | null;
  note: string | null;
  actor_id: string;
  occurred_at: ServerTimestamp;
}

export interface Database {
  persons: PersonsTable;
  person_lifecycle: PersonLifecycleTable;
  network_assignments: NetworkAssignmentsTable;
  pastoral_assignments: PastoralAssignmentsTable;
  accounts: AccountsTable;
  account_roles: AccountRolesTable;
  capability_grants: CapabilityGrantsTable;
  refresh_tokens: RefreshTokensTable;
  account_tokens: AccountTokensTable;
  cells: CellsTable;
  cell_categories: CellCategoriesTable;
  cell_schedules: CellSchedulesTable;
  cell_leaderships: CellLeadershipsTable;
  cell_memberships: CellMembershipsTable;
  cell_leadership_requests: CellLeadershipRequestsTable;
  dcc_events: DccEventsTable;
  dcc_attendance: DccAttendanceTable;
  cell_meetings: CellMeetingsTable;
  cell_attendance: CellAttendanceTable;
  cell_meeting_changes: CellMeetingChangesTable;
  audit_log: AuditLogTable;
  idempotency_keys: IdempotencyKeysTable;
  settings: SettingsTable;
}
