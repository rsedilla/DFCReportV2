-- The idempotency claim lease (SKILL.md section 22, Idempotency).
--
-- Additive: one nullable-with-default column and one index. Nothing is dropped
-- and no existing row loses anything (CLAUDE.md, Definition of Done -> Migration
-- policy).
--
-- Why it exists. `expires_at` is the retention of the *response* -- section 22's
-- "at least 24 hours" -- and it was doing a second job it is the wrong length
-- for: bounding how long a claim may sit unfinished. A request whose process died
-- left its row IN_FLIGHT for the whole 24 hours, and every retry was answered
-- REQUEST_IN_FLIGHT, which section 22 defines as "retry after a short delay". A
-- day is not a short delay, and the caller never learned the outcome.
--
-- The two are separate durations because they answer separate questions, so they
-- are separate columns. `claimed_at` bounds the claim; `expires_at` keeps the
-- answer.

-- migrate:up

ALTER TABLE idempotency_keys
  ADD COLUMN claimed_at timestamptz NOT NULL DEFAULT now();

-- Reclaiming scans by state and age.
CREATE INDEX idempotency_keys_stale_claims
  ON idempotency_keys (claimed_at)
  WHERE state = 'IN_FLIGHT';

-- migrate:down

DROP INDEX IF EXISTS idempotency_keys_stale_claims;

ALTER TABLE idempotency_keys
  DROP COLUMN IF EXISTS claimed_at;
