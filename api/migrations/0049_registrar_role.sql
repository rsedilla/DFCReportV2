-- migrate:up

-- ---------------------------------------------------------------------------
-- The Registrar role and its capability (SKILL.md sections 7 and 29, decision 0499).
--
-- Alone in this migration because PostgreSQL refuses to use a value added to an
-- enum inside the transaction that added it, and the next migration names both:
-- `0050_equipping.sql` pairs the role in its held-alone indexes. The runner gives
-- each migration its own transaction, so the split is what makes them writable.
--
-- `IF NOT EXISTS` so that reverting the next migration and re-applying it works.
-- ---------------------------------------------------------------------------

ALTER TYPE account_role ADD VALUE IF NOT EXISTS 'REGISTRAR';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'equipping.manage';

-- migrate:down

-- Nothing. PostgreSQL cannot remove an enum value, and rebuilding either type would
-- rewrite `account_roles` or `capability_grants`, which the migration policy refuses
-- on a table holding history. A value nothing holds is inert.
