-- migrate:up

-- ---------------------------------------------------------------------------
-- A class corrected until its first lesson is saved, and cancelled while it has no students
-- (SKILL.md section 29, decision 0510).
--
-- Additive: three nullable columns on `equipping_classes` and one new table owned by
-- `equipping`. No row is rewritten and no effective date is set. The name index becomes partial,
-- which only admits more: a cancelled class's name may be used again in its term.
--
-- **Nothing is deleted** (principle 12): a correction keeps the four values it replaced in
-- `equipping_class_corrections`, which a trigger requires, and a cancelled class keeps its row.
-- ---------------------------------------------------------------------------

ALTER TABLE equipping_classes
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES accounts (id),
  ADD COLUMN cancel_reason text,
  ADD CONSTRAINT equipping_classes_cancel_whole CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND btrim(cancel_reason) <> '' AND char_length(cancel_reason) <= 500)
  );

-- A name is unique among a term's classes that are not cancelled (point 7).
DROP INDEX equipping_classes_one_name_per_term;
CREATE UNIQUE INDEX equipping_classes_one_name_per_term
  ON equipping_classes (level, term_year, term_number, lower(btrim(name)))
  WHERE cancelled_at IS NULL;

-- A class's day, time, place and first lesson corrected (point 2), keeping what they were.
CREATE TABLE equipping_class_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  day_of_week_before smallint NOT NULL,
  day_of_week_after smallint NOT NULL,
  time_of_day_before time NOT NULL,
  time_of_day_after time NOT NULL,
  place_before text,
  place_after text,
  first_lesson_on_before date NOT NULL,
  first_lesson_on_after date NOT NULL,
  corrected_by uuid NOT NULL REFERENCES accounts (id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipping_class_corrections_changes CHECK (
    (day_of_week_before, time_of_day_before, place_before, first_lesson_on_before)
      IS DISTINCT FROM (day_of_week_after, time_of_day_after, place_after, first_lesson_on_after)
  )
);

CREATE INDEX equipping_class_corrections_by_class ON equipping_class_corrections (class_id);

-- A correction is kept as written.
CREATE FUNCTION refuse_class_correction_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a class correction is kept as written (SKILL.md section 29)'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER equipping_class_corrections_kept
  BEFORE UPDATE OR DELETE ON equipping_class_corrections
  FOR EACH ROW EXECUTE FUNCTION refuse_class_correction_rewrite();

-- Points 1, 2, 3 and 5. A cancelled class changes no further; its day, time, place and first
-- lesson change only before a lesson is saved and with a record of what they were; and it is
-- cancelled only while no enrollment of it is open and no lesson is saved. Each read is its own
-- statement, so it sees what a transaction it waited behind committed.
CREATE FUNCTION assert_class_change_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'a cancelled class is final (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_class_cancelled';
  END IF;

  IF (NEW.day_of_week, NEW.time_of_day, NEW.place, NEW.first_lesson_on)
       IS DISTINCT FROM (OLD.day_of_week, OLD.time_of_day, OLD.place, OLD.first_lesson_on) THEN
    IF EXISTS (SELECT 1 FROM equipping_lessons l WHERE l.class_id = NEW.id) THEN
      RAISE EXCEPTION 'a class''s day, time, place and first lesson are corrected only before a lesson is saved (SKILL.md section 29)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_class_lesson_saved';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM equipping_class_corrections c
          WHERE c.class_id = NEW.id AND c.corrected_at = now()
            AND c.day_of_week_before = OLD.day_of_week AND c.day_of_week_after = NEW.day_of_week
            AND c.time_of_day_before = OLD.time_of_day AND c.time_of_day_after = NEW.time_of_day
            AND c.place_before IS NOT DISTINCT FROM OLD.place
            AND c.place_after IS NOT DISTINCT FROM NEW.place
            AND c.first_lesson_on_before = OLD.first_lesson_on
            AND c.first_lesson_on_after = NEW.first_lesson_on) THEN
      RAISE EXCEPTION 'a class is corrected with a record of what it was (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.cancelled_at IS NOT NULL THEN
    IF to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by' - 'cancel_reason'
         <> to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by' - 'cancel_reason' THEN
      RAISE EXCEPTION 'a class is cancelled as it stands (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM equipping_enrollments e WHERE e.class_id = NEW.id AND e.ended_at IS NULL) THEN
      RAISE EXCEPTION 'a class is cancelled only while nobody is enrolled (SKILL.md section 29)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_class_has_students';
    END IF;
    IF EXISTS (SELECT 1 FROM equipping_lessons l WHERE l.class_id = NEW.id) THEN
      RAISE EXCEPTION 'a class is cancelled only while no lesson is saved (SKILL.md section 29)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_class_lesson_saved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_classes_change_allowed
  BEFORE UPDATE ON equipping_classes
  FOR EACH ROW EXECUTE FUNCTION assert_class_change_allowed();

-- Nothing joins a cancelled class (point 5): no student, lesson or Guide. The class is read
-- FOR SHARE, which waits behind a cancellation's row lock and is waited behind by it, so the two
-- never both succeed.
CREATE FUNCTION assert_class_not_cancelled() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cancelled timestamptz;
BEGIN
  SELECT c.cancelled_at INTO cancelled FROM equipping_classes c WHERE c.id = NEW.class_id FOR SHARE;
  IF cancelled IS NOT NULL THEN
    RAISE EXCEPTION 'a cancelled class takes nobody and nothing (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_class_cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_enrollments_class_not_cancelled
  BEFORE INSERT ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION assert_class_not_cancelled();

CREATE TRIGGER equipping_lessons_class_not_cancelled
  BEFORE INSERT ON equipping_lessons
  FOR EACH ROW EXECUTE FUNCTION assert_class_not_cancelled();

CREATE TRIGGER equipping_class_guides_class_not_cancelled
  BEFORE INSERT ON equipping_class_guides
  FOR EACH ROW EXECUTE FUNCTION assert_class_not_cancelled();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_class_corrections

-- Refused while a class is cancelled: dropping the columns would bring it back as a class.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_classes WHERE cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cancelled classes exist; this migration is not reversed';
  END IF;
END;
$$;

DROP TRIGGER equipping_class_guides_class_not_cancelled ON equipping_class_guides;
DROP TRIGGER equipping_lessons_class_not_cancelled ON equipping_lessons;
DROP TRIGGER equipping_enrollments_class_not_cancelled ON equipping_enrollments;
DROP FUNCTION assert_class_not_cancelled();
DROP TRIGGER equipping_classes_change_allowed ON equipping_classes;
DROP FUNCTION assert_class_change_allowed();
DROP TABLE equipping_class_corrections;
DROP FUNCTION refuse_class_correction_rewrite();
DROP INDEX equipping_classes_one_name_per_term;
CREATE UNIQUE INDEX equipping_classes_one_name_per_term
  ON equipping_classes (level, term_year, term_number, lower(btrim(name)));
ALTER TABLE equipping_classes
  DROP CONSTRAINT equipping_classes_cancel_whole,
  DROP COLUMN cancel_reason,
  DROP COLUMN cancelled_by,
  DROP COLUMN cancelled_at;
