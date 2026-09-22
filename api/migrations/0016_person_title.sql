-- migrate:up

-- ---------------------------------------------------------------------------
-- A person's title (SKILL.md section 3, *Name handling*; ruling of 2026-09-22,
-- decision 0271)
--
-- Bishop, Pastora and the like. Section 3 keeps a title out of every name field,
-- because a name field is compared as a name and "Pastora Lina" never matches
-- "Lina". It is stored here instead, beside the name and never compared.
--
-- Nullable, and nothing existing writes it, which is what the migration policy
-- asks of an additive change: every Person reads as having no title until one is
-- given. It holds the current title only and is not effective-dated, because no
-- report counts it.
-- ---------------------------------------------------------------------------

ALTER TABLE persons
  ADD COLUMN title text;

-- Blank means absent, and absent is null: one representation. No length bound
-- here, as for a name: the DTO's bound is a request-size guard, and a second bound
-- counting characters differently would turn a value it admits into a 500.
ALTER TABLE persons
  ADD CONSTRAINT persons_title_not_blank
    CHECK (title IS NULL OR btrim(title) <> '');

-- migrate:down

ALTER TABLE persons
  DROP CONSTRAINT persons_title_not_blank;

ALTER TABLE persons
  DROP COLUMN title;
