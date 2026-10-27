-- migrate:up

-- ---------------------------------------------------------------------------
-- Archive reasons, and a reason on every new archive (SKILL.md section 3, decision 0397)
--
-- Five reasons are added beside `RECORD_CREATED_IN_ERROR` and `OTHER`, which stay.
-- `NO_LONGER_IN_CURRENT_NETWORK` stays in the type, because a Person archived with it keeps
-- it; the trigger below refuses it for a new archive. Additive only: no existing row
-- changes, and nothing here uses a new value, which PostgreSQL would refuse inside the
-- transaction that adds it.
-- ---------------------------------------------------------------------------

ALTER TYPE archive_reason ADD VALUE 'WORKING_AWAY';
ALTER TYPE archive_reason ADD VALUE 'STUDYING_AWAY';
ALTER TYPE archive_reason ADD VALUE 'MOVED_AWAY';
ALTER TYPE archive_reason ADD VALUE 'ATTENDS_ANOTHER_CHURCH';
ALTER TYPE archive_reason ADD VALUE 'PASSED_AWAY';

-- Every new archive gives a reason, and no retired one. Held on insert rather than as a
-- table CHECK, because a row written before this ruling may carry no reason, and a CHECK
-- would refuse it when it is closed by a restore.
CREATE FUNCTION person_lifecycle_archive_is_explained() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'ARCHIVED' THEN
    IF NEW.reason IS NULL THEN
      RAISE EXCEPTION
        'person %: every archive gives a reason (SKILL.md section 3, decision 0397).',
        NEW.person_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.reason = 'NO_LONGER_IN_CURRENT_NETWORK' THEN
      RAISE EXCEPTION
        'person %: NO_LONGER_IN_CURRENT_NETWORK is no longer given for a new archive '
        '(SKILL.md section 3, decision 0397).',
        NEW.person_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Any whitespace, not only spaces: `person_lifecycle_other_requires_note` uses `btrim`,
    -- which strips spaces alone, so a note of tabs or line breaks would pass it.
    IF NEW.reason = 'OTHER' AND coalesce(NEW.note, '') !~ '\S' THEN
      RAISE EXCEPTION
        'person %: OTHER carries a written comment (SKILL.md section 3, decision 0397).',
        NEW.person_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER person_lifecycle_archive_explained
  BEFORE INSERT ON person_lifecycle
  FOR EACH ROW EXECUTE FUNCTION person_lifecycle_archive_is_explained();

-- migrate:down

-- Reversible while nobody has been archived with a new reason: PostgreSQL cannot drop an
-- enum value, so the type is rebuilt with the three it had. Refused otherwise, because
-- rebuilding it would have nowhere to put those rows' reasons.

DROP TRIGGER person_lifecycle_archive_explained ON person_lifecycle;

DROP FUNCTION person_lifecycle_archive_is_explained();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM person_lifecycle
    WHERE reason::text IN (
      'WORKING_AWAY', 'STUDYING_AWAY', 'MOVED_AWAY', 'ATTENDS_ANOTHER_CHURCH', 'PASSED_AWAY'
    )
  ) THEN
    RAISE EXCEPTION
      'refusing to revert 0032: people have been archived with a reason it added, and the '
      'type it restores has no place for them.';
  END IF;
END;
$$;

-- The one CHECK comparing the column to a literal is dropped around the type change and
-- restored as 0001 wrote it; the literal cannot be compared across the two types.
ALTER TABLE person_lifecycle DROP CONSTRAINT person_lifecycle_other_requires_note;

ALTER TYPE archive_reason RENAME TO archive_reason_0032;

CREATE TYPE archive_reason AS ENUM (
  'NO_LONGER_IN_CURRENT_NETWORK',
  'RECORD_CREATED_IN_ERROR',
  'OTHER'
);

ALTER TABLE person_lifecycle
  ALTER COLUMN reason TYPE archive_reason
  USING reason::text::archive_reason;

DROP TYPE archive_reason_0032;

ALTER TABLE person_lifecycle
  ADD CONSTRAINT person_lifecycle_other_requires_note
    CHECK (reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(note, '')) <> '');
