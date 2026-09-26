-- migrate:up

-- ---------------------------------------------------------------------------
-- Encounter seasons (SKILL.md section 28; ruling of 2026-09-26, decision 0296)
--
-- Three times a year the church holds an Encounter God Weekend, which is lesson 5
-- of Life Class (decision 0295): a Men's weekend for men only and a Women's
-- weekend for women only, usually a week apart, each preceded by its own LC Party.
-- An administrator records the four dates of each season here.
--
-- **The dates are recorded rather than derived.** The church holds the weekends
-- in the first week of April, August and December, and a retreat can move; a
-- rule computing dates from a month would be wrong exactly when it matters.
--
-- **Each LC Party is at least five weeks before its own weekend**, the party and
-- Life Class lessons 1 to 4 a week apart before the Encounter as lesson 5. The
-- rule is the owner's (decision 0296), and it is a constraint here rather than a
-- check in the service, because it is expressible as one (CLAUDE.md, Definition
-- of Done). Nothing limits how early a party may be.
--
-- **Never deleted.** A wrong date is corrected by an edit, which the audit log
-- records with its previous and new values (section 21).
-- ---------------------------------------------------------------------------

CREATE TABLE encounter_seasons (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mens_lc_party_on     date NOT NULL,
  mens_encounter_on    date NOT NULL,
  womens_lc_party_on   date NOT NULL,
  womens_encounter_on  date NOT NULL,
  created_by           uuid NOT NULL REFERENCES accounts(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES accounts(id),
  updated_at           timestamptz,

  CONSTRAINT encounter_seasons_mens_party_five_weeks_before CHECK (
    mens_lc_party_on <= mens_encounter_on - 35
  ),
  CONSTRAINT encounter_seasons_womens_party_five_weeks_before CHECK (
    womens_lc_party_on <= womens_encounter_on - 35
  ),
  -- An edit names who made it and when, together or not at all.
  CONSTRAINT encounter_seasons_update_is_whole CHECK (
    (updated_by IS NULL) = (updated_at IS NULL)
  )
);

-- Two seasons cannot hold the same weekend.
CREATE UNIQUE INDEX encounter_seasons_one_per_mens_weekend
  ON encounter_seasons (mens_encounter_on);

CREATE UNIQUE INDEX encounter_seasons_one_per_womens_weekend
  ON encounter_seasons (womens_encounter_on);

CREATE TRIGGER encounter_seasons_no_delete
  BEFORE DELETE ON encounter_seasons
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- migrate:down:refuse-if-populated encounter_seasons

-- A season an administrator recorded is the church's calendar, and the SUYNL
-- report reads it; reverting is refused once the table holds a row, as for the
-- other tables that are never deleted.

DROP TABLE encounter_seasons;
