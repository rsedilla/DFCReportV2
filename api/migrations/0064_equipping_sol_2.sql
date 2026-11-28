-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 2 joins the school, its first step: its Coordinator and its registrations (SKILL.md
-- sections 7 and 29, decisions 0501 and 0516), as migration 0060 did for SOL 1.
--
-- **No SOL 2 class yet** (decision 0516, point 4): `equipping_classes_level` is left at Life Class
-- and SOL 1, so the database refuses a SOL 2 class as the application does, until the second step
-- brings SOL 2's register and final grades and widens it.
--
-- Additive: a column with a default, so every existing account starts without the new tick, and
-- CHECK constraints replaced by wider ones or added. Every row that exists is a Life Class or a
-- SOL 1 row, which each new constraint admits exactly as the one it replaces did, and the
-- migration refuses on its own if one does not. No row is rewritten and no effective date is
-- set, so this is not backdating (section 5).
--
-- SOL 2's requirements (decision 0501, point 18): SOL 1 passed and the leadership of an `ACTIVE`
-- Cell now, both read from the records, and the SOL 2 book, which the Registrar ticks and is the
-- book the student reads to pass (decision 0516, point 2). The book rides on `manual_confirmed`,
-- as SOL 1's manual does: one column for the one thing each level asks the Registrar to tick.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN coordinates_sol_2 boolean NOT NULL DEFAULT false;

-- Offered only with Full view, as the other two ticks are (decision 0501, point 1).
ALTER TABLE accounts
  ADD CONSTRAINT accounts_coordinates_sol_2_needs_full_view
  CHECK (NOT coordinates_sol_2 OR full_view);

-- A registration may now be of SOL 2; a class may not yet.
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2'));

-- Each level's own codes, and no other level's.
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_unmet_known;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_unmet_known CHECK (
    (level = 'LIFE_CLASS'
      AND unmet <@ ARRAY['HAS_LEADER', 'CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4']::text[])
    OR (level = 'SOL_1'
      AND unmet <@ ARRAY['LIFE_CLASS_PASSED', 'WIN_3', 'SOL_1_MANUAL']::text[])
    OR (level = 'SOL_2'
      AND unmet <@ ARRAY['SOL_1_PASSED', 'LEADS_A_CELL', 'SOL_2_BOOK']::text[])
  );

-- A SOL 2 book not ticked is named in `unmet`, and one ticked is not.
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_sol_2_book_unmet CHECK (
    level <> 'SOL_2' OR (manual_confirmed = NOT ('SOL_2_BOOK' = ANY (unmet)))
  );

-- migrate:down

-- Refused while any SOL 2 registration exists, by the constraints below (the narrower
-- `equipping_registrations_unmet_known` refusing first), which is the safe direction: a down
-- that would delete or relabel them is not written (principle 12). Refused too while any account
-- is ticked SOL 2 Coordinator, so dropping the column loses no current tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE coordinates_sol_2) THEN
    RAISE EXCEPTION 'an account is ticked SOL 2 Coordinator; clear it before reverting 0064';
  END IF;
END
$$;
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_sol_2_book_unmet;

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_unmet_known;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_unmet_known CHECK (
    (level = 'LIFE_CLASS'
      AND unmet <@ ARRAY['HAS_LEADER', 'CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4']::text[])
    OR (level = 'SOL_1'
      AND unmet <@ ARRAY['LIFE_CLASS_PASSED', 'WIN_3', 'SOL_1_MANUAL']::text[])
  );

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS', 'SOL_1'));

ALTER TABLE accounts DROP CONSTRAINT accounts_coordinates_sol_2_needs_full_view;

ALTER TABLE accounts DROP COLUMN coordinates_sol_2;
