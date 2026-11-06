-- migrate:up

-- ---------------------------------------------------------------------------
-- Indexes for the duplicate check (SKILL.md section 3, decision 0449)
--
-- The check Add a Person and Edit details run as a leader types reads every Person
-- reached by any of five branches: the surname's first letter, the first name, the two
-- names swapped, the birthday (equal or one transposition away), and the mobile number.
-- `persons` had no index on any of them, so every check read the whole table. One index
-- per branch lets the planner combine them, and none may be missing, since an OR with
-- one unindexed branch reads the whole table again.
--
-- The three name indexes are built on the query's own expressions, character for
-- character (`people.duplicates.service.ts`, `populationFor`), with the accent strings
-- of `people.shared.ts` as literals: an expression index serves only the expression it
-- was built on. `duplicate-check-indexes.spec.ts` fails if the two drift apart.
-- `text_pattern_ops` on the surname serves its LIKE 'x%' prefix match.
--
-- Indexes only: no row is written, and nothing is constrained.
-- ---------------------------------------------------------------------------

CREATE INDEX persons_duplicate_last_name_idx
  ON persons (lower(translate(last_name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ', 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')) text_pattern_ops);

CREATE INDEX persons_duplicate_first_name_idx
  ON persons (lower(translate(first_name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ', 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')));

CREATE INDEX persons_duplicate_compact_last_name_idx
  ON persons (regexp_replace(lower(translate(last_name, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ', 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')), '[[:space:]''’-]', '', 'g'));

CREATE INDEX persons_birth_date_idx ON persons (birth_date);

CREATE INDEX persons_mobile_number_normalized_idx ON persons (mobile_number_normalized);

-- migrate:down

DROP INDEX persons_mobile_number_normalized_idx;
DROP INDEX persons_birth_date_idx;
DROP INDEX persons_duplicate_compact_last_name_idx;
DROP INDEX persons_duplicate_first_name_idx;
DROP INDEX persons_duplicate_last_name_idx;
