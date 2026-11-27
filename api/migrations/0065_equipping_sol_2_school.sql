-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 2's school, its second step (SKILL.md section 29, decision 0516): a class may now be of
-- SOL 2, which migration 0064 withheld until SOL 2's register and final grades existed (point 4),
-- and a SOL 2 lesson ticks the memory verse and devotional as a SOL 1 lesson does.
--
-- Additive: a CHECK widened and a trigger function replaced by one admitting a level it refused.
-- Every existing class is Life Class or SOL 1, and every existing mark and make-up was written
-- under the function being replaced, whose answer for those two levels is unchanged; the function
-- runs only at insert, so no row is read again. No row is rewritten and no effective date is set.
-- ---------------------------------------------------------------------------

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS', 'SOL_1', 'SOL_2'));

-- Which rows carry the two ticks follows the class's level: every SOL level's, and Life Class's
-- never (migration 0061, which named SOL 1 alone).
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

-- migrate:down

-- Refused while any SOL 2 class exists, by the narrower constraint below, which is the safe
-- direction: a down that would delete or relabel one is not written (principle 12).
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
    IF ticked <> (class_level = 'SOL_1' AND NEW.came) THEN
      RAISE EXCEPTION 'a SOL lesson ticks the memory verse and devotional of whoever came, and Life Class ticks neither (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF ticked <> (class_level = 'SOL_1') THEN
    RAISE EXCEPTION 'a SOL make-up ticks the memory verse and devotional, and a Life Class make-up ticks neither (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS', 'SOL_1'));
