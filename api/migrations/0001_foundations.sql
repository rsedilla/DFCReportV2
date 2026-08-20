-- Stage 1 foundations.
--
-- Every structure here is required by SKILL.md and indexed in SKILL.md section 26.
-- Constraint DDL is hand-written (CLAUDE.md, Definition of Done -> Migration policy);
-- nothing in this file is generated, and nothing here may be regenerated from a model.
--
-- Tables created:
--   persons, person_lifecycle          section 3
--   network_assignments                section 4
--   pastoral_assignments               section 5
--   accounts, refresh_tokens,
--   account_tokens                     section 6
--   account_roles, capability_grants   section 7, How grants are held
--
-- The tables for cells, attendance, reporting, audit and settings arrive with the
-- stages that own them, each named in docs/ROADMAP.md. Their indexes arrive in the
-- same migration as their tables, which is what SKILL.md section 2 asks for: the
-- point being that an index reporting depends on is never a later errand.
--
-- `audit_log` and `idempotency_keys` arrive in Stage 2, with the first write
-- endpoint. Section 5 requires every reassignment to be audit logged and section
-- 22 requires an idempotency key on every state-changing request, so neither can
-- wait for the stage that merely makes heavy use of it.
--
-- `actor_id` throughout references `accounts (id)`. The actor is the authenticated
-- account that performed the action, and is null only for a system action
-- (SKILL.md section 21).

-- migrate:up

-- ---------------------------------------------------------------------------
-- Enumerations
--
-- Each of these is a closed enumeration in SKILL.md. A closed enumeration in the
-- specification and a free-text column in the database are not the same rule, and
-- the database is where the last check happens (section 25, rules 5-9).
-- ---------------------------------------------------------------------------

CREATE TYPE sex AS ENUM ('MALE', 'FEMALE');

CREATE TYPE civil_status AS ENUM ('SINGLE', 'MARRIED', 'WIDOWED');

CREATE TYPE network AS ENUM ('MENS', 'WOMENS');

CREATE TYPE lifecycle_state AS ENUM ('CURRENT', 'ARCHIVED');

CREATE TYPE archive_reason AS ENUM (
  'NO_LONGER_IN_CURRENT_NETWORK',
  'RECORD_CREATED_IN_ERROR',
  'OTHER'
);

CREATE TYPE account_status AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED');

CREATE TYPE account_role AS ENUM ('SENIOR_PASTOR', 'ADMIN', 'LEADER');

CREATE TYPE account_token_purpose AS ENUM ('PASSWORD_RESET', 'ACTIVATION');

-- The twenty-four capabilities of SKILL.md section 7, in the order the
-- specification lists them. Adding one is an amendment to the specification and a
-- migration, never a runtime action.
CREATE TYPE capability AS ENUM (
  'people.view_subtree',
  'people.edit_basic',
  'people.manage_lifecycle',
  'people.manage_pastoral_assignment',
  'dcc.take_attendance',
  'dcc.view_subtree',
  'dcc.submit_on_behalf',
  'dcc.correct_subtree',
  'cell.take_attendance',
  'cell.view_subtree',
  'cell.submit_on_behalf',
  'cell.correct_subtree',
  'cell.manage_membership',
  'cell.manage_leadership',
  'cell.request_creation',
  'cell.approve_creation',
  'cell.manage_lifecycle',
  'reports.view_subtree',
  'people.merge',
  'records.backdate_effective_date',
  'settings.manage',
  'accounts.manage',
  'roles.manage',
  'audit.view'
);

CREATE TYPE scope_type AS ENUM (
  'OWN_SUBTREE',
  'SUBTREE_EXCL_SELF',
  'NETWORK',
  'WHOLE_CHURCH'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- persons (SKILL.md section 3)
--
-- Lifecycle, Network, pastoral assignment, Cell membership and Cell leadership are
-- deliberately not columns here. Each carries history the specification guarantees
-- and lives in its own effective-dated table.
-- ---------------------------------------------------------------------------

-- Member IDs are drawn from a sequence: server-assigned, never reused, gaps
-- expected. A rolled-back transaction consumes a value and that is accepted
-- (section 3, Member ID generation).
CREATE SEQUENCE member_id_seq AS bigint START WITH 1 NO CYCLE;

CREATE TABLE persons (
  -- The UUID may be client-generated so a Person created offline keeps their
  -- identity on sync (section 3, Two identifiers, two jobs; section 23).
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text NOT NULL UNIQUE
    DEFAULT 'M-' || lpad(nextval('member_id_seq')::text, 6, '0'),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  birth_date date NOT NULL,
  sex sex NOT NULL,
  civil_status civil_status NOT NULL,
  -- The only contact detail the system holds. Stored as entered, with a
  -- normalized form beside it for dialling and duplicate matching (section 3).
  mobile_number text,
  mobile_number_normalized text,
  -- Set where this Person was absorbed by a merge; the surviving Person is the
  -- only valid target of any later write (section 3, Person Merge).
  merged_into_id uuid REFERENCES persons (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persons_first_name_not_blank CHECK (btrim(first_name) <> ''),
  CONSTRAINT persons_last_name_not_blank CHECK (btrim(last_name) <> ''),
  CONSTRAINT persons_member_id_format CHECK (member_id ~ '^M-[0-9]{6,}$'),
  CONSTRAINT persons_not_merged_into_self CHECK (merged_into_id IS DISTINCT FROM id)
);

CREATE INDEX persons_merged_into_id_idx ON persons (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

CREATE TRIGGER persons_set_updated_at
  BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A Member ID appears in printed reports and in the memory of the people who use
-- them. It is assigned once and immutable thereafter (section 3), which is a rule
-- an UPDATE can break and therefore a rule the database holds.
CREATE FUNCTION persons_member_id_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'member_id is immutable (person %, % -> %)',
      OLD.id, OLD.member_id, NEW.member_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER persons_member_id_immutable
  BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION persons_member_id_is_immutable();

-- ---------------------------------------------------------------------------
-- accounts (SKILL.md section 6)
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One Person has at most one Account, whatever number of Cells they lead.
  person_id uuid NOT NULL UNIQUE REFERENCES persons (id),
  -- Unique after normalization. `email` holds the address as entered;
  -- `email_normalized` is what uniqueness and lookup use.
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  password_hash text,
  status account_status NOT NULL DEFAULT 'PENDING_ACTIVATION',
  -- The account-wide revocation marker. Every request compares the access
  -- token's issued-at against this, so revocation takes effect on all devices
  -- immediately rather than after the token expires (section 6).
  sessions_revoked_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_email_not_blank CHECK (btrim(email) <> ''),
  -- An account cannot be ACTIVE without a password: activation is what sets one.
  CONSTRAINT accounts_active_has_password
    CHECK (status <> 'ACTIVE' OR password_hash IS NOT NULL)
);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- person_lifecycle (SKILL.md section 3, Person Lifecycle)
-- ---------------------------------------------------------------------------

CREATE TABLE person_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  state lifecycle_state NOT NULL,
  reason archive_reason,
  note text,
  actor_id uuid REFERENCES accounts (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT person_lifecycle_period_ordered
    CHECK (ended_at IS NULL OR ended_at > started_at),
  -- A reason belongs to an archive. Restoring to CURRENT carries no archive reason.
  CONSTRAINT person_lifecycle_reason_only_on_archive
    CHECK (state = 'ARCHIVED' OR reason IS NULL),
  CONSTRAINT person_lifecycle_other_requires_note
    CHECK (reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(note, '')) <> '')
);

CREATE UNIQUE INDEX person_lifecycle_one_open
  ON person_lifecycle (person_id)
  WHERE ended_at IS NULL;

CREATE INDEX person_lifecycle_as_of_idx
  ON person_lifecycle (person_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- network_assignments (SKILL.md section 4, Network assignment history)
-- ---------------------------------------------------------------------------

CREATE TABLE network_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  network network NOT NULL,
  reason text,
  actor_id uuid REFERENCES accounts (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT network_assignments_period_ordered
    CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE UNIQUE INDEX network_assignments_one_open
  ON network_assignments (person_id)
  WHERE ended_at IS NULL;

CREATE INDEX network_assignments_as_of_idx
  ON network_assignments (person_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- pastoral_assignments (SKILL.md section 5)
--
-- The three database-expressible invariants of section 5 are below, under the
-- names the specification gives them. Cycles are not expressible as a row-level
-- constraint and are rejected in the `hierarchy` domain layer, with every
-- recursive query carrying its own CYCLE clause as the backstop.
-- ---------------------------------------------------------------------------

CREATE TABLE pastoral_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  -- Null only for a Network root leader, who has no leader above them
  -- (section 5, Network roots). A root is never represented as a row pointing
  -- at itself: that would be a one-node cycle, and the check below rejects it.
  leader_id uuid REFERENCES persons (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT pastoral_assignments_no_self CHECK (person_id <> leader_id),
  CONSTRAINT pastoral_assignments_period_ordered
    CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- Invariant 3: at most one active assignment. The partial index permits zero rows
-- and forbids two, including under concurrent writes, which is the case an
-- application-layer check cannot cover.
CREATE UNIQUE INDEX pastoral_assignments_one_active
  ON pastoral_assignments (person_id)
  WHERE ended_at IS NULL;

-- Subtree traversal walks by leader. Required in the first migration by
-- SKILL.md section 2, Scale.
CREATE INDEX pastoral_assignments_active_by_leader
  ON pastoral_assignments (leader_id)
  WHERE ended_at IS NULL;

-- As-of resolution for a past period reads by leader across the period.
CREATE INDEX pastoral_assignments_leader_period
  ON pastoral_assignments (leader_id, started_at DESC, ended_at);

CREATE INDEX pastoral_assignments_person_period
  ON pastoral_assignments (person_id, started_at DESC, ended_at);

-- ---------------------------------------------------------------------------
-- The same-Network edge (SKILL.md section 5, invariant 5)
--
-- Network is effective-dated on the Person rather than stored on the assignment
-- row, so this cannot be a check constraint. It is a constraint trigger, and it
-- is DEFERRABLE INITIALLY DEFERRED because section 4 requires a Network change
-- and the reassignment it forces to happen in one atomic operation: either alone
-- leaves the tree invalid, so a trigger firing per statement would reject
-- whichever ran first and make the mandated operation unperformable.
--
-- The two firing paths compare against different dates, and one rule cannot serve
-- both. Each function says which date it uses and why.
-- ---------------------------------------------------------------------------

CREATE FUNCTION network_as_of(p_person_id uuid, p_at timestamptz) RETURNS network
LANGUAGE sql STABLE AS $$
  SELECT na.network
    FROM network_assignments na
   WHERE na.person_id = p_person_id
     AND na.started_at <= p_at
     AND (na.ended_at IS NULL OR na.ended_at > p_at)
   ORDER BY na.started_at DESC
   LIMIT 1;
$$;

-- On a write to pastoral_assignments: compare the Networks in force as of the
-- assignment's own started_at. An edge must have been legal when it was created,
-- and where Admin backdates one under records.backdate_effective_date, validating
-- against now would reject a correction that was true at the time.
CREATE FUNCTION assert_assignment_same_network() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row pastoral_assignments%ROWTYPE;
  v_person network;
  v_leader network;
BEGIN
  -- Deferred to commit, so read the row as it finally stands rather than as it
  -- stood when the statement ran. A row inserted and then deleted in the same
  -- transaction has nothing left to validate.
  SELECT * INTO v_row FROM pastoral_assignments WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A Network root has no leader to compare against (section 5, Network roots).
  IF v_row.leader_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_person := network_as_of(v_row.person_id, v_row.started_at);
  v_leader := network_as_of(v_row.leader_id, v_row.started_at);

  IF v_person IS NULL OR v_leader IS NULL THEN
    RAISE EXCEPTION
      'pastoral assignment %: Network is unknown for person % or leader % as of %',
      v_row.id, v_row.person_id, v_row.leader_id, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_person <> v_leader THEN
    RAISE EXCEPTION
      'pastoral assignment % crosses Networks: leader % is %, person % is %, as of %',
      v_row.id, v_row.leader_id, v_leader, v_row.person_id, v_person, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pastoral_assignments_same_network
  AFTER INSERT OR UPDATE ON pastoral_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_assignment_same_network();

-- On a Network change: compare as of the Network change's own effective date,
-- against every assignment that is open at that date or starts after it. That
-- means both the person's assignment to their leader and the assignments of
-- everyone under them. Using the assignment's started_at here would make the
-- check a no-op: a person assigned in January under a same-Network leader, whose
-- Network is corrected in August, would be compared against January's Networks,
-- which matched.
--
-- "or starts after it" is not decoration. records.backdate_effective_date lets
-- Admin set the effective date in the past, and an assignment that begins after
-- that date is not open at it. Considering only what was open then would let a
-- correction backdated to April commit while a June edge, legal when it was
-- made, becomes cross-Network with nothing left to complain: no row of
-- pastoral_assignments is written, so the other trigger never fires either.
--
-- Each edge is compared as of the later of the two dates, which is the moment
-- the corrected Network governs it (section 4, section 5, Effective dating).
CREATE FUNCTION assert_network_change_keeps_edges() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row network_assignments%ROWTYPE;
  v_edge record;
  v_at timestamptz;
  v_person network;
  v_leader network;
BEGIN
  SELECT * INTO v_row FROM network_assignments WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR v_edge IN
    SELECT pa.id, pa.person_id, pa.leader_id, pa.started_at
      FROM pastoral_assignments pa
     WHERE pa.leader_id IS NOT NULL
       AND (pa.person_id = v_row.person_id OR pa.leader_id = v_row.person_id)
       AND (pa.ended_at IS NULL OR pa.ended_at > v_row.started_at)
  LOOP
    v_at := GREATEST(v_edge.started_at, v_row.started_at);

    v_person := network_as_of(v_edge.person_id, v_at);
    v_leader := network_as_of(v_edge.leader_id, v_at);

    IF v_person IS NULL OR v_person IS DISTINCT FROM v_leader THEN
      RAISE EXCEPTION
        'Network change for person % leaves pastoral assignment % crossing Networks as of %; reassign in the same operation',
        v_row.person_id, v_edge.id, v_at
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER network_assignments_keep_edges_same_network
  AFTER INSERT OR UPDATE ON network_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_network_change_keeps_edges();

-- ---------------------------------------------------------------------------
-- account_roles (SKILL.md section 7, How grants are held)
-- ---------------------------------------------------------------------------

CREATE TABLE account_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  role account_role NOT NULL,
  -- Null only for a role granted by a system action, which is the first Admin
  -- account and nothing else: there is no account above it to have granted it.
  -- Every later grant has an actor (section 7, section 21).
  granted_by uuid REFERENCES accounts (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT account_roles_period_ordered
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- An account holds at most one active row per role.
CREATE UNIQUE INDEX account_roles_one_active
  ON account_roles (account_id, role)
  WHERE revoked_at IS NULL;

CREATE INDEX account_roles_active_by_account
  ON account_roles (account_id)
  WHERE revoked_at IS NULL;

-- SENIOR_PASTOR is held by exactly the two Persons named in section 4, and by
-- nobody else; granting it to a third account is rejected. Section 7 says that is
-- a constraint the system enforces rather than a convention it assumes, so the
-- cap lives here rather than only in a service.
--
-- The role carries Whole Church scope on people.manage_lifecycle,
-- people.manage_pastoral_assignment and audit.view, which is why a third holder
-- matters: it is the widest authority in the church.
--
-- This enforces the count. Which two Persons hold it is checked in the `auth`
-- domain layer, because the database has no durable representation of who
-- Bishop Oriel and Pastora Geraldine are.
CREATE FUNCTION assert_two_senior_pastors_at_most() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_active integer;
BEGIN
  SELECT count(*) INTO v_active
    FROM account_roles
   WHERE role = 'SENIOR_PASTOR'
     AND revoked_at IS NULL;

  IF v_active > 2 THEN
    RAISE EXCEPTION
      'SENIOR_PASTOR is held by exactly the two Persons named in SKILL.md section 4 (% active rows)',
      v_active
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER account_roles_two_senior_pastors_at_most
  AFTER INSERT OR UPDATE ON account_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_two_senior_pastors_at_most();

-- ---------------------------------------------------------------------------
-- capability_grants (SKILL.md section 7, How grants are held)
--
-- Deliberately exempt from the one-open-row rule that governs every other
-- effective-dated table: an account may hold the same capability at more than one
-- scope, and the widest applicable grant governs.
-- ---------------------------------------------------------------------------

CREATE TABLE capability_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  capability capability NOT NULL,
  scope_type scope_type NOT NULL,
  scope_network network,
  read_only boolean NOT NULL DEFAULT true,
  -- Required. A grant is authority somebody decided to hand out, and section 7
  -- gives the reason no nullability marker. An unexplained grant leaves the next
  -- administrator with nothing to weigh when deciding whether it still applies.
  reason text NOT NULL,
  -- Required. Unlike a role, an explicit grant is always issued by an Admin;
  -- there is no bootstrap case.
  granted_by uuid NOT NULL REFERENCES accounts (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT capability_grants_period_ordered
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT capability_grants_reason_not_blank CHECK (btrim(reason) <> ''),
  -- scope_network is required where scope_type is NETWORK, and meaningless
  -- otherwise.
  CONSTRAINT capability_grants_network_scope_named
    CHECK (
      (scope_type = 'NETWORK' AND scope_network IS NOT NULL)
      OR (scope_type <> 'NETWORK' AND scope_network IS NULL)
    ),
  -- read_only is valid only on a read capability. A write capability granted
  -- read_only would be a row that grants nothing, with nothing to explain why its
  -- holder is being denied, so it is rejected at creation rather than stored.
  CONSTRAINT capability_grants_read_only_is_a_read
    CHECK (
      read_only = false
      OR capability IN (
        'people.view_subtree',
        'dcc.view_subtree',
        'cell.view_subtree',
        'reports.view_subtree',
        'audit.view'
      )
    )
);

CREATE INDEX capability_grants_active_by_account
  ON capability_grants (account_id, capability)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- refresh_tokens (SKILL.md section 6, Session and token storage)
-- ---------------------------------------------------------------------------

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  -- The token itself is never stored.
  token_hash text NOT NULL UNIQUE,
  device_label text,
  -- Rotation chain: the row this token replaced. A replayed token is a reuse
  -- signal, and the chain is what makes the whole chain revocable in response
  -- (section 6).
  replaced_by_id uuid REFERENCES refresh_tokens (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT refresh_tokens_period_ordered CHECK (expires_at > issued_at)
);

CREATE INDEX refresh_tokens_active_by_account
  ON refresh_tokens (account_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- account_tokens (SKILL.md section 6, Password reset security)
-- ---------------------------------------------------------------------------

CREATE TABLE account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  purpose account_token_purpose NOT NULL,
  -- The token itself is never stored.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_tokens_period_ordered CHECK (expires_at > created_at)
);

-- Issuing a new token of a purpose invalidates any outstanding one of the same
-- purpose for that account, so at most one is ever outstanding.
CREATE UNIQUE INDEX account_tokens_one_outstanding
  ON account_tokens (account_id, purpose)
  WHERE used_at IS NULL;

-- migrate:down:refuse-if-populated persons pastoral_assignments network_assignments person_lifecycle accounts

-- This down drops the tables it created, so it is safe only while they are
-- empty. The directive above is not a comment: the runner refuses to apply this
-- section if any table named there holds a row, and says so rather than
-- executing. CLAUDE.md is unambiguous that history in these tables is never
-- dropped, and an operator reaching for `migrate:down` on a populated database
-- is reaching for the wrong tool.

DROP TABLE IF EXISTS account_tokens;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS capability_grants;
DROP TABLE IF EXISTS account_roles;

DROP TRIGGER IF EXISTS account_roles_two_senior_pastors_at_most ON account_roles;
DROP FUNCTION IF EXISTS assert_two_senior_pastors_at_most();

DROP TRIGGER IF EXISTS network_assignments_keep_edges_same_network ON network_assignments;
DROP TRIGGER IF EXISTS pastoral_assignments_same_network ON pastoral_assignments;
DROP FUNCTION IF EXISTS assert_network_change_keeps_edges();
DROP FUNCTION IF EXISTS assert_assignment_same_network();
DROP FUNCTION IF EXISTS network_as_of(uuid, timestamptz);

DROP TABLE IF EXISTS pastoral_assignments;
DROP TABLE IF EXISTS network_assignments;
DROP TABLE IF EXISTS person_lifecycle;
DROP TABLE IF EXISTS accounts;

DROP TRIGGER IF EXISTS persons_member_id_immutable ON persons;
DROP FUNCTION IF EXISTS persons_member_id_is_immutable();
DROP TABLE IF EXISTS persons;
DROP SEQUENCE IF EXISTS member_id_seq;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS scope_type;
DROP TYPE IF EXISTS capability;
DROP TYPE IF EXISTS account_token_purpose;
DROP TYPE IF EXISTS account_role;
DROP TYPE IF EXISTS account_status;
DROP TYPE IF EXISTS archive_reason;
DROP TYPE IF EXISTS lifecycle_state;
DROP TYPE IF EXISTS network;
DROP TYPE IF EXISTS civil_status;
DROP TYPE IF EXISTS sex;
