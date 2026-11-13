-- migrate:up

-- ---------------------------------------------------------------------------
-- A birthday is not before 1 January 1900 (SKILL.md section 3, decision 0487).
--
-- The server refuses one on every write path already; this is the constraint
-- the Definition of Done asks of an invariant a constraint can express. Only
-- the floor: the ceiling is today, which moves, so it cannot be a CHECK.
--
-- Validated, not NOT VALID. The Migration policy asks the live data to be
-- checked first, and production answered 0 to
--   SELECT count(*) FROM persons WHERE birth_date < '1900-01-01'
-- on 2026-11-14. A database that still holds such a row refuses this
-- migration rather than half-applying it; fix the row by an edit and re-run.
-- A null birthday passes, as a CHECK passes null.
-- ---------------------------------------------------------------------------

ALTER TABLE persons
  ADD CONSTRAINT persons_birth_date_not_before_1900
  CHECK (birth_date >= DATE '1900-01-01');

-- migrate:down

ALTER TABLE persons DROP CONSTRAINT persons_birth_date_not_before_1900;
