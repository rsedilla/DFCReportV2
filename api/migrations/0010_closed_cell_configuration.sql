-- ---------------------------------------------------------------------------
-- A CLOSED Cell's category and schedule rows stop when the Cell does
-- (SKILL.md section 10, What closing does).
--
-- **This settles the question migration 0009 recorded and deliberately did not
-- answer.** That file constrained the ACTIVE side only -- an ACTIVE Cell holds one
-- open category row and one open schedule row -- and left a comment saying the
-- CLOSED half was undecided, because section 10's closure list carried three writes
-- while two other passages in the same section assumed five. Section 10 now lists
-- five, and this is the constraint the last two earn.
--
-- The schedule half is forced rather than chosen. A schedule row left open on a
-- closed Cell keeps deriving one scheduled meeting a week for ever, so section 12
-- hands a Cell that no longer meets a coverage denominator and the figure gets worse
-- every month. The category half has no such consequence and is constrained for
-- consistency: the two rows open together at approval, an ACTIVE Cell must hold one
-- of each, and ending one of a pair needs a reason that does not exist.
--
-- ---------------------------------------------------------------------------
-- **The rule is "in force at or after the closure", not "ends after it"**, and the
-- difference is what makes a Cell closable at all.
--
-- Section 10 states the neighbouring rule for leadership and membership rows as "no
-- row of a closed Cell may end after the Cell did", which 0009 enforces literally.
-- Reused verbatim here it is unsatisfiable, and section 25 rule 19 is exactly the
-- warning against reusing it that way: the reason that rule has that shape is that a
-- leadership or membership row can always be ended at the closure instant, and a
-- schedule row cannot.
--
-- A schedule change takes effect at the start of the following month (section 10),
-- so a Cell with a change pending holds two rows carrying **future** timestamps: an
-- outgoing row ending on the 1st, and an incoming row starting on the 1st and still
-- open. A closure on the 15th of this month cannot end the incoming row at the
-- closure instant, because `cell_schedules_period_ordered` refuses a period ending
-- before it starts. Under the literal rule that Cell is closable by nobody -- not by
-- its leader, not by Admin -- because a forward-dated closure is not an operation
-- this specification defines. Two of the three withdrawn formulations of the
-- effective-date floor died on precisely this.
--
-- What the closure does instead is end each such row at `GREATEST(closure, its own
-- started_at)`. For a row already running that is the closure instant. For a row
-- that had not started yet that is its own start, which makes it **zero-length**:
-- inert to every as-of query, because section 5's `network_as_of` shape asks for
-- `started_at <= t AND ended_at > t` and no instant satisfies both. The 2026-08-22
-- ruling settled that shape -- a row entered in error is corrected by closing it and
-- opening the right one -- and a schedule change that will now never take effect is
-- the same kind of fact.
--
-- So the predicate below forbids a row whose period **intersects** the half-line
-- from the closure onwards, which is `ended_at IS NULL OR ended_at > GREATEST(
-- started_at, closed_at)`. Worked through:
--
--   open row, any start                        -> forbidden (in force for ever)
--   started 10 Aug, ends 15 Aug, closed 15 Aug -> allowed   (stops at the closure)
--   started 10 Aug, ends 20 Aug, closed 15 Aug -> forbidden (five days too many)
--   started  1 Sep, ends  1 Sep, closed 15 Aug -> allowed   (zero-length, inert)
--
-- The fourth line is the one the literal rule refuses and this one admits, and it is
-- the whole reason the wording differs. Every other line agrees with it.
--
-- ---------------------------------------------------------------------------
-- **Deferred, and for its own reason rather than by imitation.** A closure writes
-- the `cells` row and the configuration rows in one transaction, and section 10
-- fixes no order between them; an immediate trigger would refuse whichever landed
-- first. That is the same reason `cells_relationships_match_state` is deferred and
-- **not** the reason `cell_schedules_start_is_legal` is immediate -- that one reads
-- `cells.created_at`, which is always written first and is immutable afterwards, so
-- it has no ordering to be rescued from.
--
-- The cost of deferring is the one this repository keeps recording: a violation
-- arrives at COMMIT as a raw `check_violation`, which renders `INTERNAL_ERROR`. The
-- closure service therefore performs the write that satisfies this rather than
-- relying on the constraint to describe it, exactly as the membership service does
-- for the same-Network rule. The constraint is the enforcement; the service owes the
-- answer.
--
-- **It fires from three tables, because the state it constrains lives in two.**
-- From `cells`, so closing a Cell is checked against the configuration rows it left
-- behind; and from each configuration table, so a row cannot be opened or extended
-- into a Cell that is already closed. 0009's state triggers are built the same way
-- and for the same reason.
--
-- **Existing data is checked rather than assumed clean.** A constraint trigger, unlike
-- a `CHECK` added by `ALTER TABLE`, validates nothing already in the table -- so a
-- violating row would not abort the deploy, it would sit there until some later write
-- to that Cell fired the trigger and failed for a reason nothing had recorded. The
-- migration policy's "validate constraints against existing data before enforcing
-- them" is about the first failure mode and this is the second, which is quieter. The
-- block below therefore refuses the migration rather than letting it succeed over data
-- it does not describe. It is expected to find nothing: no endpoint closes a Cell until
-- the one this migration arrives with, so `cells` holds no CLOSED row anywhere.
-- ---------------------------------------------------------------------------

-- migrate:up

DO $$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
    FROM cells c
   WHERE c.state = 'CLOSED'
     AND (
       EXISTS (
         SELECT 1 FROM cell_categories cc
          WHERE cc.cell_id = c.id
            AND (cc.ended_at IS NULL OR cc.ended_at > GREATEST(cc.started_at, c.closed_at))
       )
       OR EXISTS (
         SELECT 1 FROM cell_schedules cs
          WHERE cs.cell_id = c.id
            AND (cs.ended_at IS NULL OR cs.ended_at > GREATEST(cs.started_at, c.closed_at))
       )
     );

  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      '% closed cell(s) hold a category or schedule row still in force at or after '
      'their closure. Fix the data before applying this migration: a constraint '
      'trigger validates nothing already present, so these rows would survive and '
      'fail at whatever writes them next.',
      v_bad;
  END IF;
END;
$$;

CREATE FUNCTION assert_cell_configuration_matches_state(p_cell_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_state cell_state;
  v_closed_at timestamptz;
  v_offender text;
BEGIN
  -- **`FOR SHARE`, on the same reasoning as `assert_cell_memberships_match_state`
  -- and re-derived rather than carried across.** That function needed it because
  -- `cell_memberships_one_open` is over `person_id`, so closing a Cell and adding a
  -- member to it touch no row in common and neither deferred check sees the other's
  -- uncommitted work. The same is true here for a different reason:
  -- `cell_schedules_one_open` is over `cell_id`, so two writers to *this* Cell's
  -- schedule do serialize on it -- but a closure and a configuration change write
  -- different tables, and under READ COMMITTED the closer would count no open
  -- schedule row while the changer read the Cell as still ACTIVE, and both would
  -- commit. That leaves an open schedule row on a CLOSED Cell, which is the exact
  -- state this rule exists to forbid.
  --
  -- It costs nothing in practice, because `CellsConfigurationService` already takes
  -- this row `FOR UPDATE` before it reads anything, and the closure takes it
  -- `FOR NO KEY UPDATE`. Both conflict with this share lock, so by the time either
  -- reaches commit the other has finished. What the lock adds is that the rule holds
  -- for a writer that has not read that docblock.
  SELECT c.state, c.closed_at INTO v_state, v_closed_at
    FROM cells c WHERE c.id = p_cell_id FOR SHARE;

  IF NOT FOUND OR v_state <> 'CLOSED' THEN
    RETURN;
  END IF;

  SELECT cc.id::text INTO v_offender
    FROM cell_categories cc
   WHERE cc.cell_id = p_cell_id
     AND (cc.ended_at IS NULL OR cc.ended_at > GREATEST(cc.started_at, v_closed_at))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'cell % is CLOSED and holds category row %, which is still in force at or '
      'after the closure (SKILL.md section 10, What closing does). Closing a Cell '
      'ends its open category row on the closure effective date.',
      p_cell_id, v_offender
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT cs.id::text INTO v_offender
    FROM cell_schedules cs
   WHERE cs.cell_id = p_cell_id
     AND (cs.ended_at IS NULL OR cs.ended_at > GREATEST(cs.started_at, v_closed_at))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'cell % is CLOSED and holds schedule row %, which is still in force at or '
      'after the closure (SKILL.md section 10, What closing does). A schedule row '
      'left in force on a closed Cell keeps deriving one scheduled meeting a week, '
      'so the Cell acquires a coverage denominator it can never meet (section 12).',
      p_cell_id, v_offender
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION assert_configuration_state_from_cells() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_cell_configuration_matches_state(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_configuration_state_from_configuration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_cell_configuration_matches_state(NEW.cell_id);

  -- A configuration row moved between Cells leaves the Cell it came from as much a
  -- subject of this rule as the one it went to. No operation in section 10 moves
  -- one; 0009's equivalents carry the same clause for the same reason.
  IF TG_OP = 'UPDATE' AND OLD.cell_id IS DISTINCT FROM NEW.cell_id THEN
    PERFORM assert_cell_configuration_matches_state(OLD.cell_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cells_configuration_matches_state
  AFTER INSERT OR UPDATE ON cells
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configuration_state_from_cells();

CREATE CONSTRAINT TRIGGER cell_categories_match_cell_state
  AFTER INSERT OR UPDATE ON cell_categories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configuration_state_from_configuration();

CREATE CONSTRAINT TRIGGER cell_schedules_match_cell_state
  AFTER INSERT OR UPDATE ON cell_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configuration_state_from_configuration();

-- migrate:down

-- Reversible, and additive in the sense the migration policy means: it adds
-- constraints and no columns, drops nothing, and reverting it removes only the
-- enforcement. No `refuse-if-populated` directive, because the down destroys no
-- history -- the tables and every row in them survive it untouched.

DROP TRIGGER cell_schedules_match_cell_state ON cell_schedules;
DROP TRIGGER cell_categories_match_cell_state ON cell_categories;
DROP TRIGGER cells_configuration_matches_state ON cells;
DROP FUNCTION assert_configuration_state_from_configuration();
DROP FUNCTION assert_configuration_state_from_cells();
DROP FUNCTION assert_cell_configuration_matches_state(uuid);
