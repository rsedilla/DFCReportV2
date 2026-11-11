-- migrate:up

-- ---------------------------------------------------------------------------
-- The Network Admin role (SKILL.md section 7, decision 0469).
--
-- One value added here and used by the next migration: PostgreSQL refuses to use
-- a value added to an enum inside the transaction that added it, and the runner
-- gives each migration its own transaction.
--
-- `IF NOT EXISTS` so that reverting this migration and re-applying it works.
-- ---------------------------------------------------------------------------

ALTER TYPE account_role ADD VALUE IF NOT EXISTS 'NETWORK_ADMIN';

-- migrate:down

-- Nothing. PostgreSQL cannot remove an enum value, and rebuilding the type would
-- rewrite `account_roles`, which the migration policy refuses on a table holding
-- history. A value nothing holds is inert.
