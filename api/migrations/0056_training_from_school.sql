-- migrate:up

-- ---------------------------------------------------------------------------
-- Training's graduations from the school (SKILL.md sections 28 and 29, decisions 0501 and
-- 0509).
--
-- A posted Passed files Life Class's graduation and the Encounter attended files the
-- Encounter's, each marked as the school's; only the Admin ticks either for somebody who
-- finished before the school. A student posted *Not yet* who later attends an Encounter
-- passes then, which their posted grade records. Additive: one column on `training_graduations`
-- with a default, so every row already there reads as before the school, and two nullable
-- columns on `equipping_final_grades`. No effective date is set or moved.
-- ---------------------------------------------------------------------------

ALTER TABLE training_graduations
  ADD COLUMN from_school boolean NOT NULL DEFAULT false,
  -- The school confirms as no leader (decision 0509): its row names nobody as confirming.
  ADD CONSTRAINT training_graduations_school_confirms_nobody CHECK (
    NOT from_school OR confirmed_by IS NULL
  );

-- Whether a graduation is the school's is fixed when it is filed: a tick never becomes the
-- school's, nor the school's a tick, which would let the Training tab change it.
CREATE FUNCTION refuse_from_school_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.from_school IS DISTINCT FROM OLD.from_school THEN
    RAISE EXCEPTION 'Whether a graduation came from the school is kept as filed (decision 0509).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_graduations_from_school_kept BEFORE UPDATE OF from_school
  ON training_graduations FOR EACH ROW EXECUTE FUNCTION refuse_from_school_change();

ALTER TABLE equipping_final_grades
  ADD COLUMN passed_later_at timestamptz,
  ADD COLUMN passed_later_by uuid REFERENCES accounts (id),
  ADD CONSTRAINT equipping_final_grades_passed_later CHECK (
    (passed_later_at IS NULL) = (passed_later_by IS NULL)
    AND (passed_later_at IS NULL OR grade = 'NOT_YET')
  );

-- A posted grade keeps what it says, with one exception: a *Not yet* records, once, that the
-- student passed after a later Encounter (decision 0509).
CREATE FUNCTION assert_final_grade_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A class''s check, posting and grades are kept as written (SKILL.md section 29).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.passed_later_at IS NULL AND NEW.passed_later_at IS NOT NULL
     AND to_jsonb(NEW) - 'passed_later_at' - 'passed_later_by'
       = to_jsonb(OLD) - 'passed_later_at' - 'passed_later_by' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A class''s check, posting and grades are kept as written (SKILL.md section 29).'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER equipping_final_grades_kept ON equipping_final_grades;
CREATE TRIGGER equipping_final_grades_kept BEFORE UPDATE OR DELETE ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION assert_final_grade_kept();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_final_grades

DROP TRIGGER equipping_final_grades_kept ON equipping_final_grades;
CREATE TRIGGER equipping_final_grades_kept BEFORE UPDATE OR DELETE ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_grade_rewrite();
DROP FUNCTION assert_final_grade_kept();
ALTER TABLE equipping_final_grades
  DROP CONSTRAINT equipping_final_grades_passed_later,
  DROP COLUMN passed_later_by,
  DROP COLUMN passed_later_at;
-- Refused while a graduation is the school's: dropping the column would make it read as a
-- leader's tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM training_graduations WHERE from_school) THEN
    RAISE EXCEPTION 'graduations from the school exist; this migration is not reversed';
  END IF;
END;
$$;
DROP TRIGGER training_graduations_from_school_kept ON training_graduations;
DROP FUNCTION refuse_from_school_change();
ALTER TABLE training_graduations
  DROP CONSTRAINT training_graduations_school_confirms_nobody,
  DROP COLUMN from_school;
