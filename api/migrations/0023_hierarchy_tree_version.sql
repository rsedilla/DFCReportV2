-- migrate:up

-- ---------------------------------------------------------------------------
-- The version the in-memory tree is checked against (SKILL.md section 24, "The current
-- tree in memory", decision 0321)
--
-- One row. Every transaction that writes `pastoral_assignments`, and every `TRUNCATE` of
-- it, gives the row a new random value in its own transaction. A random value never
-- repeats, including after this table is itself truncated: the next write puts the row
-- back with a fresh one, and while it is absent the API answers from the database.
--
-- **The row is moved at commit, by a deferred constraint trigger**, so its lock is the
-- last a writer takes. Section 5 orders advisory locks before row locks, and the tree
-- import writes a row and then takes the next person's lock: a version row locked at the
-- write deadlocked with a writer holding that person (current-tree.e2e.spec.ts).
--
-- A later migration that writes `pastoral_assignments` and then alters it in the same
-- transaction must run `SET CONSTRAINTS hierarchy_tree_moved IMMEDIATE` first: PostgreSQL
-- refuses DDL on a table with pending trigger events (migration 0008 records the same).
--
-- Additive: one new table, owned by `hierarchy` (section 26), and triggers that write
-- only it. No history is rewritten.
-- ---------------------------------------------------------------------------

CREATE TABLE hierarchy_tree_version (
  only_row boolean PRIMARY KEY DEFAULT true,
  version uuid NOT NULL DEFAULT gen_random_uuid(),

  CONSTRAINT hierarchy_tree_version_one_row CHECK (only_row)
);

INSERT INTO hierarchy_tree_version DEFAULT VALUES;

CREATE FUNCTION hierarchy_tree_moved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hierarchy_tree_version (only_row, version)
  VALUES (true, gen_random_uuid())
  ON CONFLICT (only_row) DO UPDATE SET version = excluded.version;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER hierarchy_tree_moved
  AFTER INSERT OR UPDATE OR DELETE ON pastoral_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION hierarchy_tree_moved();

CREATE TRIGGER hierarchy_tree_truncated
  AFTER TRUNCATE ON pastoral_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION hierarchy_tree_moved();

-- migrate:down

-- The table holds one random value and nothing else, so the down section carries no
-- refuse-if-populated guard.
DROP TRIGGER hierarchy_tree_truncated ON pastoral_assignments;
DROP TRIGGER hierarchy_tree_moved ON pastoral_assignments;
DROP FUNCTION hierarchy_tree_moved();
DROP TABLE hierarchy_tree_version;
