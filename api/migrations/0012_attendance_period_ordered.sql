-- migrate:up

-- ---------------------------------------------------------------------------
-- An attendance row's live period is ordered (SKILL.md sections 9, 13 and 14)
--
-- Both attendance tables carry `recorded_at` and `superseded_at`, which are the two
-- ends of one period: the row is the live record from the first until the second.
-- Migration 0011 created them without the `period_ordered` check every other
-- effective-dated table in this schema has, and nothing noticed until a review found
-- the correction path stamping `superseded_at` from the host clock while `recorded_at`
-- fell to the column default -- the database's. One row's period, two clocks, and an
-- inversion whenever the real elapsed time was shorter than the difference between
-- them.
--
-- The application was corrected in the same change; this is the half that cannot be
-- got wrong again. `CLAUDE.md`, Definition of Done: an invariant expressible as a
-- database constraint is verified to exist as one, rather than only as application
-- code.
--
-- **Additive and reversible** (`CLAUDE.md`, Migration policy). It adds no column,
-- rewrites no row, and drops nothing; `migrate:down` removes the two constraints and
-- leaves the data untouched.
--
-- **Validated against existing data before enforcing**, which the policy requires:
-- `ADD CONSTRAINT ... CHECK` scans the table and aborts on a row that fails, so a
-- deployment holding an inverted row is told rather than half-migrated. Both tables
-- are empty in every environment this has been applied to -- Stage 4 is the first to
-- write either -- so the scan is over nothing, and that is stated rather than assumed.
-- ---------------------------------------------------------------------------

-- `>=` rather than `>`, which is the convention migration 0001 sets and gives its
-- reason for: section 5 corrects a row entered in error by closing it at zero length,
-- and a strict comparison would allow only closing it a moment later -- recording a
-- non-zero period during which a fact that was never true was in force. Section 14's
-- correction path is the same shape, so a record entered in error and superseded in
-- the same instant is legitimate here too.
--
-- It still refuses the defect this exists for: an inversion is `superseded_at <
-- recorded_at`, which `>=` rejects.
ALTER TABLE dcc_attendance ADD CONSTRAINT dcc_attendance_period_ordered
  CHECK (superseded_at IS NULL OR superseded_at >= recorded_at);

-- The same rule on the Cell side, added now rather than when Cell recording is built.
-- The table has the identical shape and the identical hole, and the cheap moment to
-- close it is before anything writes to it -- which is the argument section 23 makes
-- for version checks and idempotency, applied to a constraint.
ALTER TABLE cell_attendance ADD CONSTRAINT cell_attendance_period_ordered
  CHECK (superseded_at IS NULL OR superseded_at >= recorded_at);

-- migrate:down

ALTER TABLE cell_attendance DROP CONSTRAINT cell_attendance_period_ordered;
ALTER TABLE dcc_attendance DROP CONSTRAINT dcc_attendance_period_ordered;
