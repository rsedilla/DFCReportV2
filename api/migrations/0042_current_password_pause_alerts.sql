-- migrate:up

-- ---------------------------------------------------------------------------
-- A pause started on My Account has its own alert (SKILL.md section 6, decision 0448)
--
-- Wrong current passwords on My Account now count in the sign-in pause for the
-- account's address. A pause started there means somebody holding a signed-in session
-- is guessing, which is worse news than strangers guessing at sign-in, so the Admin is
-- emailed about it once a day for one account counted apart from the other two kinds,
-- as decision 0441 did for the second step. The twenty a day in all stay shared.
--
-- Only the kinds the constraint admits change. No row is rewritten.
-- ---------------------------------------------------------------------------

ALTER TABLE sign_in_pause_alerts DROP CONSTRAINT sign_in_pause_alerts_kind;
ALTER TABLE sign_in_pause_alerts
  ADD CONSTRAINT sign_in_pause_alerts_kind
  CHECK (kind IN ('PASSWORD', 'SECOND_STEP', 'CURRENT_PASSWORD'));

-- migrate:down

-- The rows of the new kind go with it. They are not history: each counts an email sent
-- today against the daily caps and is removed by the code path itself after two days.
-- The pause each one reports stays in the audit log.
DELETE FROM sign_in_pause_alerts WHERE kind = 'CURRENT_PASSWORD';
ALTER TABLE sign_in_pause_alerts DROP CONSTRAINT sign_in_pause_alerts_kind;
ALTER TABLE sign_in_pause_alerts
  ADD CONSTRAINT sign_in_pause_alerts_kind CHECK (kind IN ('PASSWORD', 'SECOND_STEP'));
