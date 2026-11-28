-- migrate:up

-- ---------------------------------------------------------------------------
-- The Admin changes a SOL grade after posting (SKILL.md section 29, decision 0514, point 12, and
-- the owner's rulings of 2026-11-26, "Yes, build it" and "Recorded wrongly only").
--
-- A Life Class change reaches one lesson's attendance (decision 0513). A SOL change reaches what
-- SOL grades by: a lesson's attendance, a lesson's memory verse or devotional, a quiz try's score,
-- or *Book read*. So `equipping_grade_changes` gains the item changed and its value before and
-- after, a lesson may be 10, and the columns that only Life Class fills (the Encounter) may be
-- empty. Each level is held to its own shape by a trigger, the level being on the class: Life
-- Class changes attendance alone, as before; a SOL change is *Recorded wrongly* and nothing else
-- (owner, 2026-11-26), never *Not yet* nor a join at Lesson 6, and names no Encounter.
--
-- **A posted SOL class's records are final in the database too**, as its register already is
-- (migration 0059): a late tick, a quiz try or *Book read* of a graded enrollment is written, or
-- closed, only in a transaction that records a change of that grade.
--
-- `life_class_filed_at` now holds a SOL grade's SOL 1 filing instant too, as it holds Life Class's:
-- the instant whose Manila day dated it, for a later change to withdraw exactly that.
--
-- Additive: columns added, NOT NULLs relaxed, CHECK constraints replaced by ones that hold every
-- existing row (each is a Life Class attendance change), and triggers. No row is rewritten and no
-- effective date is set, so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

ALTER TABLE equipping_grade_changes
  ADD COLUMN item text NOT NULL DEFAULT 'ATTENDANCE'
    CONSTRAINT equipping_grade_changes_item
    CHECK (item IN ('ATTENDANCE', 'VERSE', 'DEVOTIONAL', 'QUIZ', 'BOOK')),
  -- A verse or devotional, HANDED_IN or NOT_HANDED_IN; the book, READ or NOT_READ.
  ADD COLUMN value_before text,
  ADD COLUMN value_after text,
  -- The day a verse or devotional was handed in, as it happened.
  ADD COLUMN brought_on date,
  -- A quiz try's number and its score before (none where the try was never recorded) and after.
  ADD COLUMN quiz_try smallint CONSTRAINT equipping_grade_changes_quiz_try CHECK (quiz_try BETWEEN 1 AND 3),
  ADD COLUMN score_before smallint,
  ADD COLUMN score_after smallint;

ALTER TABLE equipping_grade_changes ALTER COLUMN lesson DROP NOT NULL;
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_lesson;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_lesson CHECK (
  (lesson IS NULL) = (item IN ('QUIZ', 'BOOK'))
  AND (lesson IS NULL OR lesson BETWEEN 1 AND 10)
);

ALTER TABLE equipping_grade_changes ALTER COLUMN sign_before DROP NOT NULL;
ALTER TABLE equipping_grade_changes ALTER COLUMN sign_after DROP NOT NULL;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_sign_for_attendance CHECK (
  (item = 'ATTENDANCE') = (sign_before IS NOT NULL AND sign_after IS NOT NULL)
  AND (item = 'ATTENDANCE' OR (sign_before IS NULL AND sign_after IS NULL))
);

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_made_up_dated;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_made_up_dated CHECK (
  CASE WHEN item = 'ATTENDANCE'
    THEN (made_up_on_before IS NOT NULL) = (sign_before = 'MADE_UP')
     AND (made_up_on_after IS NOT NULL) = (sign_after = 'MADE_UP')
    ELSE made_up_on_before IS NULL AND made_up_on_after IS NULL
  END
);

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_changes;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_changes CHECK (
  CASE WHEN item = 'ATTENDANCE'
    THEN sign_before <> sign_after OR made_up_on_before IS DISTINCT FROM made_up_on_after
    ELSE value_before IS DISTINCT FROM value_after OR score_before IS DISTINCT FROM score_after
  END
);

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_before_joining;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_before_joining CHECK (
  item <> 'ATTENDANCE' OR sign_before <> 'BEFORE_JOINING' OR sign_after = 'MADE_UP'
);

-- What each item carries, and nothing else.
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_item_values CHECK (
  CASE item
    WHEN 'ATTENDANCE' THEN value_before IS NULL AND value_after IS NULL AND brought_on IS NULL
      AND quiz_try IS NULL AND score_before IS NULL AND score_after IS NULL
    WHEN 'BOOK' THEN value_before IN ('READ', 'NOT_READ') AND value_after IN ('READ', 'NOT_READ')
      AND brought_on IS NULL AND quiz_try IS NULL AND score_before IS NULL AND score_after IS NULL
    WHEN 'QUIZ' THEN value_before IS NULL AND value_after IS NULL AND brought_on IS NULL
      AND quiz_try IS NOT NULL AND score_after IS NOT NULL AND score_after >= 0
      AND (score_before IS NULL OR score_before >= 0)
    ELSE value_before IN ('HANDED_IN', 'NOT_HANDED_IN') AND value_after IN ('HANDED_IN', 'NOT_HANDED_IN')
      AND (brought_on IS NOT NULL) = (value_after = 'HANDED_IN')
      AND quiz_try IS NULL AND score_before IS NULL AND score_after IS NULL
  END
);

ALTER TABLE equipping_grade_changes ALTER COLUMN encounter_before DROP NOT NULL;
ALTER TABLE equipping_grade_changes ALTER COLUMN encounter_after DROP NOT NULL;

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_kept;
ALTER TABLE equipping_grade_changes
  ADD CONSTRAINT equipping_grade_changes_kept CHECK (lessons_kept_after BETWEEN 0 AND 10);
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_made_up;
ALTER TABLE equipping_grade_changes
  ADD CONSTRAINT equipping_grade_changes_made_up CHECK (lessons_made_up_after BETWEEN 0 AND 10);

-- Each level's shape, which no CHECK can read.
CREATE FUNCTION assert_grade_change_fits_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
BEGIN
  SELECT c.level INTO class_level
    FROM equipping_final_grades g
    JOIN equipping_class_postings p ON p.id = g.posting_id
    JOIN equipping_classes c ON c.id = p.class_id
   WHERE g.id = NEW.final_grade_id;
  IF class_level = 'LIFE_CLASS' THEN
    IF NEW.item <> 'ATTENDANCE' OR NEW.lesson > 9 OR NEW.lesson = 5
       OR NEW.encounter_before IS NULL OR NEW.encounter_after IS NULL
       OR NEW.lessons_kept_after > 9 OR NEW.lessons_made_up_after > 9 THEN
      RAISE EXCEPTION 'a Life Class change reaches one of its nine lessons and reads the Encounter (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.why <> 'RECORDED_WRONGLY' OR NEW.encounter_before IS NOT NULL OR NEW.encounter_after IS NOT NULL
       OR NEW.grade_after = 'NOT_YET' OR NEW.joins_at_lesson_6_after OR NEW.life_class_weekend
       OR NEW.enrollment_effect IS NOT NULL THEN
      RAISE EXCEPTION 'a SOL change is recorded wrongly, names no Encounter, is never Not yet, and ends or reopens no enrollment (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_grade_changes_fit_level
  BEFORE INSERT ON equipping_grade_changes
  FOR EACH ROW EXECUTE FUNCTION assert_grade_change_fits_level();

-- A late tick is keyed by lesson and enrollment, as a mark is: 0059's guard reads it as it is.
CREATE TRIGGER equipping_items_brought_posted_kept
  BEFORE INSERT OR UPDATE ON equipping_items_brought
  FOR EACH ROW EXECUTE FUNCTION assert_posted_register_kept();

-- A quiz try and *Book read* are keyed by enrollment alone.
CREATE FUNCTION assert_posted_record_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_final_grades g WHERE g.enrollment_id = NEW.enrollment_id)
     AND NOT EXISTS (
       SELECT 1 FROM equipping_grade_changes c
         JOIN equipping_final_grades g ON g.id = c.final_grade_id
        WHERE c.changed_at = now() AND g.enrollment_id = NEW.enrollment_id) THEN
    RAISE EXCEPTION 'a posted class''s quiz and book change only with a change of the grade, by the Admin (SKILL.md section 29)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'equipping_posted_register_kept';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_quiz_tries_posted_kept
  BEFORE INSERT OR UPDATE ON equipping_quiz_tries
  FOR EACH ROW EXECUTE FUNCTION assert_posted_record_kept();

CREATE TRIGGER equipping_books_posted_kept
  BEFORE INSERT OR UPDATE ON equipping_books
  FOR EACH ROW EXECUTE FUNCTION assert_posted_record_kept();

-- migrate:down

-- Refused while a SOL change exists, which the narrower table cannot hold.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_grade_changes WHERE item <> 'ATTENDANCE' OR encounter_before IS NULL OR lesson = 10) THEN
    RAISE EXCEPTION 'SOL grade changes exist; reverting 0063 would lose them';
  END IF;
END;
$$;

DROP TRIGGER equipping_books_posted_kept ON equipping_books;
DROP TRIGGER equipping_quiz_tries_posted_kept ON equipping_quiz_tries;
DROP FUNCTION assert_posted_record_kept();
DROP TRIGGER equipping_items_brought_posted_kept ON equipping_items_brought;
DROP TRIGGER equipping_grade_changes_fit_level ON equipping_grade_changes;
DROP FUNCTION assert_grade_change_fits_level();

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_made_up;
ALTER TABLE equipping_grade_changes
  ADD CONSTRAINT equipping_grade_changes_made_up CHECK (lessons_made_up_after BETWEEN 0 AND 9);
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_kept;
ALTER TABLE equipping_grade_changes
  ADD CONSTRAINT equipping_grade_changes_kept CHECK (lessons_kept_after BETWEEN 0 AND 9);
ALTER TABLE equipping_grade_changes ALTER COLUMN encounter_after SET NOT NULL;
ALTER TABLE equipping_grade_changes ALTER COLUMN encounter_before SET NOT NULL;

ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_item_values;
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_before_joining;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_before_joining CHECK (
  sign_before <> 'BEFORE_JOINING' OR sign_after = 'MADE_UP'
);
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_changes;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_changes CHECK (
  sign_before <> sign_after OR made_up_on_before IS DISTINCT FROM made_up_on_after
);
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_made_up_dated;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_made_up_dated CHECK (
  (made_up_on_before IS NOT NULL) = (sign_before = 'MADE_UP')
  AND (made_up_on_after IS NOT NULL) = (sign_after = 'MADE_UP')
);
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_sign_for_attendance;
ALTER TABLE equipping_grade_changes ALTER COLUMN sign_after SET NOT NULL;
ALTER TABLE equipping_grade_changes ALTER COLUMN sign_before SET NOT NULL;
ALTER TABLE equipping_grade_changes DROP CONSTRAINT equipping_grade_changes_lesson;
ALTER TABLE equipping_grade_changes ALTER COLUMN lesson SET NOT NULL;
ALTER TABLE equipping_grade_changes ADD CONSTRAINT equipping_grade_changes_lesson
  CHECK (lesson BETWEEN 1 AND 9 AND lesson <> 5);

ALTER TABLE equipping_grade_changes
  DROP COLUMN score_after,
  DROP COLUMN score_before,
  DROP COLUMN quiz_try,
  DROP COLUMN brought_on,
  DROP COLUMN value_after,
  DROP COLUMN value_before,
  DROP COLUMN item;
