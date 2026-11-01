-- migrate:up

-- ---------------------------------------------------------------------------
-- Changing the email of an account in use (SKILL.md section 6, decision 0415)
--
-- A holder who asks to change their address is sent a link at the new one, and the
-- address changes only when it is confirmed. The link is an `account_tokens` row of a
-- new purpose, `EMAIL_CHANGE`, which carries the address it would set; no other purpose
-- carries one. The address is not secret, so it is stored as typed and normalized, as
-- `accounts.email` is.
--
-- The check compares `purpose::text` rather than the enum value, because PostgreSQL
-- refuses a new enum value inside the transaction that added it. Additive: two nullable
-- columns, and no existing row carries the new purpose.
-- ---------------------------------------------------------------------------

ALTER TYPE account_token_purpose ADD VALUE IF NOT EXISTS 'EMAIL_CHANGE';

ALTER TABLE account_tokens
  ADD COLUMN new_email text NULL,
  ADD COLUMN new_email_normalized text NULL,
  ADD CONSTRAINT account_tokens_new_email_only_for_email_change CHECK (
    (purpose::text = 'EMAIL_CHANGE') = (new_email IS NOT NULL AND new_email_normalized IS NOT NULL)
  );

-- migrate:down

ALTER TABLE account_tokens
  DROP CONSTRAINT account_tokens_new_email_only_for_email_change,
  DROP COLUMN new_email_normalized,
  DROP COLUMN new_email;

-- The enum value stays: PostgreSQL cannot remove one, as 0030 records. A value no row
-- carries is inert.
