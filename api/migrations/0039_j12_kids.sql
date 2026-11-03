-- migrate:up

-- ---------------------------------------------------------------------------
-- A fourth Cell category, J12 Kids (SKILL.md section 10, decision 0431)
--
-- Additive: one value added to `cell_category`, and nothing written. Placed first, so the
-- type's own order is the one every screen shows, youngest to oldest: J12 Kids, Youth,
-- Young Pro, Couple. A value added here cannot be used inside the transaction that adds it
-- (verify-migrations-on-a-fresh-database), and nothing here uses it.
-- ---------------------------------------------------------------------------

ALTER TYPE cell_category ADD VALUE 'J12_KIDS' BEFORE 'YOUTH';

-- migrate:down

-- PostgreSQL cannot drop a value from an enum, so the type is rebuilt without it, and only
-- while nothing uses it: a Cell's category history or a request naming J12 Kids is the
-- record of a category that existed, and the down refuses rather than rewrite it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cell_categories WHERE category::text = 'J12_KIDS')
     OR EXISTS (SELECT 1 FROM cell_leadership_requests
                WHERE category::text = 'J12_KIDS' OR named_cell_category::text = 'J12_KIDS') THEN
    RAISE EXCEPTION 'J12 Kids is in use by a Cell or a request; this migration cannot be reverted '
      'without rewriting that history (decision 0431).';
  END IF;
END
$$;

ALTER TYPE cell_category RENAME TO cell_category_with_j12;
CREATE TYPE cell_category AS ENUM ('YOUTH', 'YOUNG_PRO', 'COUPLE');

ALTER TABLE cell_categories
  ALTER COLUMN category TYPE cell_category USING category::text::cell_category;
ALTER TABLE cell_leadership_requests
  ALTER COLUMN category TYPE cell_category USING category::text::cell_category,
  ALTER COLUMN named_cell_category TYPE cell_category USING named_cell_category::text::cell_category;

DROP TYPE cell_category_with_j12;
