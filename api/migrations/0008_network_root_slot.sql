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
-- **The first version of this migration argued that it cannot drift, and was
-- wrong.** The argument was that section 4 refuses a Network change for a root,
-- and refuses one for anybody holding open assignments as leader. Both are true
-- of the *application* and neither was true of the database: the same-Network
-- trigger filters `pa.leader_id IS NOT NULL`, so a root's own row is by design
-- never examined on a Network write, and `assert_root_network_matches` below
-- compares against `network_as_of(person_id, started_at)` -- frozen history,
-- which cannot see a later change however often it fires.
--
-- Probed against this schema, a Network change on an open root committed happily
-- and left the seat naming the Network the person had left. One Network is then
-- effectively rootless and the other free to take a second root, which is the
-- outcome section 4 exists to prevent, reached with no pastoral reassignment.
--
-- Recorded rather than quietly corrected, because it is the exact failure this
-- file's own header claims to have avoided: a rule written by reasoning from a
-- mechanism's purpose instead of reading its WHERE clause (SKILL.md section 25
-- rule 19), committed in the change asserting it had re-derived everything.
--
-- So the drift is closed where this migration says such things belong.
-- `assert_network_not_changed_for_root` refuses a write to `network_assignments`
-- while the person holds an open root row -- section 4's existing rule, "a
-- Network change is refused for a root", expressed as a constraint rather than as
-- a TypeScript refusal. The two checks then cover the two directions: that one
-- stops the person's Network moving out from under the seat, and
-- `assert_root_network_matches` stops the seat being written to a value that
-- disagreed with the person in the first place.
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
-- **Reversible.** The down drops both triggers, the index, the check and the
-- column, which loses no history: `root_network` is derivable from
-- `network_as_of(person_id, started_at)` for exactly the rows that carry it --
-- and that derivation is sound precisely because the second trigger refuses the
-- Network change that would have made the stored value and the derived one
-- disagree.

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
-- deferred `pastoral_assignments_same_network` trigger for every row it touched.
-- PostgreSQL then refuses both statements that follow: an ALTER TABLE and a
-- CREATE INDEX are each rejected while a table has pending trigger events, with
-- different messages. This flush is therefore load-bearing twice, not once.
--
-- Named rather than ALL, because SET CONSTRAINTS does not only flush -- it
-- switches the mode for the remainder of the transaction, and ALL would silently
-- include the constraint trigger created further down this file. Flushing this
-- one is safe: the rows updated are exactly the null-leader rows, and that
-- trigger returns immediately for those, because a root has no leader to compare
-- a Network against.
SET CONSTRAINTS pastoral_assignments_same_network IMMEDIATE;

-- The column means "this row is the root seat for this Network", so it is present
-- on exactly the rows that are roots. Stating it as an equivalence rather than two
-- one-way checks is what stops the column being set on an ordinary edge, where it
-- would occupy a seat no root is using.
ALTER TABLE pastoral_assignments
  ADD CONSTRAINT pastoral_assignments_root_network_iff_root
    CHECK ((leader_id IS NULL) = (root_network IS NOT NULL));

-- The same courtesy as the block above, for the neighbouring condition. The
-- migration policy names this case exactly -- "adding the partial unique index to
-- a table that already holds two active assignments for one person aborts
-- mid-deploy. Find and fix the data first" -- and leaving it to the index aborts
-- with a bare duplicate-key message naming an index nobody has heard of.
DO $CHK$
DECLARE
  v_duplicated text;
BEGIN
  SELECT string_agg(root_network::text, ', ') INTO v_duplicated
    FROM (
      SELECT root_network
        FROM pastoral_assignments
       WHERE ended_at IS NULL AND root_network IS NOT NULL
       GROUP BY root_network
      HAVING count(*) > 1
    ) AS duplicated;

  IF v_duplicated IS NOT NULL THEN
    RAISE EXCEPTION
      'more than one open root already exists in: %. Section 5 gives each Network '
      'exactly one root; close the rows that are not current before running this.',
      v_duplicated
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$CHK$;

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
-- **Immediate, not deferred**, and the first version of this file gave a reason
-- for deferring it that does not survive reading the caller. It said a root row
-- and the `network_assignments` row it is checked against "are written in one
-- transaction, and an immediate trigger would reject whichever landed first" --
-- but the only writer is `PeopleService.create`, where the network row is always
-- written first, so there is no ordering for an immediate check to trip over.
-- That reason belongs to `pastoral_assignments_same_network`, which is deferred
-- because section 4's Network change and the reassignment it forces write both
-- directions in one atomic operation. Borrowing it for a check that reads only
-- the subject's own Network is section 25 rule 19 over again.
--
-- Firing immediately is also better here: deferred, a violation surfaces at
-- COMMIT as a raw check_violation, which this repository has repeatedly recorded
-- as the 500-instead-of-an-answer failure.
CREATE FUNCTION assert_root_network_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row pastoral_assignments%ROWTYPE;
  v_person network;
BEGIN
  -- Re-read rather than trusting NEW, so this stays correct if it is ever
  -- deferred. 0001's equivalent explains its not-found branch as a row deleted in
  -- the same transaction; that branch is unreachable there and here, because
  -- `pastoral_assignments_no_delete` refuses every DELETE on this table
  -- (section 5). Kept as a cheap guard, without copying a justification that does
  -- not hold.
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
  FOR EACH ROW EXECUTE FUNCTION assert_root_network_matches();

-- The other direction: section 4 refuses a Network change for a root, and until
-- now that refusal existed only in TypeScript. Without this, the person's Network
-- moves and the seat keeps naming the one they left -- see the header above, where
-- the claim that this could not happen is recorded as the mistake it was.
--
-- It fires only while an open root row exists, so it never touches the ordinary
-- case: a Person's first Network assignment is written before their assignment
-- row, and every non-root Person has a leader.
--
-- Deferred, matching `network_assignments_keep_edges_same_network` on this same
-- table, because a Network change writes a close and an open that are one
-- operation.
CREATE FUNCTION assert_network_not_changed_for_root() RETURNS trigger
LANGUAGE plpgsql AS $FN$
DECLARE
  v_root network;
BEGIN
  SELECT pa.root_network INTO v_root
    FROM pastoral_assignments pa
   WHERE pa.person_id = NEW.person_id
     AND pa.ended_at IS NULL
     AND pa.root_network IS NOT NULL
   LIMIT 1;

  IF v_root IS NULL THEN
    RETURN NULL;
  END IF;

  IF network_as_of(NEW.person_id, NEW.started_at) IS DISTINCT FROM v_root THEN
    RAISE EXCEPTION
      'person % holds the % root seat, so their Network cannot be changed '
      '(section 5, Network roots). Changing who holds a root is a Network-level '
      'decision, not a data correction.',
      NEW.person_id, v_root
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$FN$;

CREATE CONSTRAINT TRIGGER network_assignments_not_changed_for_root
  AFTER INSERT OR UPDATE ON network_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_network_not_changed_for_root();

-- migrate:down

DROP TRIGGER network_assignments_not_changed_for_root ON network_assignments;
DROP FUNCTION assert_network_not_changed_for_root();
DROP TRIGGER pastoral_assignments_root_network_honest ON pastoral_assignments;
DROP FUNCTION assert_root_network_matches();
DROP INDEX pastoral_assignments_one_root_per_network;
ALTER TABLE pastoral_assignments
  DROP CONSTRAINT pastoral_assignments_root_network_iff_root;
ALTER TABLE pastoral_assignments
  DROP COLUMN root_network;
