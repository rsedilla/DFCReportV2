-- migrate:up

-- ---------------------------------------------------------------------------
-- Moves people on an account (SKILL.md sections 5 and 7, decision 0356)
--
-- An administrator ticks it on a Leader account, as Full view and Approves Cells are
-- ticked; with it the account holds `people.manage_pastoral_assignment` over its own
-- subtree and moves people to another pastoral leader there. Without it a Leader moves
-- nobody. It means nothing on an account that does not hold `LEADER`.
--
-- Additive: one column with a default, so every existing account starts without it, as a
-- new one does, and until the administrator ticks the Primaries only the Admin and the
-- Senior Pastors move people. No effective date is set, so this is not backdating
-- (section 5).
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN moves_people boolean NOT NULL DEFAULT false;

-- Offered only with Full view (owner, 2026-10-16, decision 0356), as Approves Cells is.
-- Every existing row is false, so nothing breaks it.
ALTER TABLE accounts
  ADD CONSTRAINT accounts_moves_people_needs_full_view CHECK (NOT moves_people OR full_view);

-- migrate:down

ALTER TABLE accounts DROP CONSTRAINT accounts_moves_people_needs_full_view;

ALTER TABLE accounts DROP COLUMN moves_people;
