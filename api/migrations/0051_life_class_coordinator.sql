-- migrate:up

-- ---------------------------------------------------------------------------
-- The Life Class Coordinator (SKILL.md sections 7 and 29, decision 0501).
--
-- An administrator ticks *Life Class Coordinator* on a Leader account, as Approves Cells
-- and Moves people are ticked; with it the account holds `equipping.coordinate` and opens
-- the Life Class classes and names their Teachers. Offered only with Full view (owner,
-- 2026-11-20), as those two are. SOL 1 to 3 gain a tick of their own when the school runs
-- them.
--
-- Additive: an enum value nothing holds, a column with a default, so every existing
-- account starts without it, and a NOT NULL relaxed. The value is not used in this
-- migration, so adding it here is allowed inside its transaction. No effective date is set,
-- so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

ALTER TYPE capability ADD VALUE IF NOT EXISTS 'equipping.coordinate';

ALTER TABLE accounts ADD COLUMN coordinates_life_class boolean NOT NULL DEFAULT false;

-- Every existing row is false, so nothing breaks it.
ALTER TABLE accounts
  ADD CONSTRAINT accounts_coordinates_life_class_needs_full_view
  CHECK (NOT coordinates_life_class OR full_view);

-- A class may be opened before its Teacher is named, and its row reads *Not named yet*
-- (decision 0501, the Coordinator's Classes). Relaxing a NOT NULL refuses nothing existing.
ALTER TABLE equipping_classes ALTER COLUMN teacher_person_id DROP NOT NULL;

-- migrate:down

-- Refused while a class has no Teacher, which is the safe direction: a down that would
-- invent a Teacher is not written.
ALTER TABLE equipping_classes ALTER COLUMN teacher_person_id SET NOT NULL;

ALTER TABLE accounts DROP CONSTRAINT accounts_coordinates_life_class_needs_full_view;

ALTER TABLE accounts DROP COLUMN coordinates_life_class;

-- The enum value stays: PostgreSQL cannot remove one, and a value nothing holds is inert.
