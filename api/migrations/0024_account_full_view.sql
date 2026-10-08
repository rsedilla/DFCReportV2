-- migrate:up

-- ---------------------------------------------------------------------------
-- Full view on an account (SKILL.md section 7, decision 0323)
--
-- An administrator ticks it on a Leader account; without it the account holds no
-- `reports.view_subtree` and no Training or Conquest capability, and sees the recording
-- screens (section 19). It means nothing on an account that also holds `SENIOR_PASTOR`
-- or `ADMIN`.
--
-- Additive: one column with a default, so every existing account starts without it,
-- as a new one does. No effective date is set, so this is not backdating (section 5).
--
-- The launch set (decision 0323, point 6) is ticked by hand by an administrator, so each
-- tick is logged under their name; this migration ticks nobody.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN full_view boolean NOT NULL DEFAULT false;

-- migrate:down

-- Removes the column and with it every tick. Their audit entries stay: the audit log is
-- append-only (section 21), and they remain true of what happened.
ALTER TABLE accounts DROP COLUMN full_view;
