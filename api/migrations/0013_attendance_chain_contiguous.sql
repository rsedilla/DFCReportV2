-- migrate:up

-- ---------------------------------------------------------------------------
-- A superseded row's successor begins exactly where it ended (SKILL.md sections 9,
-- 13 and 14)
--
-- Migration 0012 ordered the two ends of **one** row's live period. This orders the
-- join between two: where a row names a `superseded_by`, that successor's
-- `recorded_at` is this row's `superseded_at`. Together they make an attendance
-- chain a partition of time rather than a set of overlapping intervals, which is what
-- section 9's "a correction never overwrites -- the prior row is marked superseded and
-- a new row written" means when read as history rather than as a live-row rule.
--
-- **This exists because the invariant shipped broken twice in two commits, and
-- nothing could fail on it either time.** First the successor's `recorded_at` fell to
-- the column default -- `now()`, the instant the transaction *began*, while the close
-- happened at `clock_timestamp()` during it -- so every correction overlapped by
-- however long the transaction had already run. Then the closing instant was carried
-- back through the application to fix that, and node-postgres renders `timestamptz`
-- as a JavaScript `Date`: microseconds truncated to milliseconds, so the successor
-- still began up to a millisecond early. Decision 0177 records both, and records that
-- the second survived review because the case written to catch it compared two values
-- the same driver had truncated identically.
--
-- The application is correct now. This is what makes it stay correct, and it is the
-- Definition of Done applied rather than quoted: an invariant expressible as a
-- database constraint exists as one. An earlier ruling declined on the ground that a
-- between-row check "would be a trigger" -- which is not a reason in this schema,
-- since it already carries constraint triggers for the same-Network edge and for the
-- no-delete rule on all five attendance tables.
--
-- **Deferred**, so the order of the `UPDATE` and the `INSERT` inside one correction
-- does not matter: the successor does not exist when the predecessor is closed, which
-- is the same reason `superseded_by` is a deferred foreign key (migration 0011). Both
-- are checked at COMMIT, which is where they are read.
--
-- **On the row carrying `superseded_by`, and only there.** Nothing updates a
-- `recorded_at` after it is written, so one trigger covers both orderings: written
-- predecessor-first it fires on the `UPDATE` that sets the pointer, and the deferral
-- carries it past the successor's insert.
--
-- `CLAUDE.md`, Migration policy: additive, reversible, and validated against existing
-- data before enforcing -- `ADD CONSTRAINT` is not used here, so the validation is the
-- explicit scan below, which aborts the migration if any chain already violates it.
-- Snapshot-and-reconcile is discharged as migration 0012 discharges it: nothing is
-- rewritten, and section 20's reconciliation test does not exist yet.
-- ---------------------------------------------------------------------------

-- Validated before enforcing. A trigger, unlike a CHECK, is not applied retroactively
-- by PostgreSQL -- so a deployment holding an overlapping chain would install this and
-- keep it, silently, which is the failure mode this whole migration is about.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending
    FROM dcc_attendance predecessor
    JOIN dcc_attendance successor ON successor.id = predecessor.superseded_by
   WHERE successor.recorded_at IS DISTINCT FROM predecessor.superseded_at;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'refusing to enforce chain contiguity: % dcc_attendance chain(s) already overlap or gap. '
      'Correct the data first (CLAUDE.md, Migration policy).', offending;
  END IF;

  SELECT count(*) INTO offending
    FROM cell_attendance predecessor
    JOIN cell_attendance successor ON successor.id = predecessor.superseded_by
   WHERE successor.recorded_at IS DISTINCT FROM predecessor.superseded_at;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'refusing to enforce chain contiguity: % cell_attendance chain(s) already overlap or gap. '
      'Correct the data first (CLAUDE.md, Migration policy).', offending;
  END IF;
END;
$$;

CREATE FUNCTION assert_attendance_chain_contiguous() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  successor_recorded_at timestamptz;
BEGIN
  IF NEW.superseded_by IS NULL THEN
    RETURN NULL;
  END IF;

  -- **A row naming itself is closed with no replacement, and is passed.**
  --
  -- Nothing replaces it, so there is no chain link to make contiguous. It is the only
  -- shape this schema can express for "close this record and put nothing in its place",
  -- because `..._supersession_is_whole` (migration 0011) requires `superseded_by`
  -- wherever `superseded_at` is set.
  --
  -- Section 13 needs exactly that shape: a RESCHEDULED meeting that ultimately does not
  -- take place "may be changed to NOT_HELD, preserving both records", and a NOT_HELD
  -- meeting carries no live attendance -- so the attendance must be closed with nothing
  -- replacing it. Whether the pair constraint should permit a null `superseded_by` for
  -- that case, rather than leaving a self-reference as the workaround, is recorded as
  -- open in `CLAUDE.md` and belongs to the slice that builds Cell recording.
  --
  -- Exempted here rather than silently failing, because refusing it would make that
  -- path unwritable while nothing had decided it should be.
  IF NEW.superseded_by = NEW.id THEN
    RETURN NULL;
  END IF;

  -- Branched in control flow rather than in an expression over `NEW`, for the reason
  -- `assert_no_attendance_when_not_held` records at length: PL/pgSQL resolves every
  -- field reference in a SQL expression whatever branch it would take, and the first
  -- version of that function failed on every insert because of it.
  IF TG_TABLE_NAME = 'dcc_attendance' THEN
    SELECT recorded_at INTO successor_recorded_at
      FROM dcc_attendance WHERE id = NEW.superseded_by;
  ELSE
    SELECT recorded_at INTO successor_recorded_at
      FROM cell_attendance WHERE id = NEW.superseded_by;
  END IF;

  -- The successor is guaranteed to exist by the deferred foreign key, which is checked
  -- at the same COMMIT. A null here would mean it does not, and that is that
  -- constraint's refusal to make rather than this one's.
  IF successor_recorded_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF successor_recorded_at <> NEW.superseded_at THEN
    RAISE EXCEPTION
      'an attendance record''s successor must begin where it ended (SKILL.md section 14): '
      'row % ended at %, its successor % began at %',
      NEW.id, NEW.superseded_at, NEW.superseded_by, successor_recorded_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER dcc_attendance_chain_contiguous
  AFTER INSERT OR UPDATE ON dcc_attendance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_attendance_chain_contiguous();

CREATE CONSTRAINT TRIGGER cell_attendance_chain_contiguous
  AFTER INSERT OR UPDATE ON cell_attendance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_attendance_chain_contiguous();

-- migrate:down

DROP TRIGGER cell_attendance_chain_contiguous ON cell_attendance;
DROP TRIGGER dcc_attendance_chain_contiguous ON dcc_attendance;
DROP FUNCTION assert_attendance_chain_contiguous();
