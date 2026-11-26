-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 1's register (SKILL.md section 29, decision 0514, points 8 to 10, and the owner's
-- rulings of 2026-11-26): ten lessons, each student's memory verse and devotional ticked with
-- the lesson or at its make-up, a verse or devotional brought late ticked apart, the quiz's
-- number of items and each try's score, and whether the book was read.
--
-- Additive: two nullable columns on each of two tables, a CHECK replaced by a wider one with a
-- trigger holding each level to its own lessons, and four new tables. Every existing lesson is
-- a Life Class lesson numbered 1 to 4 or 6 to 9, and every existing mark and make-up is Life
-- Class's with neither new column set, so every new rule holds for every row that exists, and
-- the migration refuses on its own if one does not. No row is rewritten and no effective date
-- is set, so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

-- A class's lessons by its level: Life Class's are 1 to 4 and 6 to 9, the Encounter being
-- lesson 5 (decision 0295); SOL's are 1 to 10 (decision 0501, point 17).
ALTER TABLE equipping_lessons DROP CONSTRAINT equipping_lessons_lesson;
ALTER TABLE equipping_lessons
  ADD CONSTRAINT equipping_lessons_lesson CHECK (lesson BETWEEN 1 AND 10);

CREATE FUNCTION assert_lesson_fits_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
BEGIN
  SELECT level INTO class_level FROM equipping_classes WHERE id = NEW.class_id;
  IF class_level = 'LIFE_CLASS' AND (NEW.lesson = 5 OR NEW.lesson > 9) THEN
    RAISE EXCEPTION 'a Life Class records lessons 1 to 4 and 6 to 9 (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_lessons_fit_level
  BEFORE INSERT ON equipping_lessons
  FOR EACH ROW EXECUTE FUNCTION assert_lesson_fits_level();

-- The memory verse and the devotional, ticked with the lesson for a student who came, and at the
-- make-up for one who did not (decision 0514, points 8 and 9). Null on Life Class's rows, and on
-- a SOL mark of somebody absent, whose two are ticked at the make-up.
ALTER TABLE equipping_marks ADD COLUMN verse boolean;
ALTER TABLE equipping_marks ADD COLUMN devotional boolean;
ALTER TABLE equipping_marks
  ADD CONSTRAINT equipping_marks_items_together CHECK ((verse IS NULL) = (devotional IS NULL));
ALTER TABLE equipping_make_ups ADD COLUMN verse boolean;
ALTER TABLE equipping_make_ups ADD COLUMN devotional boolean;
ALTER TABLE equipping_make_ups
  ADD CONSTRAINT equipping_make_ups_items_together CHECK ((verse IS NULL) = (devotional IS NULL));

-- Which rows carry the two ticks follows the class's level, which no CHECK can read. A mark and a
-- make-up are written once and only closed afterwards, so this holds at insert.
CREATE FUNCTION assert_items_fit_level() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
  ticked boolean;
BEGIN
  SELECT c.level INTO class_level
    FROM equipping_lessons l JOIN equipping_classes c ON c.id = l.class_id
   WHERE l.id = NEW.lesson_id;
  ticked := NEW.verse IS NOT NULL;
  IF TG_TABLE_NAME = 'equipping_marks' THEN
    IF ticked <> (class_level = 'SOL_1' AND NEW.came) THEN
      RAISE EXCEPTION 'a SOL lesson ticks the memory verse and devotional of whoever came, and Life Class ticks neither (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF ticked <> (class_level = 'SOL_1') THEN
    RAISE EXCEPTION 'a SOL make-up ticks the memory verse and devotional, and a Life Class make-up ticks neither (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_marks_items_fit_level
  BEFORE INSERT ON equipping_marks
  FOR EACH ROW EXECUTE FUNCTION assert_items_fit_level();

CREATE TRIGGER equipping_make_ups_items_fit_level
  BEFORE INSERT ON equipping_make_ups
  FOR EACH ROW EXECUTE FUNCTION assert_items_fit_level();

-- A verse or devotional brought after its lesson, ticked on *Verses and devotionals still owed*
-- (decision 0514, point 10). It counts as an on-time one and carries no late mark. A wrong tick
-- is closed, never deleted.
CREATE TABLE equipping_items_brought (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES equipping_lessons (id),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  item text NOT NULL CONSTRAINT equipping_items_brought_item CHECK (item IN ('VERSE', 'DEVOTIONAL')),
  brought_on date NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_items_brought_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_items_brought_one_current
  ON equipping_items_brought (lesson_id, enrollment_id, item)
  WHERE superseded_at IS NULL;

-- The quiz: its number of items, entered once for the class (decision 0501, point 18), and
-- corrected only until the first score is recorded, after which every score is read against it.
CREATE TABLE equipping_quizzes (
  class_id uuid PRIMARY KEY REFERENCES equipping_classes (id),
  items smallint NOT NULL CONSTRAINT equipping_quizzes_items CHECK (items BETWEEN 1 AND 500),
  set_by uuid NOT NULL REFERENCES accounts (id),
  set_at timestamptz NOT NULL DEFAULT now()
);

-- Each try's score, every score kept (decision 0501, point 18): three tries, the first and two
-- retakes; a correction closes the row and opens another (owner, 2026-11-26).
CREATE TABLE equipping_quiz_tries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  try smallint NOT NULL CONSTRAINT equipping_quiz_tries_try CHECK (try BETWEEN 1 AND 3),
  score smallint NOT NULL CONSTRAINT equipping_quiz_tries_score CHECK (score >= 0),
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_quiz_tries_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_quiz_tries_one_current
  ON equipping_quiz_tries (enrollment_id, try)
  WHERE superseded_at IS NULL;

-- Whether the book was read, recorded and corrected by the Teacher until posting (owner,
-- 2026-11-26); a correction closes the row and opens another.
CREATE TABLE equipping_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  read boolean NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_books_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_books_one_current
  ON equipping_books (enrollment_id)
  WHERE superseded_at IS NULL;

-- A score fits the quiz it was taken against, and the number of items stays put once a score
-- reads against it.
CREATE FUNCTION assert_quiz_score_fits() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  quiz_items smallint;
BEGIN
  SELECT q.items INTO quiz_items
    FROM equipping_enrollments e JOIN equipping_quizzes q ON q.class_id = e.class_id
   WHERE e.id = NEW.enrollment_id;
  IF quiz_items IS NULL THEN
    RAISE EXCEPTION 'a score is recorded once the quiz''s number of items is (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.score > quiz_items THEN
    RAISE EXCEPTION 'a score is at most the quiz''s number of items (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A retake follows a failed try and nothing else (owner, 2026-11-26): try N is admitted only
  -- on a current try N - 1 that scored under 70%. It is checked as the later try is written, not
  -- again when an earlier one is corrected.
  IF NEW.try > 1 AND NOT EXISTS (
       SELECT 1 FROM equipping_quiz_tries t
        WHERE t.enrollment_id = NEW.enrollment_id AND t.try = NEW.try - 1
          AND t.superseded_at IS NULL AND t.score * 10 < quiz_items * 7) THEN
    RAISE EXCEPTION 'a retake follows a failed try (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_quiz_tries_score_fits
  BEFORE INSERT ON equipping_quiz_tries
  FOR EACH ROW EXECUTE FUNCTION assert_quiz_score_fits();

-- The quiz, the book and an item brought late are SOL's alone (decision 0514, points 8 to 10):
-- Life Class keeps none of them.
CREATE FUNCTION assert_sol_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  class_level text;
BEGIN
  IF TG_TABLE_NAME = 'equipping_quizzes' THEN
    SELECT c.level INTO class_level FROM equipping_classes c WHERE c.id = NEW.class_id;
  ELSIF TG_TABLE_NAME = 'equipping_items_brought' THEN
    SELECT c.level INTO class_level
      FROM equipping_lessons l JOIN equipping_classes c ON c.id = l.class_id
     WHERE l.id = NEW.lesson_id;
  ELSE
    SELECT c.level INTO class_level
      FROM equipping_enrollments e JOIN equipping_classes c ON c.id = e.class_id
     WHERE e.id = NEW.enrollment_id;
  END IF;
  IF class_level IS NULL OR class_level NOT LIKE 'SOL%' THEN
    RAISE EXCEPTION 'the quiz, the book and items brought late are SOL''s (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_quizzes_sol_only
  BEFORE INSERT ON equipping_quizzes
  FOR EACH ROW EXECUTE FUNCTION assert_sol_record();

CREATE TRIGGER equipping_quiz_tries_sol_only
  BEFORE INSERT ON equipping_quiz_tries
  FOR EACH ROW EXECUTE FUNCTION assert_sol_record();

CREATE TRIGGER equipping_books_sol_only
  BEFORE INSERT ON equipping_books
  FOR EACH ROW EXECUTE FUNCTION assert_sol_record();

CREATE TRIGGER equipping_items_brought_sol_only
  BEFORE INSERT ON equipping_items_brought
  FOR EACH ROW EXECUTE FUNCTION assert_sol_record();

CREATE FUNCTION assert_quiz_items_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.class_id <> OLD.class_id THEN
    RAISE EXCEPTION 'a quiz keeps its class (SKILL.md section 29)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.items <> OLD.items AND EXISTS (
       SELECT 1 FROM equipping_quiz_tries t
         JOIN equipping_enrollments e ON e.id = t.enrollment_id
        WHERE e.class_id = NEW.class_id) THEN
    RAISE EXCEPTION 'the quiz''s number of items stays put once a score is recorded (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_quizzes_items_kept
  BEFORE UPDATE ON equipping_quizzes
  FOR EACH ROW EXECUTE FUNCTION assert_quiz_items_kept();

CREATE TRIGGER equipping_quizzes_not_deleted
  BEFORE DELETE ON equipping_quizzes
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- The three record tables keep what they say: a row is only ever closed, and never deleted.
CREATE FUNCTION assert_closed_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a school record is closed, never deleted (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_at IS NOT NULL
     OR to_jsonb(NEW) - 'superseded_at' - 'superseded_by' <> to_jsonb(OLD) - 'superseded_at' - 'superseded_by' THEN
    RAISE EXCEPTION 'a school record keeps what it says; a correction is a new row (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_items_brought_closed_only
  BEFORE UPDATE OR DELETE ON equipping_items_brought
  FOR EACH ROW EXECUTE FUNCTION assert_closed_only();

CREATE TRIGGER equipping_quiz_tries_closed_only
  BEFORE UPDATE OR DELETE ON equipping_quiz_tries
  FOR EACH ROW EXECUTE FUNCTION assert_closed_only();

CREATE TRIGGER equipping_books_closed_only
  BEFORE UPDATE OR DELETE ON equipping_books
  FOR EACH ROW EXECUTE FUNCTION assert_closed_only();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_items_brought equipping_quizzes equipping_quiz_tries equipping_books

-- Refused while anything this step records exists, so nothing is lost by going back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM equipping_items_brought)
     OR EXISTS (SELECT 1 FROM equipping_quizzes)
     OR EXISTS (SELECT 1 FROM equipping_books)
     OR EXISTS (SELECT 1 FROM equipping_marks WHERE verse IS NOT NULL)
     OR EXISTS (SELECT 1 FROM equipping_make_ups WHERE verse IS NOT NULL)
     OR EXISTS (SELECT 1 FROM equipping_lessons WHERE lesson = 10 OR lesson = 5) THEN
    RAISE EXCEPTION 'SOL register records exist; reverting 0061 would lose them';
  END IF;
END;
$$;

DROP TRIGGER equipping_books_closed_only ON equipping_books;
DROP TRIGGER equipping_quiz_tries_closed_only ON equipping_quiz_tries;
DROP TRIGGER equipping_items_brought_closed_only ON equipping_items_brought;
DROP FUNCTION assert_closed_only();
DROP TRIGGER equipping_quizzes_not_deleted ON equipping_quizzes;
DROP TRIGGER equipping_quizzes_items_kept ON equipping_quizzes;
DROP FUNCTION assert_quiz_items_kept();
DROP TRIGGER equipping_items_brought_sol_only ON equipping_items_brought;
DROP TRIGGER equipping_books_sol_only ON equipping_books;
DROP TRIGGER equipping_quiz_tries_sol_only ON equipping_quiz_tries;
DROP TRIGGER equipping_quizzes_sol_only ON equipping_quizzes;
DROP FUNCTION assert_sol_record();
DROP TRIGGER equipping_quiz_tries_score_fits ON equipping_quiz_tries;
DROP FUNCTION assert_quiz_score_fits();
DROP TABLE equipping_books;
DROP TABLE equipping_quiz_tries;
DROP TABLE equipping_quizzes;
DROP TABLE equipping_items_brought;

DROP TRIGGER equipping_make_ups_items_fit_level ON equipping_make_ups;
DROP TRIGGER equipping_marks_items_fit_level ON equipping_marks;
DROP FUNCTION assert_items_fit_level();
ALTER TABLE equipping_make_ups DROP CONSTRAINT equipping_make_ups_items_together;
ALTER TABLE equipping_make_ups DROP COLUMN devotional;
ALTER TABLE equipping_make_ups DROP COLUMN verse;
ALTER TABLE equipping_marks DROP CONSTRAINT equipping_marks_items_together;
ALTER TABLE equipping_marks DROP COLUMN devotional;
ALTER TABLE equipping_marks DROP COLUMN verse;

DROP TRIGGER equipping_lessons_fit_level ON equipping_lessons;
DROP FUNCTION assert_lesson_fits_level();
ALTER TABLE equipping_lessons DROP CONSTRAINT equipping_lessons_lesson;
ALTER TABLE equipping_lessons
  ADD CONSTRAINT equipping_lessons_lesson CHECK (lesson BETWEEN 1 AND 9 AND lesson <> 5);
