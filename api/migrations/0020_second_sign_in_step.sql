-- migrate:up

-- ---------------------------------------------------------------------------
-- The second sign-in step (SKILL.md section 6; ruling of 2026-09-28, decision 0302)
--
-- An account holding ADMIN or SENIOR_PASTOR signs in with a password and then a
-- six-digit authenticator-app code (TOTP, RFC 6238).
--
-- **The secret is stored encrypted, never hashed.** The server has to read it back
-- to check a code, so a hash cannot work. It is AES-256-GCM under a key held in the
-- environment (SECOND_STEP_KEY), never in the database or the repository, so a copy
-- of this table or a backup yields no usable secret (section 24).
--
-- **A reset revokes, it does not delete.** `revoked_at` ends the step and the next
-- sign-in sets up a new one; at most one step per account is live.
-- ---------------------------------------------------------------------------

CREATE TABLE second_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  secret_ciphertext text NOT NULL,
  -- The 30-second time step of the last code accepted. A code is accepted once, so
  -- a later code must name a later step.
  last_used_step    bigint,
  -- Stamped by the API, like every instant compared against a token (section 6): a
  -- session issued before it predates the step and is refused.
  set_up_at         timestamptz NOT NULL,
  revoked_at        timestamptz,

  CONSTRAINT second_steps_revoked_after_set_up CHECK (
    revoked_at IS NULL OR revoked_at >= set_up_at
  )
);

CREATE UNIQUE INDEX second_steps_one_live_per_account
  ON second_steps (account_id) WHERE revoked_at IS NULL;

CREATE TRIGGER second_steps_no_delete
  BEFORE DELETE ON second_steps
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- Ten single-use codes issued at setup, stored only as a hash (section 6).
CREATE TABLE second_step_recovery_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  second_step_id uuid NOT NULL REFERENCES second_steps(id),
  code_hash      text NOT NULL,
  used_at        timestamptz,

  CONSTRAINT second_step_recovery_codes_unique UNIQUE (second_step_id, code_hash)
);

CREATE TRIGGER second_step_recovery_codes_no_delete
  BEFORE DELETE ON second_step_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- A sign-in that has passed the password and not yet the code. The ticket is the
-- credential for the second step, so only its hash is stored, as for every token.
-- Five wrong codes void it (section 6), and it lives five minutes.
--
-- Operational state rather than history, like refresh and account tokens, so a
-- row may be pruned once it has expired.
CREATE TABLE second_step_challenges (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                uuid NOT NULL REFERENCES accounts(id),
  token_hash                text NOT NULL UNIQUE,
  -- The secret being set up, until a code proves the app holds it.
  pending_secret_ciphertext text,
  failed_attempts           integer NOT NULL DEFAULT 0,
  expires_at                timestamptz NOT NULL,
  used_at                   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT second_step_challenges_attempts_bounded CHECK (
    failed_attempts BETWEEN 0 AND 5
  )
);

CREATE INDEX second_step_challenges_account ON second_step_challenges (account_id);

-- migrate:down:refuse-if-populated second_steps

-- A live step is what lets an administrator or Senior Pastor sign in; reverting
-- is refused once one exists, and they would otherwise sign in with a password
-- alone again.

DROP TABLE second_step_challenges;
DROP TABLE second_step_recovery_codes;
DROP TABLE second_steps;
