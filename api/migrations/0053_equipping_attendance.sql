-- migrate:up

-- ---------------------------------------------------------------------------
-- A class's attendance and make-ups (SKILL.md section 29, decisions 0501 and 0503).
--
-- The Teacher ticks who came to each lesson, anyone not ticked saved Absent, and records a
-- make-up as M with its date. Additive: an enum value nothing holds yet (it is not used in
-- this migration, so adding it inside its transaction is allowed), and four new tables owned
-- by `equipping`. Nothing existing is read or rewritten, and no effective date is set.
--
-- **Nothing is deleted, and a correction keeps the value it corrects** (principle 12): a mark
-- or a make-up changed is closed, with who and when, and a new row opened; a lesson's date
-- changed is kept in `equipping_lesson_date_changes`, which a trigger requires.
-- ---------------------------------------------------------------------------

ALTER TYPE capability ADD VALUE IF NOT EXISTS 'equipping.class';

-- One lesson of a class, once it has been recorded (decision 0503). Lessons 1 to 4 and 6 to 9:
-- lesson 5 is the Encounter, the Registrar's. `held_on` is the day the class met, which the
-- Teacher may change from the expected weekly date.
CREATE TABLE equipping_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  lesson smallint NOT NULL CONSTRAINT equipping_lessons_lesson CHECK (lesson BETWEEN 1 AND 9 AND lesson <> 5),
  held_on date NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- Counts every save of the lesson, so a save made against a stale copy is refused.
  version integer NOT NULL DEFAULT 1 CONSTRAINT equipping_lessons_version CHECK (version >= 1),
  CONSTRAINT equipping_lessons_one_per_class UNIQUE (class_id, lesson)
);

-- Whether a student came to a lesson. A correction closes the row and opens another.
CREATE TABLE equipping_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES equipping_lessons (id),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  came boolean NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  -- Given by the Admin correcting a lesson whose week has closed (decision 0501, point 11).
  correction_reason text CONSTRAINT equipping_marks_reason CHECK (
    correction_reason IS NULL OR (btrim(correction_reason) <> '' AND char_length(correction_reason) <= 500)
  ),
  CONSTRAINT equipping_marks_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_marks_one_current
  ON equipping_marks (lesson_id, enrollment_id)
  WHERE superseded_at IS NULL;

CREATE INDEX equipping_marks_by_enrollment ON equipping_marks (enrollment_id);

-- A make-up of a lesson a student missed: the Teacher played the recorded teaching and
-- records it as M with its date (decision 0501, point 12).
CREATE TABLE equipping_make_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES equipping_lessons (id),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  made_up_on date NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_make_ups_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_make_ups_one_current
  ON equipping_make_ups (lesson_id, enrollment_id)
  WHERE superseded_at IS NULL;

-- A lesson's date changed (decision 0503, point 1), keeping the date it changed from, as
-- `cell_meeting_changes` keeps a meeting's (principle 12). Written in the save that moves it.
CREATE TABLE equipping_lesson_date_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES equipping_lessons (id),
  held_on_before date NOT NULL,
  held_on_after date NOT NULL,
  changed_by uuid NOT NULL REFERENCES accounts (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- Given by the Admin moving a lesson whose week has closed.
  reason text CONSTRAINT equipping_lesson_date_changes_reason CHECK (
    reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500)
  ),
  CONSTRAINT equipping_lesson_date_changes_moves CHECK (held_on_before <> held_on_after)
);

CREATE INDEX equipping_lesson_date_changes_by_lesson ON equipping_lesson_date_changes (lesson_id);

-- A lesson keeps its class and number; only its date, recorder and version move.
CREATE FUNCTION assert_lesson_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id <> OLD.class_id OR NEW.lesson <> OLD.lesson THEN
    RAISE EXCEPTION 'a lesson keeps its class and number (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.held_on <> OLD.held_on THEN
    -- A date changed keeps the date it changed from, written in the same transaction
    -- (decision 0503, principle 12).
    IF NOT EXISTS (
         SELECT 1 FROM equipping_lesson_date_changes c
          WHERE c.lesson_id = NEW.id AND c.held_on_before = OLD.held_on
            AND c.held_on_after = NEW.held_on AND c.changed_at = now()) THEN
      RAISE EXCEPTION 'a lesson''s date changes with a record of the date it changed from (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    -- And may not move past a make-up of it already recorded.
    IF EXISTS (
         SELECT 1 FROM equipping_make_ups u
          WHERE u.lesson_id = NEW.id AND u.superseded_at IS NULL AND u.made_up_on < NEW.held_on) THEN
      RAISE EXCEPTION 'a lesson''s date may not move past a make-up of it (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_lessons_history_kept
  BEFORE UPDATE ON equipping_lessons
  FOR EACH ROW EXECUTE FUNCTION assert_lesson_history_kept();

-- A mark or make-up keeps what it says; it is closed once and stays closed, and a current one
-- names a student enrolled in the lesson's class.
CREATE FUNCTION assert_mark_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'superseded_at' - 'superseded_by' <> to_jsonb(OLD) - 'superseded_at' - 'superseded_by' THEN
      RAISE EXCEPTION 'an attendance record keeps what it says; a correction is a new row (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'a corrected attendance record stays corrected (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.superseded_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM equipping_enrollments e JOIN equipping_lessons l ON l.class_id = e.class_id
        WHERE e.id = NEW.enrollment_id AND l.id = NEW.lesson_id) THEN
    RAISE EXCEPTION 'an attendance record names a student of the lesson''s class (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_attendance_same_class';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_history_kept
  BEFORE INSERT OR UPDATE ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_mark_history_kept();

CREATE TRIGGER equipping_make_ups_history_kept
  BEFORE INSERT OR UPDATE ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION assert_mark_history_kept();

-- A make-up is of a lesson the student is currently marked absent from, or of one their class
-- held before they joined it, which carries no mark at all (decision 0503, owner ruling of
-- 2026-11-20: owed as a make-up, not counted as an absence).
CREATE FUNCTION assert_make_up_of_an_absence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lesson_day date;
BEGIN
  IF NEW.superseded_at IS NULL THEN
    -- The lesson's row held FOR SHARE, so its date cannot move under this make-up, and a make-up
    -- falls on or after the lesson it makes up (decision 0503).
    SELECT l.held_on INTO lesson_day FROM equipping_lessons l WHERE l.id = NEW.lesson_id FOR SHARE;
    IF NEW.made_up_on < lesson_day THEN
      RAISE EXCEPTION 'a make-up falls on or after the lesson it makes up (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.superseded_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM equipping_marks m
        WHERE m.lesson_id = NEW.lesson_id AND m.enrollment_id = NEW.enrollment_id
          AND m.superseded_at IS NULL AND NOT m.came)
     AND NOT (
       NOT EXISTS (
         SELECT 1 FROM equipping_marks m
          WHERE m.lesson_id = NEW.lesson_id AND m.enrollment_id = NEW.enrollment_id
            AND m.superseded_at IS NULL)
       AND EXISTS (
         SELECT 1 FROM equipping_enrollments e JOIN equipping_lessons l ON l.id = NEW.lesson_id
          WHERE e.id = NEW.enrollment_id
            AND (e.started_at AT TIME ZONE 'Asia/Manila')::date > l.held_on)) THEN
    RAISE EXCEPTION 'a make-up is of a lesson the student missed (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_make_ups_of_an_absence
  BEFORE INSERT ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION assert_make_up_of_an_absence();

-- And it stops standing once the absence does: a mark saying the student came is refused while
-- a make-up of that lesson is still current, so the make-up is closed first (decision 0503).
CREATE FUNCTION assert_no_make_up_of_a_lesson_attended() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NULL AND NEW.came AND EXISTS (
       SELECT 1 FROM equipping_make_ups u
        WHERE u.lesson_id = NEW.lesson_id AND u.enrollment_id = NEW.enrollment_id
          AND u.superseded_at IS NULL) THEN
    RAISE EXCEPTION 'a lesson made up is not also attended; close the make-up first (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_no_make_up_when_attended
  BEFORE INSERT ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_no_make_up_of_a_lesson_attended();

-- One current mark per student per lesson number across the classes they have been in: a moved
-- student keeps the mark the earlier class saved, and the new class does not mark that lesson
-- again (decision 0503, point 5).
CREATE FUNCTION assert_one_mark_per_lesson_number() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_at IS NULL AND EXISTS (
       SELECT 1
         FROM equipping_enrollments mine
         JOIN equipping_lessons this_lesson ON this_lesson.id = NEW.lesson_id
         JOIN equipping_enrollments other ON other.registration_id = mine.registration_id
                                         AND other.id <> mine.id
         JOIN equipping_marks m ON m.enrollment_id = other.id AND m.superseded_at IS NULL
         JOIN equipping_lessons l ON l.id = m.lesson_id AND l.lesson = this_lesson.lesson
        WHERE mine.id = NEW.enrollment_id) THEN
    RAISE EXCEPTION 'a student holds one mark for a lesson, in whichever class saved it (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_one_per_lesson_number
  BEFORE INSERT ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_one_mark_per_lesson_number();

-- A date change is kept as written.
CREATE FUNCTION refuse_lesson_date_change_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A lesson''s date change is kept as written (SKILL.md section 29).'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER equipping_lesson_date_changes_kept
  BEFORE UPDATE OR DELETE ON equipping_lesson_date_changes
  FOR EACH ROW EXECUTE FUNCTION refuse_lesson_date_change_rewrite();

-- Nothing is deleted from any of the three (section 29).
CREATE FUNCTION refuse_equipping_attendance_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Attendance is corrected, never deleted (SKILL.md section 29).'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER equipping_lessons_no_delete BEFORE DELETE ON equipping_lessons
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_attendance_delete();
CREATE TRIGGER equipping_marks_no_delete BEFORE DELETE ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_attendance_delete();
CREATE TRIGGER equipping_make_ups_no_delete BEFORE DELETE ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_attendance_delete();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_lessons equipping_marks equipping_make_ups equipping_lesson_date_changes

-- Refused once any holds a row: a class's attendance is the school's history (decision 0501).

DROP TRIGGER equipping_lesson_date_changes_kept ON equipping_lesson_date_changes;
DROP FUNCTION refuse_lesson_date_change_rewrite();
DROP TRIGGER equipping_marks_one_per_lesson_number ON equipping_marks;
DROP FUNCTION assert_one_mark_per_lesson_number();
DROP TRIGGER equipping_marks_no_make_up_when_attended ON equipping_marks;
DROP FUNCTION assert_no_make_up_of_a_lesson_attended();

DROP TRIGGER equipping_make_ups_no_delete ON equipping_make_ups;
DROP TRIGGER equipping_marks_no_delete ON equipping_marks;
DROP TRIGGER equipping_lessons_no_delete ON equipping_lessons;
DROP FUNCTION refuse_equipping_attendance_delete();
DROP TRIGGER equipping_make_ups_of_an_absence ON equipping_make_ups;
DROP FUNCTION assert_make_up_of_an_absence();
DROP TRIGGER equipping_make_ups_history_kept ON equipping_make_ups;
DROP TRIGGER equipping_marks_history_kept ON equipping_marks;
DROP FUNCTION assert_mark_history_kept();
DROP TRIGGER equipping_lessons_history_kept ON equipping_lessons;
DROP FUNCTION assert_lesson_history_kept();
DROP TABLE equipping_lesson_date_changes;
DROP TABLE equipping_make_ups;
DROP TABLE equipping_marks;
DROP TABLE equipping_lessons;

-- The enum value stays: PostgreSQL cannot remove one, and a value nothing holds is inert.
