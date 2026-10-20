-- migrate:up

-- ---------------------------------------------------------------------------
-- `people.set_title` (SKILL.md sections 3 and 7, decision 0374)
--
-- Setting, changing or clearing a person's title is its own capability, held by the
-- Admin at Whole Church and by no other role; `people.edit_basic` keeps a person's
-- other descriptive fields. A title already recorded stays and is still shown.
--
-- A write capability, so `capability_grants_read_only_is_a_read` is not changed, and
-- nothing in this migration uses the value, which PostgreSQL refuses inside the
-- transaction that added it. Additive: no row is written and nothing grants it.
-- ---------------------------------------------------------------------------

ALTER TYPE capability ADD VALUE IF NOT EXISTS 'people.set_title' AFTER 'people.correct_sex';

-- migrate:down

-- Nothing. PostgreSQL cannot remove an enum value, and rebuilding the type would rewrite
-- `capability_grants`, which the migration policy refuses on a table holding history. A
-- value nothing grants is inert, as 0017 and 0030 record.