-- migrate:up

-- ---------------------------------------------------------------------------
-- A class's Guides and the students each follows up (SKILL.md section 29, decision 0501).
--
-- Additive: two new tables owned by `equipping`. Nothing existing is read or rewritten.
--
-- No row is deleted, as no row of the other three equipping tables is: a Guide removed from a
-- class keeps their row with when and by whom, and a student given another Guide keeps the old
-- pairing, closed. A trigger refuses DELETE on both.
-- ---------------------------------------------------------------------------

-- A Person named a Guide of one class (decision 0501, point 4). Who may be named, one level
-- ahead and a member of the tree, is checked by the application when the Coordinator names them,
-- and a Guide keeps the class if it stops holding, as a Teacher does.
CREATE TABLE equipping_class_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  person_id uuid NOT NULL REFERENCES persons (id),
  named_by uuid NOT NULL REFERENCES accounts (id),
  named_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_class_guides_removal_whole CHECK (
    (removed_at IS NULL) = (removed_by IS NULL)
  )
);

-- One open naming of a person per class.
CREATE UNIQUE INDEX equipping_class_guides_one_open
  ON equipping_class_guides (class_id, person_id)
  WHERE removed_at IS NULL;

-- A student's Guide in the class they are enrolled in (decision 0501, point 8). Keyed by the
-- enrollment, so a move to another class pairs the student afresh, and the pairing ends when the
-- enrollment does (decision 0502, point 1).
CREATE TABLE equipping_guide_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  guide_id uuid NOT NULL REFERENCES equipping_class_guides (id),
  started_by uuid NOT NULL REFERENCES accounts (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES accounts (id),
  -- SWAPPED: the Coordinator gave the student another Guide. GUIDE_REMOVED: their Guide left the
  -- class and they were shared out again. ENROLLMENT_ENDED: the student left the class, moved,
  -- withdrawn or archived (decision 0502, point 1).
  end_reason text CONSTRAINT equipping_guide_students_end_reason CHECK (
    end_reason IN ('SWAPPED', 'GUIDE_REMOVED', 'ENROLLMENT_ENDED')
  ),
  CONSTRAINT equipping_guide_students_end_whole CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL)
  )
);

-- One open Guide per enrollment.
CREATE UNIQUE INDEX equipping_guide_students_one_open
  ON equipping_guide_students (enrollment_id)
  WHERE ended_at IS NULL;

CREATE INDEX equipping_guide_students_by_guide ON equipping_guide_students (guide_id);

-- A student's Guide is a Guide of the class the student is enrolled in.
CREATE FUNCTION assert_guide_of_the_class() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM equipping_enrollments e
      JOIN equipping_class_guides g ON g.class_id = e.class_id
     WHERE e.id = NEW.enrollment_id
       AND g.id = NEW.guide_id
  ) THEN
    RAISE EXCEPTION 'A student''s Guide must be a Guide of the class the student is in.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_guide_students_same_class';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_guide_students_same_class
  BEFORE INSERT OR UPDATE OF enrollment_id, guide_id ON equipping_guide_students
  FOR EACH ROW EXECUTE FUNCTION assert_guide_of_the_class();

-- A naming keeps its class and person, and a removed Guide stays removed. A Guide is removed
-- only once none of their pairings is open, so no open pairing names a Guide who has left.
CREATE FUNCTION assert_guide_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id <> OLD.class_id OR NEW.person_id <> OLD.person_id
     OR NEW.named_by <> OLD.named_by OR NEW.named_at <> OLD.named_at THEN
    RAISE EXCEPTION 'a Guide naming keeps its class and person (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL AND (
       NEW.removed_at IS DISTINCT FROM OLD.removed_at
       OR NEW.removed_by IS DISTINCT FROM OLD.removed_by) THEN
    RAISE EXCEPTION 'a removed Guide stays removed (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM equipping_guide_students gs
        WHERE gs.guide_id = NEW.id AND gs.ended_at IS NULL) THEN
    RAISE EXCEPTION 'a Guide is removed only once their students are given another (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_class_guides_history_kept
  BEFORE UPDATE ON equipping_class_guides
  FOR EACH ROW EXECUTE FUNCTION assert_guide_history_kept();

-- A pairing keeps its student and Guide, an ended one stays ended, and an open one names a
-- Guide still in the class and an enrollment still open. The enrollment is read FOR SHARE, so a
-- pairing opened while that enrollment is being ended waits for it and is then refused.
CREATE FUNCTION assert_pairing_history_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.enrollment_id <> OLD.enrollment_id OR NEW.guide_id <> OLD.guide_id
       OR NEW.started_by <> OLD.started_by OR NEW.started_at <> OLD.started_at THEN
      RAISE EXCEPTION 'a Guide pairing keeps its student and Guide (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.ended_at IS NOT NULL AND (
         NEW.ended_at IS DISTINCT FROM OLD.ended_at
         OR NEW.ended_by IS DISTINCT FROM OLD.ended_by
         OR NEW.end_reason IS DISTINCT FROM OLD.end_reason) THEN
      RAISE EXCEPTION 'an ended Guide pairing stays ended (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.ended_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM equipping_class_guides g WHERE g.id = NEW.guide_id AND g.removed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'no student is paired with a Guide who has left the class (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM equipping_enrollments e WHERE e.id = NEW.enrollment_id FOR SHARE;
    IF EXISTS (SELECT 1 FROM equipping_enrollments e WHERE e.id = NEW.enrollment_id AND e.ended_at IS NOT NULL) THEN
      RAISE EXCEPTION 'no Guide pairing is open on an ended enrollment (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_guide_students_history_kept
  BEFORE INSERT OR UPDATE ON equipping_guide_students
  FOR EACH ROW EXECUTE FUNCTION assert_pairing_history_kept();

-- **A pairing ends when its enrollment does** (decision 0502, point 1), whichever path ends it:
-- a move, a withdrawal, or an archive. Done here rather than in each path, so a path added later
-- cannot leave a pairing open, and stamped with the enrollment's own instant and actor.
CREATE FUNCTION end_pairing_with_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL THEN
    UPDATE equipping_guide_students
       SET ended_at = NEW.ended_at, ended_by = NEW.ended_by, end_reason = 'ENROLLMENT_ENDED'
     WHERE enrollment_id = NEW.id AND ended_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER equipping_enrollments_end_pairing
  AFTER UPDATE OF ended_at ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION end_pairing_with_enrollment();

-- Nothing is deleted from either table (section 29).
CREATE FUNCTION refuse_equipping_guide_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A Guide naming or pairing is ended, never deleted (SKILL.md section 29).'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER equipping_class_guides_no_delete
  BEFORE DELETE ON equipping_class_guides
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_guide_delete();

CREATE TRIGGER equipping_guide_students_no_delete
  BEFORE DELETE ON equipping_guide_students
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_guide_delete();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_class_guides equipping_guide_students

-- Refused once either holds a row: who guided a class, and which Guide each student had, are
-- the school's history (decision 0501).

DROP TRIGGER equipping_enrollments_end_pairing ON equipping_enrollments;
DROP FUNCTION end_pairing_with_enrollment();
DROP TRIGGER equipping_guide_students_history_kept ON equipping_guide_students;
DROP FUNCTION assert_pairing_history_kept();
DROP TRIGGER equipping_class_guides_history_kept ON equipping_class_guides;
DROP FUNCTION assert_guide_history_kept();
DROP TRIGGER equipping_guide_students_no_delete ON equipping_guide_students;
DROP TRIGGER equipping_class_guides_no_delete ON equipping_class_guides;
DROP FUNCTION refuse_equipping_guide_delete();
DROP TRIGGER equipping_guide_students_same_class ON equipping_guide_students;
DROP FUNCTION assert_guide_of_the_class();
DROP TABLE equipping_guide_students;
DROP TABLE equipping_class_guides;
