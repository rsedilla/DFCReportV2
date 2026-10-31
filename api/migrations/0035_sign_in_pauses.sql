-- migrate:up

-- ---------------------------------------------------------------------------
-- Sign-in pauses (SKILL.md sections 6 and 24, decision 0413)
--
-- Ten wrong passwords for one email address or username, as typed, within fifteen minutes
-- pause sign-in for it for fifteen minutes, from every device and address. A row is kept
-- for what was typed, whether or not an account holds it, so a pause says nothing about
-- whether one does.
--
-- `identifier` is `email:<the address, normalized>` or `username:<the name, lowercase>`.
-- `failed_at` holds the attempts of the current window, each written before its password
-- is checked, so that attempts arriving together cannot all pass the count. A correct
-- password empties the count. A completed password reset empties it too and sets
-- `exempt_until` and `exempt_proof_hash`: for fifteen minutes the browser that completed the
-- reset, presenting the proof the reset answered with, signs in with the right password even
-- if the name is paused again (owner, 2026-11-01). While the name is paused, that browser's
-- attempts are not counted and nobody else's is admitted, so the allowance opens no window for
-- guessing; its signing in leaves the pause in place for everybody else.
--
-- `sign_in_pause_alerts` keeps when the Admin was emailed about a pause, so that the email
-- goes at most once a day for an account and twenty times a day in all (owner, 2026-11-01):
-- a flood of alerts would spend the mail provider's daily allowance that reset emails need.
--
-- This is transient security state rather than history: nothing reports on it, and rows
-- not touched for a day are removed by the sign-in path itself.
-- ---------------------------------------------------------------------------

CREATE TABLE sign_in_pauses (
  identifier   text PRIMARY KEY CHECK (identifier ~ '^(email|username):.+$'),
  failed_at    timestamptz[] NOT NULL DEFAULT '{}',
  paused_until timestamptz NULL,
  exempt_until timestamptz NULL,
  exempt_proof_hash text NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sign_in_pauses_updated_at ON sign_in_pauses (updated_at);

CREATE TABLE sign_in_pause_alerts (
  account_id uuid NOT NULL REFERENCES accounts (id),
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sign_in_pause_alerts_sent_at ON sign_in_pause_alerts (sent_at);

-- migrate:down

-- Neither table holds history (above): dropping them ends any pause in force and loses
-- nothing a report reads. Each pause of a held name is in the audit log, which stays.
DROP TABLE sign_in_pause_alerts;
DROP TABLE sign_in_pauses;
