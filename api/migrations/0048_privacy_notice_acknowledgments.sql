-- migrate:up

-- ---------------------------------------------------------------------------
-- An account holder ticks that they have read the Privacy Notice (SKILL.md
-- sections 6 and 24, decision 0496)
--
-- One row per account and notice, the notice named by its "Last updated" date.
-- It is the church's evidence that the holder read the notice, so a row is never
-- changed and never removed: a later notice is a later row, and the earlier one
-- stays. Refused by a trigger, as `audit_log` is (migration 0002), with no remedy
-- to offer because there is nothing to correct.
--
-- Additive: a new table, and nothing existing is read or rewritten. An account
-- with no row is asked at its next open, which is what every account is today.
-- ---------------------------------------------------------------------------

CREATE TABLE privacy_notice_acknowledgments (
  account_id uuid NOT NULL REFERENCES accounts (id),
  notice_version text NOT NULL
    CONSTRAINT privacy_notice_version_is_a_date
    CHECK (notice_version ~ '^\d{4}-\d{2}-\d{2}$'),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, notice_version)
);

CREATE FUNCTION refuse_change_to_privacy_notice_acknowledgment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'privacy_notice_acknowledgments is append-only: a tick is never changed or removed (SKILL.md section 24)'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER privacy_notice_acknowledgments_append_only
  BEFORE UPDATE OR DELETE ON privacy_notice_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION refuse_change_to_privacy_notice_acknowledgment();

-- migrate:down
-- migrate:down:refuse-if-populated privacy_notice_acknowledgments

-- Refused once anybody has ticked: the rows are the evidence (decision 0496), and the
-- runner checks the table is empty before this section runs. On a database where nobody
-- has, it removes the table cleanly.

DROP TRIGGER privacy_notice_acknowledgments_append_only ON privacy_notice_acknowledgments;
DROP FUNCTION refuse_change_to_privacy_notice_acknowledgment();
DROP TABLE privacy_notice_acknowledgments;
