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
  | 'role.granted';

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
export type SettingKey = 'cell_attention_months' | 'initial_encoding_open';

export interface SettingsTable {
  key: SettingKey;
  value: Json;
  /** Null only for the system action that seeds the defaults (section 7). */
  updated_by: string | null;
  updated_at: ServerTimestamp;
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
  audit_log: AuditLogTable;
  idempotency_keys: IdempotencyKeysTable;
  settings: SettingsTable;
}
