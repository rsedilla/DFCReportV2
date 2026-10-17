-- migrate:up

-- ---------------------------------------------------------------------------
-- `cell.move_members` (SKILL.md sections 7 and 10, decision 0357)
--
-- Moving a member out of a Cell, to another Cell or to none, is now its own capability:
-- a Leader holds it over its own subtree only with Moves people and Full view (the tick
-- decision 0356 added), the Admin at Whole Church, a Senior Pastor not at all.
-- `cell.manage_membership` keeps adding somebody who is in no Cell.
--
-- A write capability, so `capability_grants_read_only_is_a_read` is not changed, and
-- nothing in this migration uses the value, which PostgreSQL refuses inside the
-- transaction that added it. Additive: no row is written and nothing grants it.
-- ---------------------------------------------------------------------------

ALTER TYPE capability ADD VALUE IF NOT EXISTS 'cell.move_members' AFTER 'cell.manage_membership';

-- migrate:down

-- Nothing. PostgreSQL cannot remove an enum value, and rebuilding the type would rewrite
-- `capability_grants`, which the migration policy refuses on a table holding history. A
-- value nothing grants is inert, as 0017 records for the nine Growth capabilities.
