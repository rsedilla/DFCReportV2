-- migrate:up

-- ---------------------------------------------------------------------------
-- A lesson of a posted class changed by the Admin, with a reason, and the grade worked out again
-- (SKILL.md section 29, decisions 0501, 0508 and 0513).
--
-- Additive: one new table and one view, both owned by `equipping`, four triggers, and three
-- functions widened. No effective date is set and nothing is deleted. **One row is rewritten, by
-- owner ruling** (decision 0513, point 10): an enrollment a change makes *Not yet* again is
-- reopened, its end cleared. The end it had is posting's own, recoverable from
-- `equipping_class_postings` (`posted_at`, `posted_by`), and the change row records the reopening
-- (`enrollment_effect`). **The posted grade is never
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
  -- The Encounter the grade before was worked out against, and the one this change works from
  -- (decision 0513, point 14). The grade reads the Encounter as attended or not, so the first is
  -- that alone; the second says what it reads now.
  encounter_before text NOT NULL CONSTRAINT equipping_grade_changes_encounter_before
    CHECK (encounter_before IN ('CAME', 'NOT_CAME')),
  encounter_after text NOT NULL CONSTRAINT equipping_grade_changes_encounter_after
    CHECK (encounter_after IN ('CAME', 'MISSED', 'ENROLLED', 'NONE')),
  -- What it did to the graded enrollment (point 10): ended it, a *Not yet* made something else,
  -- or reopened it, a finished student made *Not yet*.
  enrollment_effect text CONSTRAINT equipping_grade_changes_enrollment_effect
    CHECK (enrollment_effect IN ('ENDS', 'REOPENS')),
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
  -- An enrollment is reopened only for a grade made *Not yet*, and ended only for one made
  -- something else (decision 0513, point 10).
  CONSTRAINT equipping_grade_changes_effect_follows CHECK (
    enrollment_effect IS NULL
    OR (enrollment_effect = 'REOPENS' AND grade_after = 'NOT_YET')
    OR (enrollment_effect = 'ENDS' AND grade_after <> 'NOT_YET')
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

-- A change starts from the grade as it stands, and does not take *Joins a later class at Lesson 6* from a student who has joined one. It is
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
-- lesson they missed in it is still recorded from the class they are in (decision 0512). The
-- change may be of the grade this register's registration was graded for, or of a later term's
-- grade carrying lessons 1 to 4 from it (decision 0513, point 12).
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
          AND (graded.registration_id = own.registration_id
               OR EXISTS (SELECT 1 FROM equipping_enrollments src
                           WHERE src.id = graded.carried_from_enrollment_id
                             AND src.registration_id = own.registration_id))) THEN
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

-- **A kept lesson is changed only by a change of the grade that keeps it** (decision 0513, point
-- 12): lessons 1 to 4 kept for a later class stay as recorded, save beside a change of that later
-- grade recorded in the same transaction. The rest of 0058's rule stands.
CREATE OR REPLACE FUNCTION assert_no_mark_on_kept_lessons() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NULL AND EXISTS (
       SELECT 1
         FROM equipping_enrollments own
         JOIN equipping_lessons l ON l.id = NEW.lesson_id
         JOIN equipping_enrollments kept ON kept.registration_id = own.registration_id
         JOIN equipping_enrollments carrier ON carrier.carried_from_enrollment_id = kept.id
        WHERE own.id = NEW.enrollment_id
          AND l.lesson <= 4
          AND NOT EXISTS (
            SELECT 1 FROM equipping_grade_changes c
              JOIN equipping_final_grades g ON g.id = c.final_grade_id
             WHERE c.changed_at = now() AND g.enrollment_id = carrier.id)) THEN
    RAISE EXCEPTION 'lessons 1 to 4 kept for a later class are kept as recorded (SKILL.md section 29)'
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

-- **An ended enrollment stays ended, save one a change makes *Not yet* again** (decision 0513,
-- point 10): reopened whole, beside a change recorded in the same transaction saying so.
CREATE OR REPLACE FUNCTION assert_enrollment_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.registration_id <> OLD.registration_id OR NEW.class_id <> OLD.class_id
       OR NEW.started_at <> OLD.started_at OR NEW.started_by <> OLD.started_by THEN
      RAISE EXCEPTION 'an enrollment keeps its registration and class (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL AND NEW.ended_by IS NULL
       AND NEW.end_reason IS NULL AND NEW.withdraw_note IS NULL AND EXISTS (
         SELECT 1 FROM equipping_grade_changes c
           JOIN equipping_final_grades g ON g.id = c.final_grade_id
          WHERE c.changed_at = now() AND c.enrollment_effect = 'REOPENS'
            AND g.enrollment_id = NEW.id) THEN
      RETURN NEW;
    END IF;
    IF OLD.ended_at IS NOT NULL AND (
         NEW.ended_at IS DISTINCT FROM OLD.ended_at
         OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
         OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
         OR NEW.withdraw_note IS DISTINCT FROM OLD.withdraw_note) THEN
      RAISE EXCEPTION 'an ended enrollment stays ended (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.ended_at IS NULL AND EXISTS (
       SELECT 1 FROM equipping_registrations r
        WHERE r.id = NEW.registration_id AND r.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nobody is placed in a class on a cancelled registration (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- **A registration graded Passed or Not passed is not enrolled again** (decision 0513, point 16):
-- it is finished with its grade; a person trying again registers again.
CREATE FUNCTION assert_registration_not_graded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM equipping_enrollments e
         JOIN equipping_current_grades g ON g.enrollment_id = e.id
        WHERE e.registration_id = NEW.registration_id
          AND g.grade IN ('PASSED', 'NOT_PASSED')) THEN
    RAISE EXCEPTION 'a registration graded Passed or Not passed is not enrolled again (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_enrollment_graded_registration';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_enrollments_not_graded
  BEFORE INSERT ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION assert_registration_not_graded();

-- **Only a grade standing Not yet passes later** (decision 0509), read as it stands now
-- (decision 0513, point 10): a posted *Not passed* made *Not yet* passes at a later Encounter as
-- any *Not yet* does, and a posted *Not yet* made something else does not. The check 0056 wrote on
-- the posted grade alone keeps its pairing half.
ALTER TABLE equipping_final_grades
  DROP CONSTRAINT equipping_final_grades_passed_later,
  ADD CONSTRAINT equipping_final_grades_passed_later CHECK (
    (passed_later_at IS NULL) = (passed_later_by IS NULL)
  );

CREATE FUNCTION assert_passes_later_from_not_yet() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.passed_later_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.passed_later_at IS NULL)
     AND (CASE WHEN TG_OP = 'INSERT' THEN NEW.grade
               ELSE (SELECT g.grade FROM equipping_current_grades g WHERE g.final_grade_id = NEW.id)
          END) <> 'NOT_YET' THEN
    RAISE EXCEPTION 'equipping_final_grades_passed_later: only a grade standing Not yet passes later (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_final_grades_passed_later';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_final_grades_passes_later
  BEFORE INSERT OR UPDATE OF passed_later_at ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION assert_passes_later_from_not_yet();

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

DROP TRIGGER equipping_final_grades_passes_later ON equipping_final_grades;
DROP FUNCTION assert_passes_later_from_not_yet();
ALTER TABLE equipping_final_grades
  DROP CONSTRAINT equipping_final_grades_passed_later,
  ADD CONSTRAINT equipping_final_grades_passed_later CHECK (
    (passed_later_at IS NULL) = (passed_later_by IS NULL)
    AND (passed_later_at IS NULL OR grade = 'NOT_YET')
  );

DROP TRIGGER equipping_enrollments_not_graded ON equipping_enrollments;
DROP FUNCTION assert_registration_not_graded();

CREATE OR REPLACE FUNCTION assert_enrollment_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.registration_id <> OLD.registration_id OR NEW.class_id <> OLD.class_id
       OR NEW.started_at <> OLD.started_at OR NEW.started_by <> OLD.started_by THEN
      RAISE EXCEPTION 'an enrollment keeps its registration and class (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.ended_at IS NOT NULL AND (
         NEW.ended_at IS DISTINCT FROM OLD.ended_at
         OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
         OR NEW.end_reason IS DISTINCT FROM OLD.end_reason
         OR NEW.withdraw_note IS DISTINCT FROM OLD.withdraw_note) THEN
      RAISE EXCEPTION 'an ended enrollment stays ended (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.ended_at IS NULL AND EXISTS (
       SELECT 1 FROM equipping_registrations r
        WHERE r.id = NEW.registration_id AND r.cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'nobody is placed in a class on a cancelled registration (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_no_mark_on_kept_lessons() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NULL AND EXISTS (
       SELECT 1
         FROM equipping_enrollments own
         JOIN equipping_lessons l ON l.id = NEW.lesson_id
         JOIN equipping_enrollments kept ON kept.registration_id = own.registration_id
         JOIN equipping_enrollments carrier ON carrier.carried_from_enrollment_id = kept.id
        WHERE own.id = NEW.enrollment_id
          AND l.lesson <= 4) THEN
    RAISE EXCEPTION 'lessons 1 to 4 kept for a later class are kept as recorded (SKILL.md section 29)'
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

DROP TRIGGER equipping_make_ups_posted_kept ON equipping_make_ups;
DROP TRIGGER equipping_marks_posted_kept ON equipping_marks;
DROP FUNCTION assert_posted_register_kept();
DROP TRIGGER equipping_grade_changes_kept ON equipping_grade_changes;
DROP FUNCTION assert_grade_change();
DROP VIEW equipping_current_grades;
DROP TABLE equipping_grade_changes;
