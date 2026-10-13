-- migrate:up

-- ---------------------------------------------------------------------------
-- A username on an account (SKILL.md section 6, decision 0337)
--
-- Sign-in takes it or the email address. Optional, so every existing account starts
-- without one and nothing is backfilled: the holder sets it, on activation or on their
-- Account page.
--
-- Additive: one nullable column. The shape check and the unique index are what make
-- "no two accounts share one" and "lowercase letters and numbers, 3 to 30, starting with
-- a letter" true of the data rather than of the application alone. Both hold of every
-- existing row, since every existing row is null.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN username text;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_username_shape
  CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9]{2,29}$');

CREATE UNIQUE INDEX accounts_username_key ON accounts (username) WHERE username IS NOT NULL;

-- migrate:down

-- Removes every username. Their audit entries stay: the audit log is append-only
-- (section 21), and they remain true of what happened.
DROP INDEX accounts_username_key;
ALTER TABLE accounts DROP CONSTRAINT accounts_username_shape;
ALTER TABLE accounts DROP COLUMN username;
