-- Exactly one Network root per Network (SKILL.md section 5, Network roots).
--
-- Additive: one nullable column, one check, one partial unique index, one
-- constraint trigger. Nothing is dropped and no historical row is rewritten
-- (CLAUDE.md, Definition of Done -> Migration policy).
--
-- **Why it exists.** Section 5 says "Each Network has exactly one root leader",
-- and settled on 2026-08-23 that a root *is a row* -- an active assignment whose
-- `leader_id` is null. Nothing enforced the count. `pastoral_assignments` had no
-- constraint on null-leader rows at all, no test asserted a second root was
-- refused, and the application had no code that could have refused one: the only
-- writer of the table takes `leaderId: string | null` and inserts whatever it is
-- given. A third root, or a fourth, was a plain INSERT away, and every subtree
-- total walking through the tree would then have had two answers with nothing
-- raised.
--
-- **A column and a unique index, not a counting trigger**, which is the design
-- this repository already reached once and for reasons that hold here verbatim.
-- The `SENIOR_PASTOR` cap was first written as a deferred trigger counting active
-- rows; under READ COMMITTED neither of two concurrent transactions sees the
-- other's uncommitted row, both count zero, and both commit. It was replaced by
-- `account_roles.senior_pastor_slot` and a partial unique index (ruling of
-- 2026-08-21) for a second reason as well: `pg_restore --disable-triggers` skips
-- a constraint trigger and does not skip a unique index, so a restore could load
-- a third holder in silence, at exactly the moment nobody is watching.
--
-- Both reasons apply to a root. This is the same shape, and `root_network` is the
-- same kind of thing as a slot: a seat, occupied or free, ordering nothing.
--
-- **Re-derived rather than copied**, because reusing a shape without re-deriving
-- why it had that shape is SKILL.md section 25 rule 19. The `SENIOR_PASTOR` slot
-- works because the state it constrains lives entirely in one table. A root's
-- Network does *not*: it lives in `network_assignments`, effective-dated, so
-- putting it on the assignment row denormalizes it and a denormalized value can
-- drift from its source.
--
-- It cannot drift here, and that is what makes the shape safe rather than merely
-- convenient. Section 4 refuses a Network change while the person holds any open
-- assignment as leader, and a root leads their whole Network; section 4
-- separately refuses moving a root between Networks at all. A root's Network is
-- therefore immutable for as long as they are a root, and the trigger below
-- checks the column against `network_as_of` on every write so it cannot be set to
-- a lie in the first place.
--
-- **What it permits.** Zero roots in a Network, which is every moment before the
-- import runs and is the state a fresh database is in. "Exactly one" is not
-- expressible as a constraint without forbidding an empty database; the index
-- forbids the second, and the import refuses a file that does not carry both
-- (section 2, How the tree import runs).
--
-- **Validated against existing data before enforcing.** The backfill runs before
-- the check and the index, per the migration policy. A database that already
-- holds two open roots in one Network fails at index creation -- deliberately,
-- because that is the corruption this migration exists to make impossible, and
-- finding it is better than carrying it. Fix the data and run again.
--
-- **Reversible.** The down drops the trigger, the index, the check and the
-- column, which loses no history: `root_network` is derivable from
-- `network_as_of(person_id, started_at)` for exactly the rows that carry it.

-- migrate:up

ALTER TABLE pastoral_assignments
  ADD COLUMN root_network network;

-- Backfill before the check, so the check is added to data that already satisfies
-- it. Only null-leader rows carry a value, which is what the check will require.
UPDATE pastoral_assignments
   SET root_network = network_as_of(person_id, started_at)
 WHERE leader_id IS NULL;

-- A root row that could not be resolved to a Network is a row this schema has no
-- honest value for. Refuse rather than leave the column null and let the check
-- reject it with a message about a column nobody has heard of.
DO $$
DECLARE
  v_unresolved bigint;
BEGIN
  SELECT count(*) INTO v_unresolved
    FROM pastoral_assignments
   WHERE leader_id IS NULL AND root_network IS NULL;

  IF v_unresolved > 0 THEN
    RAISE EXCEPTION
      '% root assignment row(s) have no Network as of their started_at. '
      'Every person holding one needs a network_assignments row covering that '
      'instant before this migration can run.', v_unresolved
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- The backfill above is an UPDATE on `pastoral_assignments`, which queues the
-- deferred `pastoral_assignments_same_network` trigger for every row it touched;
-- PostgreSQL then refuses to ALTER a table with pending trigger events. Flushing
-- them here is safe rather than merely expedient: the rows updated are exactly the
-- null-leader rows, and that trigger returns immediately for those, because a root
-- has no leader to compare a Network against.
SET CONSTRAINTS ALL IMMEDIATE;

-- The column means "this row is the root seat for this Network", so it is present
-- on exactly the rows that are roots. Stating it as an equivalence rather than two
-- one-way checks is what stops the column being set on an ordinary edge, where it
-- would occupy a seat no root is using.
ALTER TABLE pastoral_assignments
  ADD CONSTRAINT pastoral_assignments_root_network_iff_root
    CHECK ((leader_id IS NULL) = (root_network IS NOT NULL));

-- Section 5: one root per Network. Partial over open rows, so a root who is
-- succeeded frees the seat exactly as a revoked `senior_pastor_slot` does, and so
-- the closed history keeps every root the Network has ever had.
CREATE UNIQUE INDEX pastoral_assignments_one_root_per_network
  ON pastoral_assignments (root_network)
  WHERE ended_at IS NULL AND root_network IS NOT NULL;

-- The index makes the seat unique; this makes the seat honest. Without it the
-- column is a client-supplied claim, and a root inserted with the other Network's
-- value would take the wrong seat and leave their own free -- passing the index,
-- which cannot read `network_assignments`.
--
-- DEFERRABLE INITIALLY DEFERRED to match `pastoral_assignments_same_network`
-- immediately above it: a root row and the `network_assignments` row it is
-- checked against are written in one transaction by the import, and an immediate
-- trigger would reject whichever landed first.
CREATE FUNCTION assert_root_network_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row pastoral_assignments%ROWTYPE;
  v_person network;
BEGIN
  -- Deferred, so read the row as it finally stands. A row inserted and then
  -- deleted in the same transaction has nothing left to validate.
  SELECT * INTO v_row FROM pastoral_assignments WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.root_network IS NULL THEN
    RETURN NULL;
  END IF;

  v_person := network_as_of(v_row.person_id, v_row.started_at);

  IF v_person IS NULL THEN
    RAISE EXCEPTION
      'root assignment %: Network is unknown for person % as of %',
      v_row.id, v_row.person_id, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_person <> v_row.root_network THEN
    RAISE EXCEPTION
      'root assignment % claims the % seat but person % is % as of %',
      v_row.id, v_row.root_network, v_row.person_id, v_person, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pastoral_assignments_root_network_honest
  AFTER INSERT OR UPDATE ON pastoral_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_root_network_matches();

-- migrate:down

DROP TRIGGER pastoral_assignments_root_network_honest ON pastoral_assignments;
DROP FUNCTION assert_root_network_matches();
DROP INDEX pastoral_assignments_one_root_per_network;
ALTER TABLE pastoral_assignments
  DROP CONSTRAINT pastoral_assignments_root_network_iff_root;
ALTER TABLE pastoral_assignments
  DROP COLUMN root_network;
