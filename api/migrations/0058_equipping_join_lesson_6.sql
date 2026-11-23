-- migrate:up

-- ---------------------------------------------------------------------------
-- A student who kept lessons 1 to 4 and the Encounter joins a later class at Lesson 6
-- (SKILL.md section 29, decisions 0508 and 0512).
--
-- Additive: one column with a default on `equipping_final_grades`, and one nullable column on
-- `equipping_enrollments`. No effective date is set. One thing is written to rows already there:
-- a grade posted before this migration whose reason already says *Joins a later class at lesson
-- 6.*, and whose lessons 1 to 4 were all attended or made up, is given the flag (owner,
-- 2026-11-23, decision 0512, points 1 and 9), the grade itself unchanged.
-- ---------------------------------------------------------------------------

-- Posted with the grade (point 1): *Not passed* for more than three absences, at most two of
-- lessons 1 to 4 missed and the Encounter attended. Written once, with the grade, which the
-- existing trigger keeps as written.
ALTER TABLE equipping_final_grades
  ADD COLUMN joins_at_lesson_6 boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT equipping_final_grades_joins_not_passed CHECK (
    NOT joins_at_lesson_6 OR grade = 'NOT_PASSED'
  );

-- The grades already posted that say so in words, and whose lessons 1 to 4 were each attended or
-- made up in a class of that registration (a move in the term included). The trigger keeping a
-- posted grade as written is set aside for this one statement and restored, the grade, reason
-- and lessons untouched.
ALTER TABLE equipping_final_grades DISABLE TRIGGER equipping_final_grades_kept;
UPDATE equipping_final_grades g
   SET joins_at_lesson_6 = true
 WHERE g.grade = 'NOT_PASSED'
   AND g.reason LIKE '%Joins a later class at lesson 6.%'
   AND (SELECT count(DISTINCT l.lesson)
          FROM equipping_enrollments graded
          JOIN equipping_enrollments n ON n.registration_id = graded.registration_id
          JOIN equipping_lessons l ON l.class_id = n.class_id AND l.lesson <= 4
         WHERE graded.id = g.enrollment_id
           AND (EXISTS (SELECT 1 FROM equipping_marks m
                         WHERE m.lesson_id = l.id AND m.enrollment_id = n.id
                           AND m.superseded_at IS NULL AND m.came)
                OR EXISTS (SELECT 1 FROM equipping_make_ups u
                            WHERE u.lesson_id = l.id AND u.enrollment_id = n.id
                              AND u.superseded_at IS NULL))) = 4;
ALTER TABLE equipping_final_grades ENABLE TRIGGER equipping_final_grades_kept;

-- The enrollment whose lessons 1 to 4 an enrollment keeps (point 5): set when it joins at
-- Lesson 6, never otherwise. Always the enrollment where they were kept, never one that kept them
-- itself, so a register reads them one step away.
ALTER TABLE equipping_enrollments
  ADD COLUMN carried_from_enrollment_id uuid REFERENCES equipping_enrollments (id),
  ADD CONSTRAINT equipping_enrollments_carried_not_self CHECK (carried_from_enrollment_id <> id);

-- Point 2's saved-lesson half, and what the kept enrollment must be: the same person's (a record
-- merged into theirs counting, decision 0408, which reads `persons.merged_into_id`), at the same
-- level, in an earlier term, posted as joining at Lesson 6, and kept where the lessons were kept.
-- It never changes once written.
CREATE FUNCTION assert_enrollment_carry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.carried_from_enrollment_id IS DISTINCT FROM OLD.carried_from_enrollment_id THEN
      RAISE EXCEPTION 'an enrollment keeps the lessons it carried from (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.carried_from_enrollment_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM equipping_enrollments src
         JOIN equipping_registrations rs ON rs.id = src.registration_id
         JOIN equipping_registrations rn ON rn.id = NEW.registration_id
         JOIN equipping_final_grades g ON g.enrollment_id = src.id
        WHERE src.id = NEW.carried_from_enrollment_id
          AND src.carried_from_enrollment_id IS NULL
          AND rs.level = rn.level
          AND (rs.term_year, rs.term_number) < (rn.term_year, rn.term_number)
          AND g.joins_at_lesson_6
          AND (rs.person_id = rn.person_id
               OR EXISTS (SELECT 1 FROM persons p
                           WHERE p.id = rs.person_id AND p.merged_into_id = rn.person_id))) THEN
    RAISE EXCEPTION 'a student joins at Lesson 6 only from their own class posted as joining there (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_enrollment_carry';
  END IF;
  IF EXISTS (SELECT 1 FROM equipping_lessons l WHERE l.class_id = NEW.class_id AND l.lesson >= 6) THEN
    RAISE EXCEPTION 'a student joins at Lesson 6 only a class that has not reached it (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_enrollment_lesson_6_reached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_enrollments_carry
  BEFORE INSERT OR UPDATE ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION assert_enrollment_carry();

-- Point 5: one joined at Lesson 6 keeps lessons 1 to 4, so their class records no mark or make-up
-- of those lessons for them; and nothing new is written into a posted class's register, the
-- earlier class they were kept in included ("nothing posted is rewritten", decision 0508).
CREATE FUNCTION assert_no_mark_on_kept_lessons() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NULL AND EXISTS (
       SELECT 1
         FROM equipping_lessons l
         JOIN equipping_class_postings p ON p.class_id = l.class_id
        WHERE l.id = NEW.lesson_id) THEN
    RAISE EXCEPTION 'a posted class''s register is final (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.superseded_at IS NULL AND EXISTS (
       SELECT 1
         FROM equipping_enrollments e
         JOIN equipping_lessons l ON l.id = NEW.lesson_id
        WHERE e.id = NEW.enrollment_id
          AND e.carried_from_enrollment_id IS NOT NULL
          AND l.lesson <= 4) THEN
    RAISE EXCEPTION 'one joined at Lesson 6 keeps lessons 1 to 4, which their class does not record (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_not_on_kept_lessons
  BEFORE INSERT ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_no_mark_on_kept_lessons();

CREATE TRIGGER equipping_make_ups_not_on_kept_lessons
  BEFORE INSERT ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION assert_no_mark_on_kept_lessons();

-- migrate:down

-- Refused while an enrollment carries: dropping it would turn a student joined at Lesson 6 into
-- one missing lessons 1 to 4. A grade's flag alone is not refused: its reason still says it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_enrollments WHERE carried_from_enrollment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'students joined at Lesson 6 exist; this migration is not reversed';
  END IF;
END;
$$;

DROP TRIGGER equipping_make_ups_not_on_kept_lessons ON equipping_make_ups;
DROP TRIGGER equipping_marks_not_on_kept_lessons ON equipping_marks;
DROP FUNCTION assert_no_mark_on_kept_lessons();
DROP TRIGGER equipping_enrollments_carry ON equipping_enrollments;
DROP FUNCTION assert_enrollment_carry();
ALTER TABLE equipping_enrollments
  DROP CONSTRAINT equipping_enrollments_carried_not_self,
  DROP COLUMN carried_from_enrollment_id;
ALTER TABLE equipping_final_grades
  DROP CONSTRAINT equipping_final_grades_joins_not_passed,
  DROP COLUMN joins_at_lesson_6;
