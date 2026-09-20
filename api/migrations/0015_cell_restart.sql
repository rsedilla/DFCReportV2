-- migrate:up

-- ---------------------------------------------------------------------------
-- Restarting a closed Cell (SKILL.md section 10, *Creating a Cell*; ruling of
-- 2026-09-20, decision 0264)
--
-- A Cell closes because its members dispersed or because its leader stepped down,
-- and sometimes the same people come back. A closure is never reversed (decision
-- 0133), so resuming one is a **new** Cell that records where it came from: the
-- request names the closed Cell, and approval carries that name onto the Cell it
-- mints.
--
-- Both columns are nullable and neither is written by anything that exists, which is
-- what the migration policy asks of an additive change. Every Cell and every request
-- written before this migration reads as what it was — not a restart.
-- ---------------------------------------------------------------------------

ALTER TABLE cells
  ADD COLUMN restarted_from_cell_id uuid REFERENCES cells (id);

-- A Cell does not resume itself. Cheap, and it is the one shape a foreign key to the
-- same table cannot refuse on its own.
ALTER TABLE cells
  ADD CONSTRAINT cells_restart_is_another_cell
    CHECK (restarted_from_cell_id IS DISTINCT FROM id);

-- **At most one restart per closed Cell** (decision 0264, item 3). Two Cells naming
-- one ancestor are two Cells claiming one history between them. A restart may itself
-- be restarted, which this permits: the chain runs backwards and never branches.
--
-- Partial rather than plain, for size rather than for meaning: PostgreSQL treats
-- nulls as distinct in a unique index, so the two would refuse the same writes, and
-- every Cell that is not a restart carries a null.
CREATE UNIQUE INDEX cells_one_restart_per_cell
  ON cells (restarted_from_cell_id)
  WHERE restarted_from_cell_id IS NOT NULL;

ALTER TABLE cell_leadership_requests
  ADD COLUMN restart_of_cell_id uuid REFERENCES cells (id);

-- A handover resumes nothing: it moves a Cell that is still running to a new leader.
-- Stated here as well as in the service because migration 0009 states every other
-- `kind`-decides-this rule on the table rather than in prose.
ALTER TABLE cell_leadership_requests
  ADD CONSTRAINT cell_leadership_requests_restart_is_a_new_cell
    CHECK (restart_of_cell_id IS NULL OR kind = 'NEW_CELL');

-- migrate:down

DROP INDEX cells_one_restart_per_cell;

ALTER TABLE cell_leadership_requests
  DROP CONSTRAINT cell_leadership_requests_restart_is_a_new_cell;

ALTER TABLE cell_leadership_requests
  DROP COLUMN restart_of_cell_id;

ALTER TABLE cells
  DROP CONSTRAINT cells_restart_is_another_cell;

ALTER TABLE cells
  DROP COLUMN restarted_from_cell_id;
