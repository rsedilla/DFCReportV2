-- Stage 2: the three tables the first write endpoint needs.
--
-- Tables created:
--   audit_log                          section 21
--   idempotency_keys                   section 22, Idempotency
--   settings                           section 7, `settings.manage`
--
-- None of these waits for the stage that makes heavy use of it. Section 5
-- requires every reassignment to be audit logged and section 22 requires an
-- Idempotency-Key on every state-changing request "from the first write
-- endpoint, not added later" -- and pastoral reassignment is that endpoint.
--
-- `settings` is here for a different reason. Section 2 holds the initial-encoding
-- phase flag under `settings.manage`, and Stage 2 ends by importing the
-- leadership tree inside that phase. A relaxation attached to a phase with no
-- defined end is a permanent relaxation, so the control that ends it is built in
-- the same stage that opens it (CLAUDE.md, ruling of 2026-08-20).

-- migrate:up

-- ---------------------------------------------------------------------------
-- audit_log (SKILL.md section 21)
--
-- Append-only: "Nothing updates or deletes a row, and it is never a source for
-- as-of state". Both halves of that are enforced below, because the second is
-- what makes the first cheap -- a table nothing reads for as-of state has no
-- reason ever to be corrected in place, so refusing UPDATE costs nothing and
-- removes the only way an audit trail is quietly edited.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null only for a system action, mirroring account_roles.granted_by
  -- (section 7). Every other entry has an actor.
  actor_id uuid REFERENCES accounts (id),
  -- Deliberately not an enum, and this is the one closed-enumeration decision in
  -- the schema that goes the other way. Section 7 says its capability list is a
  -- closed enumeration and that adding one is an amendment; section 21 opens its
  -- list with "Audit important actions, including", which is not a closure and
  -- must not be turned into one by a migration. The check holds the shape of an
  -- identifier so a typo fails, not its membership in a set the specification
  -- declines to close.
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  -- Groups the per-record entries of one bulk import. Section 2 requires an
  -- import to write an entry per record rather than one for the batch, because a
  -- single entry for thousands of Persons records no target and no before-and-
  -- after values; this is what still makes the batch retrievable as a batch.
  batch_id uuid,
  -- The database's clock, deliberately, and the only timestamp in this schema
  -- that is. Section 6 requires `issued_at` to be stamped by the API because it
  -- is compared against another API-stamped value; nothing compares this against
  -- one. Writing it with `now()` inside the transaction that records the fact
  -- also gives every entry of one operation an identical timestamp, which is
  -- what makes a batch legible.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_shape CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  CONSTRAINT audit_log_target_type_not_blank CHECK (btrim(target_type) <> ''),
  CONSTRAINT audit_log_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);

-- Section 7: an audit entry resolves scope through its target, so reading one
-- leader's history is a lookup by target rather than a scan.
CREATE INDEX audit_log_by_target
  ON audit_log (target_type, target_id, occurred_at DESC);

CREATE INDEX audit_log_by_actor
  ON audit_log (actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX audit_log_by_batch
  ON audit_log (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX audit_log_recent
  ON audit_log (occurred_at DESC);

CREATE FUNCTION refuse_change_to_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: an entry is never updated or deleted (SKILL.md section 21)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Separate from refuse_delete_of_history(): that one carries a message about
-- closing a row and opening a new one, which is the remedy for an effective-dated
-- table and is not the remedy here. There is no remedy here -- a wrong audit
-- entry is corrected by a later entry, never by editing the first.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION refuse_change_to_audit_log();

-- ---------------------------------------------------------------------------
-- idempotency_keys (SKILL.md section 22, Idempotency)
--
-- Not effective-dated and not history, so section 5's no-deletion rule does not
-- reach it. Section 22 requires the key to be kept "for at least 24 hours",
-- which says in terms that it may be dropped after.
-- ---------------------------------------------------------------------------

CREATE TYPE idempotency_state AS ENUM ('IN_FLIGHT', 'COMPLETED');

CREATE TABLE idempotency_keys (
  -- The client-generated UUID (section 23: stable UUIDs, generatable by the
  -- client, so a record drafted offline keeps its identity when it syncs).
  key uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts (id),
  -- A hash of method, path and body. Section 22 branches on it: the same key
  -- with a different body is IDEMPOTENCY_KEY_REUSED, permanently.
  request_fingerprint text NOT NULL,
  state idempotency_state NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- The key is scoped to the account, not global. Section 22 lists account_id as
  -- a column and does not say which of the two identifies a row, and a global key
  -- would let one account claim another's: a client that reused a key it had
  -- observed would either receive a stored response belonging to somebody else or
  -- deny that person their own retry, and would learn the key exists either way.
  -- Two clients independently generating one UUID is not the case worth designing
  -- for; one client deliberately reusing another's is.
  PRIMARY KEY (account_id, key),
  CONSTRAINT idempotency_keys_period_ordered CHECK (expires_at > created_at),
  CONSTRAINT idempotency_keys_fingerprint_not_blank
    CHECK (btrim(request_fingerprint) <> ''),
  -- A completed key carries the response it produced; an in-flight one carries
  -- nothing yet. Section 22 marks both columns "nullable until completed", so the
  -- pairing is the rule rather than the nullability.
  CONSTRAINT idempotency_keys_response_matches_state
    CHECK (
      (state = 'COMPLETED' AND response_status IS NOT NULL)
      OR (state = 'IN_FLIGHT' AND response_status IS NULL AND response_body IS NULL)
    )
);

-- Retention sweeps by expiry.
CREATE INDEX idempotency_keys_expiry ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- settings (SKILL.md section 7, `settings.manage`)
--
-- Admin-only, Whole Church, and every change audit logged with its previous and
-- new values. There is no history table: section 7 gives the shape one row per
-- key with `updated_by` and `updated_at`, and the history of the value lives in
-- audit_log, which is what the before-and-after requirement is for.
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  -- "The key set is fixed by this specification, not open" (section 7). Held as a
  -- check rather than an enum so that the two names read in place; adding one is
  -- an amendment to section 7, exactly as adding a capability is.
  key text PRIMARY KEY,
  -- jsonb so a count is a number and a flag is a boolean, without a parsing
  -- convention that each reader has to reimplement.
  value jsonb NOT NULL,
  -- Null only for the system action that seeds the defaults below, mirroring
  -- account_roles.granted_by (section 7). Every change made through
  -- `settings.manage` has an Admin behind it.
  updated_by uuid REFERENCES accounts (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_key_is_known
    CHECK (key IN ('cell_attention_months', 'initial_encoding_open'))
);

-- Refusing DELETE here is an inference, and is marked as one so a reviewer can
-- strike it. Section 7 does not state it. What section 7 does state is that every
-- change is audit logged with its previous and new values, and a delete has no
-- new value to log: it returns a church-wide control to whatever default the
-- application happens to carry, chosen by nobody, with the attention list
-- silently re-populating for every leader or the encoding phase silently
-- reopening. A setting is changed by writing a value, never by removing the row.
--
-- Its own function rather than refuse_delete_of_history(), whose message tells
-- the caller to close the row and open a new one. That is the remedy for an
-- effective-dated table and is the wrong instruction here: `settings` holds one
-- row per key and is corrected by writing a value to it.
CREATE FUNCTION refuse_delete_of_setting() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'settings rows are never deleted: change the value instead (SKILL.md section 7)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER settings_no_delete
  BEFORE DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_setting();

-- Seeded with the defaults the specification names, by a system action. The
-- application therefore never invents a default, which is what would otherwise
-- put the value in two places and let them disagree.
--
--   cell_attention_months  three months (section 15), one church-wide value and
--                          never per leader
--   initial_encoding_open  the phase is open (section 2). It is closed once, by a
--                          deliberate audited Admin action, and the direct-create
--                          path for Cells is gone from that point.
INSERT INTO settings (key, value, updated_by) VALUES
  ('cell_attention_months', '3'::jsonb, NULL),
  ('initial_encoding_open', 'true'::jsonb, NULL);

-- migrate:down:refuse-if-populated audit_log

-- This down drops what it created. `audit_log` is named above because section 21
-- makes it append-only, and an audit trail dropped by a migration is an audit
-- trail nobody can produce.
--
-- `settings` is deliberately not named, and the reason is that the guard counts
-- rows and this migration seeds two of them. Naming it would refuse every down
-- from the moment the up finished, including the round trip CI runs on an empty
-- database -- a guard that always fires teaches an operator to reach for
-- `--force`, which is worse than no guard.
--
-- What protects a real decision is `audit_log` being named. Section 7 requires
-- every settings change to be audit logged with its previous and new values, so
-- a database where somebody has changed a setting is a database with an audit
-- entry, and the guard above already refuses. The seeded defaults are the only
-- state that can exist without one, and they are this file's own output.
--
-- `idempotency_keys` is deliberately not named either. It holds no history and no
-- decision -- section 22 keeps a key for 24 hours and permits dropping it after --
-- so refusing a down over a row that expires by itself tomorrow would make the
-- guard mean less everywhere it is used.

DROP TRIGGER IF EXISTS settings_no_delete ON settings;
DROP TABLE IF EXISTS settings;
DROP FUNCTION IF EXISTS refuse_delete_of_setting();

DROP TABLE IF EXISTS idempotency_keys;
DROP TYPE IF EXISTS idempotency_state;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
DROP TABLE IF EXISTS audit_log;
DROP FUNCTION IF EXISTS refuse_change_to_audit_log();
