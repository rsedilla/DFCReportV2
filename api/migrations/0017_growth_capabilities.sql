-- migrate:up

-- ---------------------------------------------------------------------------
-- The nine Conquest, SUYNL and Training capabilities (SKILL.md sections 7, 27
-- and 28; rulings of 2026-09-16, decisions 0249 and 0250)
--
-- **Alone in this migration, and that is required rather than tidy.** PostgreSQL
-- refuses to use a value added to an enum inside the transaction that added it,
-- and `0018_growth.sql`'s widened `capability_grants_read_only_is_a_read` names
-- three of them. The runner gives each migration its own transaction, so the
-- split is what makes the constraint writable at all.
--
-- `IF NOT EXISTS` so that reverting 0018 and re-applying it works: an enum value
-- cannot be removed, and rebuilding the type would rewrite `capability_grants`,
-- which the migration policy refuses on a table holding history.
-- ---------------------------------------------------------------------------

ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.confirm_on_behalf';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.confirm_on_behalf';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.confirm_on_behalf';

-- migrate:down

-- Nothing. PostgreSQL cannot remove an enum value, and the alternative —
-- rebuilding the type — would rewrite `capability_grants`, which the migration
-- policy refuses on a table holding history. A value nothing grants is inert,
-- and `0018` restores the constraint that decides which of them may be granted
-- `read_only`.
