-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 1's final grades (SKILL.md section 29, decision 0514, points 11 to 13).
--
-- A SOL class has ten lessons where Life Class has nine (its four, the Encounter as the fifth,
-- then four more), so a posted grade's lessons kept and made up may now reach 10. Each level is
-- held to its own shape by a trigger, on insert and on any update of those columns, since the
-- level is on the class and no CHECK can read it:
-- Life Class stays at most 9, and a SOL grade is never *Not yet* (SOL has no Encounter) and
-- never joins a later class at Lesson 6 (decision 0514).
--
-- Additive: two CHECK constraints replaced by wider ones, and a trigger. Every row
-- that exists is a Life Class grade within 9, so each holds for it. No row is rewritten and no
-- effective date is set, so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

ALTER TABLE equipping_final_grades DROP CONSTRAINT equipping_final_grades_kept;
ALTER TABLE equipping_final_grades
  ADD CONSTRAINT equipping_final_grades_kept CHECK (lessons_kept BETWEEN 0 AND 10);
ALTER TABLE equipping_final_grades DROP CONSTRAINT equipping_final_grades_made_up;
ALTER TABLE equipping_final_grades
  ADD CONSTRAINT equipping_final_grades_made_up CHECK (lessons_made_up BETWEEN 0 AND 10);

CREATE FUNCTION assert_final_grade_fits_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
BEGIN
  SELECT c.level INTO class_level
    FROM equipping_enrollments e JOIN equipping_classes c ON c.id = e.class_id
   WHERE e.id = NEW.enrollment_id;
  IF class_level = 'LIFE_CLASS' AND (NEW.lessons_kept > 9 OR NEW.lessons_made_up > 9) THEN
    RAISE EXCEPTION 'a Life Class grade counts at most nine lessons (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF class_level <> 'LIFE_CLASS' AND (NEW.grade = 'NOT_YET' OR NEW.joins_at_lesson_6) THEN
    RAISE EXCEPTION 'a SOL grade is never Not yet and joins nobody at Lesson 6 (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_final_grades_fit_level
  BEFORE INSERT OR UPDATE OF grade, joins_at_lesson_6, lessons_kept, lessons_made_up
  ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION assert_final_grade_fits_level();

-- migrate:down

-- Refused while a grade counts ten lessons, which the narrower constraints would refuse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_final_grades WHERE lessons_kept > 9 OR lessons_made_up > 9) THEN
    RAISE EXCEPTION 'SOL final grades counting ten lessons exist; reverting 0062 would refuse them';
  END IF;
END;
$$;

DROP TRIGGER equipping_final_grades_fit_level ON equipping_final_grades;
DROP FUNCTION assert_final_grade_fits_level();
ALTER TABLE equipping_final_grades DROP CONSTRAINT equipping_final_grades_made_up;
ALTER TABLE equipping_final_grades
  ADD CONSTRAINT equipping_final_grades_made_up CHECK (lessons_made_up BETWEEN 0 AND 9);
ALTER TABLE equipping_final_grades DROP CONSTRAINT equipping_final_grades_kept;
ALTER TABLE equipping_final_grades
  ADD CONSTRAINT equipping_final_grades_kept CHECK (lessons_kept BETWEEN 0 AND 9);
