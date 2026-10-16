-- migrate:up

-- ---------------------------------------------------------------------------
-- Closure reasons and the explanation every closure carries (SKILL.md section 10,
-- decision 0355)
--
-- Four reasons are added. `MEMBERS_DISPERSED` stays in the type, because Cells already
-- closed with it keep it; the trigger below refuses it for a new closure. Additive only:
-- no existing row changes, and nothing here uses a new value, which PostgreSQL would
-- refuse inside the transaction that adds it.
-- ---------------------------------------------------------------------------

ALTER TYPE cell_closure_reason ADD VALUE 'LEADER_MOVED_AWAY';
ALTER TYPE cell_closure_reason ADD VALUE 'LEADER_LEFT_THE_CHURCH';
ALTER TYPE cell_closure_reason ADD VALUE 'LEADER_PASSED_AWAY';
ALTER TYPE cell_closure_reason ADD VALUE 'MEMBERS_STOPPED_ATTENDING';

-- Every closure carries an explanation, and gives no retired reason. Held on the
-- ACTIVE -> CLOSED transition rather than as a table CHECK, because a Cell closed before
-- this ruling may have no note, and a CHECK would refuse it on any later update.
-- `cells_record_is_final` already refuses every change to a closed Cell's closure.
CREATE FUNCTION cells_closure_is_explained() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'ACTIVE' AND NEW.state = 'CLOSED' THEN
    -- Any whitespace, not only spaces: `btrim` with one argument strips spaces alone, so a
    -- note of tabs or line breaks would pass it.
    IF coalesce(NEW.closure_note, '') !~ '\S' THEN
      RAISE EXCEPTION
        'cell %: every closure carries a written explanation (SKILL.md section 10, '
        'decision 0355).',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.closure_reason = 'MEMBERS_DISPERSED' THEN
      RAISE EXCEPTION
        'cell %: MEMBERS_DISPERSED is no longer given for a new closure (SKILL.md '
        'section 10, decision 0355).',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cells_closure_explained
  BEFORE UPDATE ON cells
  FOR EACH ROW EXECUTE FUNCTION cells_closure_is_explained();

-- migrate:down

-- Reversible while no Cell has been closed with a new reason: PostgreSQL cannot drop an
-- enum value, so the type is rebuilt with the five it had. Refused otherwise, because
-- rebuilding it would have nowhere to put those rows' reasons.

DROP TRIGGER cells_closure_explained ON cells;

DROP FUNCTION cells_closure_is_explained();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cells
    WHERE closure_reason::text IN (
      'LEADER_MOVED_AWAY', 'LEADER_LEFT_THE_CHURCH', 'LEADER_PASSED_AWAY',
      'MEMBERS_STOPPED_ATTENDING'
    )
  ) THEN
    RAISE EXCEPTION
      'refusing to revert 0028: Cells have been closed with a reason it added, and the '
      'type it restores has no place for them.';
  END IF;
END;
$$;

-- The one CHECK comparing the column to a literal is dropped around the type change and
-- restored as 0009 wrote it; the literal cannot be compared across the two types.
ALTER TABLE cells DROP CONSTRAINT cells_other_requires_note;

ALTER TYPE cell_closure_reason RENAME TO cell_closure_reason_0028;

CREATE TYPE cell_closure_reason AS ENUM (
  'MERGED_INTO_ANOTHER_CELL',
  'LEADER_STEPPED_DOWN',
  'MEMBERS_DISPERSED',
  'CREATED_IN_ERROR',
  'OTHER'
);

ALTER TABLE cells
  ALTER COLUMN closure_reason TYPE cell_closure_reason
  USING closure_reason::text::cell_closure_reason;

DROP TYPE cell_closure_reason_0028;

ALTER TABLE cells
  ADD CONSTRAINT cells_other_requires_note
    CHECK (closure_reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(closure_note, '')) <> '');
