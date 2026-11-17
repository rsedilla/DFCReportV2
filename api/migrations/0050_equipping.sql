-- migrate:up

-- ---------------------------------------------------------------------------
-- Equipping: registration and enrollment for Life Class (SKILL.md section 29,
-- decision 0499).
--
-- Additive: three new tables owned by the `equipping` module, and three indexes on
-- `account_roles` that refuse nothing existing, since nobody holds EQUIPPER when
-- this runs. Nothing existing is read or rewritten.
--
-- No row of these tables is ever deleted (decision 0499, point 9): a registration
-- is cancelled with a reason and an enrollment is ended with one, so the history
-- of who was registered, enrolled, moved and withdrawn is kept. A trigger refuses
-- DELETE on all three, as `audit_log`'s does.
-- ---------------------------------------------------------------------------

-- An account holding EQUIPPER holds no other role (decision 0499, point 3), paired
-- with each of the others as migration 0046 pairs NETWORK_ADMIN.
CREATE UNIQUE INDEX account_roles_equipper_not_with_leader
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('EQUIPPER', 'LEADER');
CREATE UNIQUE INDEX account_roles_equipper_not_with_admin
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('EQUIPPER', 'ADMIN');
CREATE UNIQUE INDEX account_roles_equipper_not_with_senior_pastor
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('EQUIPPER', 'SENIOR_PASTOR');
CREATE UNIQUE INDEX account_roles_equipper_not_with_network_admin
  ON account_roles (account_id)
  WHERE revoked_at IS NULL AND role IN ('EQUIPPER', 'NETWORK_ADMIN');

-- A class of one level in one term (point 10). `level` is text with a CHECK rather
-- than an enum so that adding SOL 1 to 3 later replaces a constraint instead of
-- adding enum values in a migration of their own.
CREATE TABLE equipping_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS')),
  term_year smallint NOT NULL CONSTRAINT equipping_classes_term_year CHECK (term_year BETWEEN 2020 AND 2100),
  term_number smallint NOT NULL CONSTRAINT equipping_classes_term_number CHECK (term_number BETWEEN 1 AND 3),
  name text NOT NULL CONSTRAINT equipping_classes_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  -- ISO 8601: 1 is Monday, 7 is Sunday, as cell_schedules has it.
  day_of_week smallint NOT NULL CONSTRAINT equipping_classes_day CHECK (day_of_week BETWEEN 1 AND 7),
  time_of_day time NOT NULL,
  place text CONSTRAINT equipping_classes_place_not_blank CHECK (place IS NULL OR (btrim(place) <> '' AND char_length(place) <= 80)),
  first_lesson_on date NOT NULL,
  teacher_person_id uuid NOT NULL REFERENCES persons (id),
  encounter_season_id uuid NOT NULL REFERENCES encounter_seasons (id),
  -- Who runs the class (point 10). Only the church for now; a Primary later.
  run_by text NOT NULL DEFAULT 'CHURCH' CONSTRAINT equipping_classes_run_by CHECK (run_by IN ('CHURCH')),
  created_by uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX equipping_classes_one_name_per_term
  ON equipping_classes (level, term_year, term_number, lower(btrim(name)));

-- A person signed up for a level in a term (points 5 to 9).
CREATE TABLE equipping_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  level text NOT NULL CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS')),
  term_year smallint NOT NULL CONSTRAINT equipping_registrations_term_year CHECK (term_year BETWEEN 2020 AND 2100),
  term_number smallint NOT NULL CONSTRAINT equipping_registrations_term_number CHECK (term_number BETWEEN 1 AND 3),
  -- The three ticks, confirmed by `registered_by` at `registered_at` (point 6). Always
  -- true: a registration is refused without them, and a column that may only hold
  -- true still says on the row what was confirmed.
  devotion_confirmed boolean NOT NULL CONSTRAINT equipping_registrations_devotion CHECK (devotion_confirmed),
  bible_confirmed boolean NOT NULL CONSTRAINT equipping_registrations_bible CHECK (bible_confirmed),
  manual_confirmed boolean NOT NULL CONSTRAINT equipping_registrations_manual CHECK (manual_confirmed),
  -- The record requirements not met when the person was registered (point 7), and
  -- the reason they were registered anyway. One without the other is refused.
  unmet text[] NOT NULL DEFAULT '{}' CONSTRAINT equipping_registrations_unmet_known CHECK (
    unmet <@ ARRAY['HAS_LEADER', 'CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_FIVE']::text[]
  ),
  exception_reason text CONSTRAINT equipping_registrations_reason_not_blank CHECK (
    exception_reason IS NULL OR (btrim(exception_reason) <> '' AND char_length(exception_reason) <= 500)
  ),
  note text CONSTRAINT equipping_registrations_note_not_blank CHECK (
    note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 500)
  ),
  registered_by uuid NOT NULL REFERENCES accounts (id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES accounts (id),
  cancel_reason text,
  CONSTRAINT equipping_registrations_exception_has_reason CHECK (
    (cardinality(unmet) = 0) = (exception_reason IS NULL)
  ),
  CONSTRAINT equipping_registrations_cancel_whole CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL
        AND btrim(cancel_reason) <> '' AND char_length(cancel_reason) <= 500)
  )
);

-- One registration per person, level and term, a cancelled one aside (point 5).
CREATE UNIQUE INDEX equipping_registrations_one_per_term
  ON equipping_registrations (person_id, level, term_year, term_number)
  WHERE cancelled_at IS NULL;

CREATE INDEX equipping_registrations_by_term
  ON equipping_registrations (level, term_year, term_number);

-- A registration placed in a class (point 11). An enrollment that ends is kept,
-- with when and why: moved to another class, or withdrawn.
CREATE TABLE equipping_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES equipping_registrations (id),
  class_id uuid NOT NULL REFERENCES equipping_classes (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid NOT NULL REFERENCES accounts (id),
  ended_at timestamptz,
  ended_by uuid REFERENCES accounts (id),
  end_reason text CONSTRAINT equipping_enrollments_end_reason CHECK (end_reason IN ('MOVED', 'WITHDRAWN')),
  withdraw_note text,
  CONSTRAINT equipping_enrollments_end_whole CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL AND withdraw_note IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_reason IS NOT NULL
        AND (end_reason = 'WITHDRAWN') = (withdraw_note IS NOT NULL)
        AND (withdraw_note IS NULL OR (btrim(withdraw_note) <> '' AND char_length(withdraw_note) <= 500)))
  )
);

-- One open enrollment per registration, so one class per person, level and term.
CREATE UNIQUE INDEX equipping_enrollments_one_open
  ON equipping_enrollments (registration_id)
  WHERE ended_at IS NULL;

CREATE INDEX equipping_enrollments_by_class ON equipping_enrollments (class_id);

-- A registration is enrolled only in a class of its own level and term.
CREATE FUNCTION assert_enrollment_matches_class() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM equipping_registrations r
      JOIN equipping_classes c ON c.id = NEW.class_id
     WHERE r.id = NEW.registration_id
       AND r.level = c.level
       AND r.term_year = c.term_year
       AND r.term_number = c.term_number
  ) THEN
    RAISE EXCEPTION 'an enrollment must place a registration in a class of its own level and term (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_enrollments_match_class
  BEFORE INSERT OR UPDATE OF registration_id, class_id ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION assert_enrollment_matches_class();

-- Nothing is ever deleted (point 9).
CREATE FUNCTION refuse_delete_from_equipping() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% keeps its history: a row is cancelled or ended, never deleted (SKILL.md section 29)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER equipping_classes_never_deleted
  BEFORE DELETE ON equipping_classes
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_from_equipping();
CREATE TRIGGER equipping_registrations_never_deleted
  BEFORE DELETE ON equipping_registrations
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_from_equipping();
CREATE TRIGGER equipping_enrollments_never_deleted
  BEFORE DELETE ON equipping_enrollments
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_from_equipping();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_classes equipping_registrations equipping_enrollments

-- Refused once any of the three holds a row: a term held, a registration and an
-- enrollment are each the school's history (decision 0499).
-- On a database where nobody is, it removes the tables cleanly.

DROP TRIGGER equipping_enrollments_never_deleted ON equipping_enrollments;
DROP TRIGGER equipping_registrations_never_deleted ON equipping_registrations;
DROP TRIGGER equipping_classes_never_deleted ON equipping_classes;
DROP FUNCTION refuse_delete_from_equipping();
DROP TRIGGER equipping_enrollments_match_class ON equipping_enrollments;
DROP FUNCTION assert_enrollment_matches_class();
DROP TABLE equipping_enrollments;
DROP TABLE equipping_registrations;
DROP TABLE equipping_classes;
DROP INDEX account_roles_equipper_not_with_network_admin;
DROP INDEX account_roles_equipper_not_with_senior_pastor;
DROP INDEX account_roles_equipper_not_with_admin;
DROP INDEX account_roles_equipper_not_with_leader;
