-- migrate:up

-- ---------------------------------------------------------------------------
-- The Encounter's enrollment and attendance (SKILL.md section 29, decisions 0501 and 0507).
--
-- After lesson 4 the Registrar enrolls the cleared students of each Network's weekend, and
-- after the weekend records who came, which is the register's ENC column. Additive: two new
-- tables owned by `equipping`. Nothing existing is read or rewritten, and no effective date is
-- set.
--
-- **Nothing is deleted, and a correction keeps the value it corrects** (principle 12): who came
-- changed is closed, with who and when, and a new row opened, as a lesson's marks are.
-- ---------------------------------------------------------------------------

-- A student enrolled in one season's Encounter weekend, under the Life Class enrollment they
-- were cleared in. `network` names the weekend: the Men's for men, the Women's for women.
CREATE TABLE equipping_encounter_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES equipping_enrollments (id),
  person_id uuid NOT NULL REFERENCES persons (id),
  encounter_season_id uuid NOT NULL REFERENCES encounter_seasons (id),
  network network NOT NULL,
  enrolled_by uuid NOT NULL REFERENCES accounts (id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  -- One weekend a season for a person.
  CONSTRAINT equipping_encounter_enrollments_one_per_season UNIQUE (person_id, encounter_season_id)
);

CREATE INDEX equipping_encounter_enrollments_by_season
  ON equipping_encounter_enrollments (encounter_season_id, network);

-- Whether an enrolled student came. A correction closes the row and opens another.
CREATE TABLE equipping_encounter_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_enrollment_id uuid NOT NULL REFERENCES equipping_encounter_enrollments (id),
  came boolean NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES accounts (id),
  CONSTRAINT equipping_encounter_attendance_superseded_whole CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);

CREATE UNIQUE INDEX equipping_encounter_attendance_one_current
  ON equipping_encounter_attendance (encounter_enrollment_id)
  WHERE superseded_at IS NULL;

-- An Encounter enrollment names the person of the Life Class enrollment it rests on, and keeps
-- what it says once written.
CREATE FUNCTION assert_encounter_enrollment_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'an Encounter enrollment keeps what it says (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM equipping_enrollments e
         JOIN equipping_registrations r ON r.id = e.registration_id
        WHERE e.id = NEW.enrollment_id AND r.person_id = NEW.person_id AND r.level = 'LIFE_CLASS') THEN
    RAISE EXCEPTION 'an Encounter enrollment names the student of a Life Class enrollment (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_encounter_enrollments_kept
  BEFORE INSERT OR UPDATE ON equipping_encounter_enrollments
  FOR EACH ROW EXECUTE FUNCTION assert_encounter_enrollment_kept();

-- Who came keeps what it says; it is closed once and stays closed. A person attends one
-- Encounter: a second current *came* in another season is refused (decision 0501, point 14).
CREATE FUNCTION assert_encounter_attendance_kept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'superseded_at' - 'superseded_by' <> to_jsonb(OLD) - 'superseded_at' - 'superseded_by' THEN
      RAISE EXCEPTION 'who came keeps what it says; a correction is a new row (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'a corrected Encounter attendance stays corrected (SKILL.md section 29)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.superseded_at IS NULL AND NEW.came AND EXISTS (
       SELECT 1
         FROM equipping_encounter_attendance a
         JOIN equipping_encounter_enrollments other ON other.id = a.encounter_enrollment_id
         JOIN equipping_encounter_enrollments this ON this.id = NEW.encounter_enrollment_id
        WHERE other.person_id = this.person_id
          AND other.id <> this.id
          AND a.superseded_at IS NULL
          AND a.came) THEN
    RAISE EXCEPTION 'a person attends one Encounter (SKILL.md section 29)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER equipping_encounter_attendance_kept
  BEFORE INSERT OR UPDATE ON equipping_encounter_attendance
  FOR EACH ROW EXECUTE FUNCTION assert_encounter_attendance_kept();

-- Nothing is deleted from either (section 29).
CREATE FUNCTION refuse_equipping_encounter_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The Encounter''s enrollment and attendance are corrected, never deleted (SKILL.md section 29).'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER equipping_encounter_enrollments_no_delete BEFORE DELETE ON equipping_encounter_enrollments
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_encounter_delete();
CREATE TRIGGER equipping_encounter_attendance_no_delete BEFORE DELETE ON equipping_encounter_attendance
  FOR EACH ROW EXECUTE FUNCTION refuse_equipping_encounter_delete();

-- migrate:down
-- migrate:down:refuse-if-populated equipping_encounter_enrollments equipping_encounter_attendance

-- Refused once either holds a row: who went to the Encounter is the school's history.

DROP TRIGGER equipping_encounter_attendance_no_delete ON equipping_encounter_attendance;
DROP TRIGGER equipping_encounter_enrollments_no_delete ON equipping_encounter_enrollments;
DROP FUNCTION refuse_equipping_encounter_delete();
DROP TRIGGER equipping_encounter_attendance_kept ON equipping_encounter_attendance;
DROP FUNCTION assert_encounter_attendance_kept();
DROP TRIGGER equipping_encounter_enrollments_kept ON equipping_encounter_enrollments;
DROP FUNCTION assert_encounter_enrollment_kept();
DROP TABLE equipping_encounter_attendance;
DROP TABLE equipping_encounter_enrollments;
