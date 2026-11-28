-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 3 joins the school in one step (SKILL.md sections 7 and 29, decisions 0501 and 0517): its
-- Coordinator, its classes and its registrations, and a SOL 3 lesson ticking the memory verse and
-- devotional as SOL 1's and SOL 2's do.
--
-- Additive: a column with a default, so every existing account starts without the new tick, CHECK
-- constraints replaced by wider ones or added, and a trigger function replaced by one admitting a
-- level it refused. Every existing row is a Life Class, SOL 1 or SOL 2 row, which each new
-- constraint admits exactly as the one it replaces did, and the function runs only at insert. No
-- row is rewritten and no effective date is set, so this is not backdating (section 5).
--
-- SOL 3's requirements (decision 0501, point 18): SOL 2 passed, the leadership of an `ACTIVE`
-- Cell now and twelve direct disciples now, read from the records, and the SOL 3 book, which the
-- Registrar ticks and is the book the student reads to pass (decision 0517, point 2), riding on
-- `manual_confirmed` as SOL 1's manual and SOL 2's book do.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN coordinates_sol_3 boolean NOT NULL DEFAULT false;

-- Offered only with Full view, as the other ticks are (decision 0501, point 1).
ALTER TABLE accounts
  ADD CONSTRAINT accounts_coordinates_sol_3_needs_full_view
  CHECK (NOT coordinates_sol_3 OR full_view);

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level
  CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2', 'SOL_3'));

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level
  CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2', 'SOL_3'));

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
    OR (level = 'SOL_3'
      AND unmet <@ ARRAY['SOL_2_PASSED', 'LEADS_A_CELL', 'TWELVE_DISCIPLES', 'SOL_3_BOOK']::text[])
  );

-- A SOL 3 book not ticked is named in `unmet`, and one ticked is not.
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_sol_3_book_unmet CHECK (
    level <> 'SOL_3' OR (manual_confirmed = NOT ('SOL_3_BOOK' = ANY (unmet)))
  );

-- Which rows carry the two ticks follows the class's level: every SOL level's, and Life Class's
-- never (migrations 0061 and 0065).
CREATE OR REPLACE FUNCTION assert_items_fit_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
  ticked boolean;
BEGIN
  SELECT c.level INTO class_level
    FROM equipping_lessons l JOIN equipping_classes c ON c.id = l.class_id
   WHERE l.id = NEW.lesson_id;
  ticked := NEW.verse IS NOT NULL;
  IF TG_TABLE_NAME = 'equipping_marks' THEN
    IF ticked <> (class_level IN ('SOL_1', 'SOL_2', 'SOL_3') AND NEW.came) THEN
      RAISE EXCEPTION 'a SOL lesson ticks the memory verse and devotional of whoever came, and Life Class ticks neither (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF ticked <> (class_level IN ('SOL_1', 'SOL_2', 'SOL_3')) THEN
    RAISE EXCEPTION 'a SOL make-up ticks the memory verse and devotional, and a Life Class make-up ticks neither (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- migrate:down

-- Refused while any SOL 3 class or registration exists, by the narrower constraints below, which
-- is the safe direction: a down that would delete or relabel them is not written (principle 12).
-- Refused too while any account is ticked SOL 3 Coordinator, so dropping the column loses no
-- current tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE coordinates_sol_3) THEN
    RAISE EXCEPTION 'an account is ticked SOL 3 Coordinator; clear it before reverting 0066';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION assert_items_fit_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
  ticked boolean;
BEGIN
  SELECT c.level INTO class_level
    FROM equipping_lessons l JOIN equipping_classes c ON c.id = l.class_id
   WHERE l.id = NEW.lesson_id;
  ticked := NEW.verse IS NOT NULL;
  IF TG_TABLE_NAME = 'equipping_marks' THEN
    IF ticked <> (class_level IN ('SOL_1', 'SOL_2') AND NEW.came) THEN
      RAISE EXCEPTION 'a SOL lesson ticks the memory verse and devotional of whoever came, and Life Class ticks neither (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF ticked <> (class_level IN ('SOL_1', 'SOL_2')) THEN
    RAISE EXCEPTION 'a SOL make-up ticks the memory verse and devotional, and a Life Class make-up ticks neither (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_sol_3_book_unmet;

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

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2'));

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2'));

ALTER TABLE accounts DROP CONSTRAINT accounts_coordinates_sol_3_needs_full_view;

ALTER TABLE accounts DROP COLUMN coordinates_sol_3;
