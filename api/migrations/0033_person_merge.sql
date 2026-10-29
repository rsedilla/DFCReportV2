-- migrate:up

-- ---------------------------------------------------------------------------
-- Person Merge (SKILL.md section 3, decision 0408)
--
-- `persons.merged_into_id` has existed since 0001 and nothing wrote it. A merge now sets it
-- on the absorbed record, with when, by whom and why beside it, which is what the absorbed
-- record's page says afterwards (decision 0408, point 13). Additive only: three nullable
-- columns, every existing row null in all four, which the CHECK below accepts.
-- ---------------------------------------------------------------------------

ALTER TABLE persons
  ADD COLUMN merged_at timestamptz,
  ADD COLUMN merged_by uuid REFERENCES accounts (id),
  ADD COLUMN merge_reason text;

-- A merge carries its time and its reason, or none of the three is set: a merge with no
-- time or no reason is one nobody can explain, and section 3 requires an explicit reason.
-- `merged_by` is the Admin wherever the application merges; it may be null so that a merge
-- written outside the application is still refused only for what it cannot explain, the
-- audit log naming the actor for every merge the application makes. `~ '\S'` rather than
-- `btrim`, which strips spaces alone (0018's note on the same choice).
ALTER TABLE persons
  ADD CONSTRAINT persons_merge_is_whole CHECK (
    (merged_into_id IS NULL AND merged_at IS NULL AND merged_by IS NULL AND merge_reason IS NULL)
    OR (
      merged_into_id IS NOT NULL
      AND merged_at IS NOT NULL
      AND merge_reason IS NOT NULL
      AND merge_reason ~ '\S'
    )
  );

-- A merge is irreversible and never chains (section 3): once set, `merged_into_id` does not
-- change; the survivor has never been merged away; and the absorbed record has absorbed
-- nobody, so every absorbed record is one step from its survivor. The service locks both
-- records first, which is what serializes two merges sharing a record; this refuses a write
-- that would break the shape whatever wrote it.
CREATE FUNCTION persons_merge_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.merged_into_id IS NOT NULL
     AND NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id THEN
    RAISE EXCEPTION
      'person %: a merge is never undone or moved (SKILL.md section 3).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM persons WHERE id = NEW.merged_into_id AND merged_into_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'person %: the record kept has itself been merged away (SKILL.md section 3).', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (SELECT 1 FROM persons WHERE merged_into_id = OLD.id) THEN
      RAISE EXCEPTION
        'person %: a record that has absorbed another is not merged away (decision 0408).',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER persons_merge_final
  BEFORE UPDATE OF merged_into_id ON persons
  FOR EACH ROW EXECUTE FUNCTION persons_merge_is_final();

-- migrate:down

-- Refused once any merge exists: dropping these columns would erase who merged a record
-- and why, which the audit log holds too but the absorbed page reads from here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM persons WHERE merged_into_id IS NOT NULL) THEN
    RAISE EXCEPTION 'persons holds merges; 0033 is not reverted over them.';
  END IF;
END;
$$;

DROP TRIGGER persons_merge_final ON persons;
DROP FUNCTION persons_merge_is_final();
ALTER TABLE persons DROP CONSTRAINT persons_merge_is_whole;
ALTER TABLE persons
  DROP COLUMN merge_reason,
  DROP COLUMN merged_by,
  DROP COLUMN merged_at;
