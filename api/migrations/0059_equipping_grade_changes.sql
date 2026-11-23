-- migrate:up

-- ---------------------------------------------------------------------------
-- A lesson of a posted class changed by the Admin, with a reason, and the grade worked out again
-- (SKILL.md section 29, decisions 0501, 0508 and 0513).
--
-- Additive: one new table and one view, both owned by `equipping`, and three triggers. No row is
-- rewritten, no effective date is set, and nothing is deleted. **The posted grade is never
-- rewritten** (principle 12): a change is a row of its own, keeping the lesson and the grade it
-- changed from and to, and the grade a person holds is the posted one or the latest change of it,
-- which `equipping_current_grades` reads.
--
-- **A posted class's register is final in the database too, for the students it graded**: a mark
-- or make-up of a posted class's lesson under a graded enrollment is written, or closed, only in a
-- transaction that records a change of that grade. Before this migration only the application
-- refused it.
-- ---------------------------------------------------------------------------

CREATE TABLE equipping_grade_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The order the changes of one grade were made in, the latest one being the grade now.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  final_grade_id uuid NOT NULL REFERENCES equipping_final_grades (id),
  lesson smallint NOT NULL CONSTRAINT equipping_grade_changes_lesson
    CHECK (lesson BETWEEN 1 AND 9 AND lesson <> 5),
  -- The lesson as the register read it, and as it now reads.
  sign_before text NOT NULL CONSTRAINT equipping_grade_changes_sign_before
    CHECK (sign_before IN ('CAME', 'ABSENT', 'MADE_UP', 'BEFORE_JOINING')),
  made_up_on_before date,
  sign_after text NOT NULL CONSTRAINT equipping_grade_changes_sign_after
    CHECK (sign_after IN ('CAME', 'ABSENT', 'MADE_UP')),
  made_up_on_after date,
  why text NOT NULL CONSTRAINT equipping_grade_changes_why
    CHECK (why IN ('MADE_UP_AFTER_POSTING', 'RECORDED_WRONGLY')),
  details text NOT NULL CONSTRAINT equipping_grade_changes_details
    CHECK (btrim(details) <> '' AND char_length(details) <= 500),
  grade_before text NOT NULL CONSTRAINT equipping_grade_changes_grade_before
    CHECK (grade_before IN ('PASSED', 'NOT_PASSED', 'NOT_YET')),
  reason_before text NOT NULL,
  grade_after text NOT NULL CONSTRAINT equipping_grade_changes_grade_after
    CHECK (grade_after IN ('PASSED', 'NOT_PASSED', 'NOT_YET')),
  reason_after text NOT NULL CONSTRAINT equipping_grade_changes_reason_after
    CHECK (btrim(reason_after) <> '' AND char_length(reason_after) <= 500),
  lessons_kept_after smallint NOT NULL CONSTRAINT equipping_grade_changes_kept
    CHECK (lessons_kept_after BETWEEN 0 AND 9),
  lessons_made_up_after smallint NOT NULL CONSTRAINT equipping_grade_changes_made_up
    CHECK (lessons_made_up_after BETWEEN 0 AND 9),
  joins_at_lesson_6_after boolean NOT NULL,
  changed_by uuid NOT NULL REFERENCES accounts (id),
  changer_person_id uuid REFERENCES persons (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- A make-up carries its date, and nothing else does.
  CONSTRAINT equipping_grade_changes_made_up_dated CHECK (
    (made_up_on_before IS NOT NULL) = (sign_before = 'MADE_UP')
    AND (made_up_on_after IS NOT NULL) = (sign_after = 'MADE_UP')
  ),
  -- Something changes: the mark, or a make-up's date.
  CONSTRAINT equipping_grade_changes_changes CHECK (
    sign_before <> sign_after OR made_up_on_before IS DISTINCT FROM made_up_on_after
  ),
  -- A lesson held before the student joined is made up, never ticked or marked absent.
  CONSTRAINT equipping_grade_changes_before_joining CHECK (
    sign_before <> 'BEFORE_JOINING' OR sign_after = 'MADE_UP'
  ),
  -- A student posted *Not yet* stays *Not yet*, and nobody else becomes it (decision 0513).
  CONSTRAINT equipping_grade_changes_not_yet_kept CHECK (
    (grade_before = 'NOT_YET') = (grade_after = 'NOT_YET')
  ),
  CONSTRAINT equipping_grade_changes_joins_not_passed CHECK (
    NOT joins_at_lesson_6_after OR grade_after = 'NOT_PASSED'
  )
);

CREATE INDEX equipping_grade_changes_by_grade ON equipping_grade_changes (final_grade_id, seq);

-- **The grade each student holds now**: the posted one, or its latest change.
CREATE VIEW equipping_current_grades AS
SELECT g.id AS final_grade_id,
       g.posting_id,
       g.enrollment_id,
       COALESCE(c.grade_after, g.grade) AS grade,
       COALESCE(c.reason_after, g.reason) AS reason,
       COALESCE(c.lessons_kept_after, g.lessons_kept) AS lessons_kept,
       COALESCE(c.lessons_made_up_after, g.lessons_made_up) AS lessons_made_up,
       COALESCE(c.joins_at_lesson_6_after, g.joins_at_lesson_6) AS joins_at_lesson_6,
       g.passed_later_at,
       c.changed_at,
       (SELECT count(*) FROM equipping_grade_changes n WHERE n.final_grade_id = g.id)::integer AS changes
  FROM equipping_final_grades g
  LEFT JOIN LATERAL (
    SELECT x.* FROM equipping_grade_changes x
     WHERE x.final_grade_id = g.id
     ORDER BY x.seq DESC
     LIMIT 1
  ) c ON true;

-- A change starts from the grade as it stands, is never made to a *Not yet* that has since passed,
-- and does not take *Joins a later class at Lesson 6* from a student who has joined one. It is
-- kept as written: never updated, never deleted.
CREATE FUNCTION assert_grade_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  now_grade equipping_current_grades%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A change of a posted grade is kept as written (SKILL.md section 29).'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO now_grade FROM equipping_current_grades WHERE final_grade_id = NEW.final_grade_id;
  IF NEW.grade_before <> now_grade.grade OR NEW.reason_before <> now_grade.reason THEN
    RAISE EXCEPTION 'a change of a grade starts from the grade as it stands (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_grade_change_from_current';
  END IF;
  IF now_grade.passed_later_at IS NOT NULL THEN
    RAISE EXCEPTION 'a student who passed at a later Encounter keeps the grade they passed on (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_grade_change_passed_later';
  END IF;
  IF now_grade.joins_at_lesson_6 AND NOT NEW.joins_at_lesson_6_after AND EXISTS (
       SELECT 1 FROM equipping_enrollments carrier
        WHERE carrier.carried_from_enrollment_id = now_grade.enrollment_id) THEN
    RAISE EXCEPTION 'a student who has joined a later class at Lesson 6 keeps the grade that let them (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_grade_change_carried';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_grade_changes_kept
  BEFORE INSERT OR UPDATE OR DELETE ON equipping_grade_changes
  FOR EACH ROW EXECUTE FUNCTION assert_grade_change();

-- **A posted class's register changes only with a grade change** (decision 0513): a mark or a
-- make-up of a posted class's lesson for a student that posting graded, written or closed, needs
-- a change of that student's grade recorded in the same transaction, which `now()` makes the same
-- instant. A student who moved out before the posting has no grade there, and a make-up of a
-- lesson they missed in it is still recorded from the class they are in (decision 0512). A
-- make-up under a graded student's earlier enrollment, in another class, is refused by the
-- application alone.
CREATE FUNCTION assert_posted_register_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM equipping_lessons l
         JOIN equipping_class_postings p ON p.class_id = l.class_id
         JOIN equipping_final_grades g ON g.posting_id = p.id AND g.enrollment_id = NEW.enrollment_id
        WHERE l.id = NEW.lesson_id)
     AND NOT EXISTS (
       SELECT 1
         FROM equipping_grade_changes c
         JOIN equipping_final_grades g ON g.id = c.final_grade_id
         JOIN equipping_enrollments graded ON graded.id = g.enrollment_id
         JOIN equipping_enrollments own ON own.id = NEW.enrollment_id
        WHERE c.changed_at = now()
          AND graded.registration_id = own.registration_id) THEN
    RAISE EXCEPTION 'a posted class''s register changes only with a change of the grade, by the Admin (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_posted_register_kept';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_posted_kept
  BEFORE INSERT OR UPDATE ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_posted_register_kept();

CREATE TRIGGER equipping_make_ups_posted_kept
  BEFORE INSERT OR UPDATE ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION assert_posted_register_kept();

-- Joining at Lesson 6 reads the grade as it stands now, a change included (decision 0513).
CREATE OR REPLACE FUNCTION assert_enrollment_carry() RETURNS trigger
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
         JOIN equipping_current_grades g ON g.enrollment_id = src.id
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

-- migrate:down
-- migrate:down:refuse-if-populated equipping_grade_changes

-- Refused once a change is recorded: dropping it would put every changed grade back to the one
-- posted, a mark the change wrote still standing beside it.

CREATE OR REPLACE FUNCTION assert_enrollment_carry() RETURNS trigger
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

DROP TRIGGER equipping_make_ups_posted_kept ON equipping_make_ups;
DROP TRIGGER equipping_marks_posted_kept ON equipping_marks;
DROP FUNCTION assert_posted_register_kept();
DROP TRIGGER equipping_grade_changes_kept ON equipping_grade_changes;
DROP FUNCTION assert_grade_change();
DROP VIEW equipping_current_grades;
DROP TABLE equipping_grade_changes;
