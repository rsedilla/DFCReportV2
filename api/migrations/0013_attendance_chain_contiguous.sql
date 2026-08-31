-- migrate:up

-- ---------------------------------------------------------------------------
-- A superseded row's successor begins exactly where it ended (SKILL.md sections 9,
-- 13 and 14)
--
-- Migration 0012 ordered the two ends of **one** row's live period. This orders the
-- join between two: where a row names a `superseded_by`, that successor's
-- `recorded_at` is this row's `superseded_at`. That is what section 9's "a correction
-- never overwrites -- the prior row is marked superseded and a new row written" means
-- when read as history rather than as a live-row rule.
--
-- **Contiguity alone does not make a chain a partition of time, and an earlier
-- version of this sentence said it did.** Two predecessors superseded onto one
-- successor, each ending where it begins, satisfies the trigger and still overlaps:
-- the structure would be a DAG rather than a chain. The partial unique index below is
-- what forbids that, so the claim is carried by something rather than asserted beside
-- it.
--
-- One residual is disclosed rather than enforced: nothing requires a successor to
-- concern the same event and person as the row it replaces. It is unreachable -- the
-- service mints a fresh successor per correction and writes both from one line -- and
-- it is named so the next reader knows this file constrains the shape of a chain and
-- not its subject.
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
-- since it already carries constraint triggers for the same-Network edge and for
-- refusing attendance against a NOT_HELD meeting (migration 0011). The no-delete rule
-- uses plain `BEFORE DELETE` triggers rather than constraint triggers, which an earlier
-- version of this sentence enumerated with them; five tables is right and the kind was
-- not.
--
-- **Deferred**, so the order of the `UPDATE` and the `INSERT` inside one correction
-- does not matter: the successor does not exist when the predecessor is closed, which
-- is the same reason `superseded_by` is a deferred foreign key (migration 0011). Both
-- are checked at COMMIT, which is where they are read.
--
-- **On the row carrying `superseded_by`, and only there.** That covers both orderings
-- of a correction: written predecessor-first it fires on the `UPDATE` that sets the
-- pointer, and the deferral carries it past the successor's insert; written
-- successor-first it fires on the `INSERT` that carries one.
--
-- **What it does not cover is a later `UPDATE` of the successor's own `recorded_at`**,
-- which would leave the chain overlapping with nothing refusing it -- the trigger is on
-- the other row and does not re-fire. An earlier version of this comment said "nothing
-- updates a `recorded_at` after it is written", which is a fact about this
-- application's callers stated as a property of the schema. No column of either table
-- is immutable at the schema level, so this is the residual the whole append-only
-- design already carries, alongside the `TRUNCATE` question `CLAUDE.md` records against
-- the least-privilege role that does not exist yet.
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
--
-- **The scan carries the trigger's own exemption, and the first version did not.** A
-- self-referenced row joins to itself, and `recorded_at <> superseded_at` on any close
-- that is not zero-length -- which is every real one -- so the scan counted as
-- offending exactly the shape section 13 requires and the trigger blesses. The
-- migration was then not reversible: `down` succeeded and `up` refused over data the
-- schema declares legal, and its message directed a history rewrite of correct rows.
-- Harmless while both tables are empty and live from the first RESCHEDULED-to-NOT_HELD
-- transition, which is the one path the exemption exists for.
--
-- A validation that measures a stricter rule than the one being installed is not a
-- validation of it.
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
   WHERE predecessor.id IS DISTINCT FROM successor.id
     AND successor.recorded_at IS DISTINCT FROM predecessor.superseded_at;

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
  --
  -- **On `cell_attendance` only, and the first version of this exemption was on
  -- both.** Section 9 says `NOT_HELD` "has no DCC equivalent", so no DCC operation
  -- closes a record with nothing replacing it -- and section 9 leans on that: its
  -- argument that a version sent for a person with no record is unreachable rests on
  -- a live row existing once one ever has. Exempting DCC would have made that false
  -- and left the section resting on nobody writing the row. The exemption follows the
  -- requirement, and the requirement is a Cell one.
  IF TG_TABLE_NAME = 'cell_attendance' AND NEW.superseded_by = NEW.id THEN
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

-- One successor replaces one row. Without this, contiguity holds pairwise while two
-- predecessors point at the same successor and overlap each other -- which is the
-- difference between a chain and a DAG, and the reason the header above could not
-- honestly claim a partition of time until this existed.
--
-- Partial, because `superseded_by` is null on every live row and those are the
-- majority. `CREATE UNIQUE INDEX` validates against existing data as it builds, so
-- the scan above needs no third query.
CREATE UNIQUE INDEX dcc_attendance_one_successor
  ON dcc_attendance (superseded_by)
  WHERE superseded_by IS NOT NULL;

CREATE UNIQUE INDEX cell_attendance_one_successor
  ON cell_attendance (superseded_by)
  WHERE superseded_by IS NOT NULL;

CREATE CONSTRAINT TRIGGER dcc_attendance_chain_contiguous
  AFTER INSERT OR UPDATE ON dcc_attendance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_attendance_chain_contiguous();

CREATE CONSTRAINT TRIGGER cell_attendance_chain_contiguous
  AFTER INSERT OR UPDATE ON cell_attendance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_attendance_chain_contiguous();

-- migrate:down

DROP INDEX cell_attendance_one_successor;
DROP INDEX dcc_attendance_one_successor;

DROP TRIGGER cell_attendance_chain_contiguous ON cell_attendance;
DROP TRIGGER dcc_attendance_chain_contiguous ON dcc_attendance;
DROP FUNCTION assert_attendance_chain_contiguous();
