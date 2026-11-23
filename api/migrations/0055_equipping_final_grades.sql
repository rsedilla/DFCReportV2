-- migrate:up

-- ---------------------------------------------------------------------------
-- A class's final grades: the Coordinator's check and the Registrar's posting (SKILL.md section
-- 29, decisions 0501 and 0508).
--
-- The grade is worked out from the register and never typed (0501, point 15). The Coordinator
-- marks a class checked, the Admin checking any student who is that Coordinator's own disciple;
-- the Registrar posts a checked class, which records each student's grade as it stood and ends
-- the enrollments that finished. Additive: three new tables owned by `equipping`, and one more
-- value an enrollment may end with. Nothing existing is read or rewritten, and no effective
-- date is set.
-- ---------------------------------------------------------------------------

-- A class marked checked (0501, point 16). `by_admin`: checked by a Whole Church holder of
-- `equipping.coordinate` other than through the Life Class Coordinator tick, which covers the
-- Coordinator's own disciples. `fingerprint` is a digest of every student's grade, reason,
-- lessons and marks, and the lessons still to record, as the checker read them: a check stands
-- only while the class's grades are exactly that (decision 0508).
CREATE TABLE equipping_class_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  checked_by uuid NOT NULL REFERENCES accounts (id),
  checker_person_id uuid REFERENCES persons (id),
  by_admin boolean NOT NULL,
  fingerprint text NOT NULL CONSTRAINT equipping_class_checks_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX equipping_class_checks_by_class ON equipping_class_checks (class_id, checked_at);

-- A class posted, once (0501, point 16).
CREATE TABLE equipping_class_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  check_id uuid NOT NULL REFERENCES equipping_class_checks (id),
  posted_by uuid NOT NULL REFERENCES accounts (id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipping_class_postings_once UNIQUE (class_id)
);

-- Each student's grade as posted: Passed, Not passed, or Not yet for one who has still to attend
-- the Encounter (decision 0508), with the reason in words and the lessons counted.
CREATE TABLE equipping_final_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_id uuid NOT NULL REFERENCES equipping_class_postings (id),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  grade text NOT NULL CONSTRAINT equipping_final_grades_grade CHECK (grade IN ('PASSED', 'NOT_PASSED', 'NOT_YET')),
  reason text NOT NULL CONSTRAINT equipping_final_grades_reason CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
  lessons_kept smallint NOT NULL CONSTRAINT equipping_final_grades_kept CHECK (lessons_kept BETWEEN 0 AND 9),
  lessons_made_up smallint NOT NULL CONSTRAINT equipping_final_grades_made_up CHECK (lessons_made_up BETWEEN 0 AND 9),
  CONSTRAINT equipping_final_grades_once UNIQUE (enrollment_id)
);

-- A finished enrollment ends as COMPLETED when its class is posted (decision 0508).
ALTER TABLE equipping_enrollments DROP CONSTRAINT equipping_enrollments_end_reason;
ALTER TABLE equipping_enrollments ADD CONSTRAINT equipping_enrollments_end_reason
  CHECK (end_reason IN ('MOVED', 'WITHDRAWN', 'ARCHIVED', 'COMPLETED'));

-- A posting rests on a check of its own class, and a grade on an enrollment of the posted class.
CREATE FUNCTION assert_posting_matches_class() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'equipping_class_postings' THEN
    IF NOT EXISTS (SELECT 1 FROM equipping_class_checks c
                    WHERE c.id = NEW.check_id AND c.class_id = NEW.class_id) THEN
      RAISE EXCEPTION 'a posting rests on a check of its own class (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM equipping_class_postings p
                     JOIN equipping_enrollments e ON e.class_id = p.class_id
                    WHERE p.id = NEW.posting_id AND e.id = NEW.enrollment_id) THEN
      RAISE EXCEPTION 'a grade is of an enrollment in the posted class (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_class_postings_match BEFORE INSERT ON equipping_class_postings
  FOR EACH ROW EXECUTE FUNCTION assert_posting_matches_class();
CREATE TRIGGER equipping_final_grades_match BEFORE INSERT ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION assert_posting_matches_class();

-- A check, a posting and a grade keep what they say, and none is deleted (section 29).
CREATE FUNCTION refuse_equipping_grade_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A class''s check, posting and grades are kept as written (SKILL.md section 29).'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER equipping_class_checks_kept BEFORE UPDATE OR DELETE ON equipping_class_checks
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_grade_rewrite();
CREATE TRIGGER equipping_class_postings_kept BEFORE UPDATE OR DELETE ON equipping_class_postings
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_grade_rewrite();
CREATE TRIGGER equipping_final_grades_kept BEFORE UPDATE OR DELETE ON equipping_final_grades
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_grade_rewrite();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_class_checks equipping_class_postings equipping_final_grades

-- Refused once any holds a row: a posted grade is the school's record.

DROP TRIGGER equipping_final_grades_kept ON equipping_final_grades;
DROP TRIGGER equipping_class_postings_kept ON equipping_class_postings;
DROP TRIGGER equipping_class_checks_kept ON equipping_class_checks;
DROP FUNCTION refuse_equipping_grade_rewrite();
DROP TRIGGER equipping_final_grades_match ON equipping_final_grades;
DROP TRIGGER equipping_class_postings_match ON equipping_class_postings;
DROP FUNCTION assert_posting_matches_class();
ALTER TABLE equipping_enrollments DROP CONSTRAINT equipping_enrollments_end_reason;
ALTER TABLE equipping_enrollments ADD CONSTRAINT equipping_enrollments_end_reason
  CHECK (end_reason IN ('MOVED', 'WITHDRAWN', 'ARCHIVED'));
DROP TABLE equipping_final_grades;
DROP TABLE equipping_class_postings;
DROP TABLE equipping_class_checks;
