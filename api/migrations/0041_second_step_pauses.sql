-- migrate:up

-- ---------------------------------------------------------------------------
-- A pause after ten wrong second-step codes (SKILL.md section 6, decision 0441)
--
-- Five wrong codes end one sign-in, but a new sign-in could be started at once, so
-- somebody holding an `ADMIN` or `SENIOR_PASTOR` password could go on guessing codes.
-- Ten wrong codes or recovery codes for one account within fifteen minutes, whatever
-- sign-in they were typed in, now pause its second step for fifteen minutes.
--
-- `second_step_pauses` holds one row for an account with wrong codes in the window.
-- `failed_at` holds the window's wrong codes; a right code removes the row, and so does
-- a reset of the step. Like `sign_in_pauses`, this is transient security state rather
-- than history: nothing reports on it, and rows untouched for a day are removed by the
-- code path itself. Each pause is in the audit log, which stays.
--
-- `sign_in_pause_alerts.kind` lets the Admin be told about a code pause on a day the
-- same account's password pause was already emailed: a code pause means the password
-- was right, which is the worse news. Existing rows are password pauses, which is what
-- the default says; nothing is backdated.
-- ---------------------------------------------------------------------------

CREATE TABLE second_step_pauses (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id),
  failed_at    timestamptz[] NOT NULL DEFAULT '{}',
  paused_until timestamptz NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX second_step_pauses_updated_at ON second_step_pauses (updated_at);

ALTER TABLE sign_in_pause_alerts
  ADD COLUMN kind text NOT NULL DEFAULT 'PASSWORD'
  CONSTRAINT sign_in_pause_alerts_kind CHECK (kind IN ('PASSWORD', 'SECOND_STEP'));

-- migrate:down

-- Neither holds history (above): dropping them ends any code pause in force and loses
-- nothing a report reads.
ALTER TABLE sign_in_pause_alerts DROP COLUMN kind;
DROP TABLE second_step_pauses;
