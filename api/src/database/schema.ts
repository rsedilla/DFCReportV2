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

export interface PersonsTable {
  id: Generated<string>;
  member_id: Generated<string>;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: ColumnType<string, string, string>;
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
  issued_at: ServerTimestamp;
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
}
