-- migrate:up

-- ---------------------------------------------------------------------------
-- SOL 1 joins the school: its Coordinator, its classes and its registrations (SKILL.md
-- sections 7 and 29, decisions 0501 and 0514).
--
-- Additive: a column with a default, so every existing account starts without the new tick,
-- a NOT NULL relaxed, and CHECK constraints replaced by wider ones or added. Every row that
-- exists is a Life Class row naming its Encounter weekend, with both ticks true and only Life
-- Class codes in `unmet`, so each new constraint holds for it, and the migration refuses on its own if one does not. No row is rewritten and no
-- effective date is set, so this is not backdating (section 5).
--
-- **A level is carried on the tick** (decision 0514): one tick per level on the account, one
-- `equipping.coordinate` capability, and the class's level checked against the ticks. A person
-- may hold more than one tick, and a level may have more than one Coordinator.
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN coordinates_sol_1 boolean NOT NULL DEFAULT false;

-- Offered only with Full view, as the Life Class tick is (decision 0501, point 1).
ALTER TABLE accounts
  ADD CONSTRAINT accounts_coordinates_sol_1_needs_full_view
  CHECK (NOT coordinates_sol_1 OR full_view);

-- A class and a registration may now be of SOL 1.
ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS', 'SOL_1'));

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS', 'SOL_1'));

-- SOL has no Encounter (decision 0501, point 17): a Life Class names its weekend, and a SOL 1
-- class names none. Every existing class is Life Class and names one.
ALTER TABLE equipping_classes ALTER COLUMN encounter_season_id DROP NOT NULL;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_encounter_by_level CHECK (
    (level = 'LIFE_CLASS') = (encounter_season_id IS NOT NULL)
  );

-- Life Class keeps both ticks, always true. SOL 1 has no Bible tick, and its manual is a
-- requirement that warns (decision 0501, point 18): left unticked, it is one of `unmet`.
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_bible;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_bible CHECK (level <> 'LIFE_CLASS' OR bible_confirmed);

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_manual;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_manual CHECK (
    level <> 'LIFE_CLASS' OR manual_confirmed
  );

-- Each level's own codes, and no other level's.
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_unmet_known;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_unmet_known CHECK (
    (level = 'LIFE_CLASS'
      AND unmet <@ ARRAY['HAS_LEADER', 'CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4']::text[])
    OR (level = 'SOL_1'
      AND unmet <@ ARRAY['LIFE_CLASS_PASSED', 'WIN_3', 'SOL_1_MANUAL']::text[])
  );

-- A SOL 1 manual not ticked is named in `unmet`, and one ticked is not.
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_sol_1_manual_unmet CHECK (
    level <> 'SOL_1' OR (manual_confirmed = NOT ('SOL_1_MANUAL' = ANY (unmet)))
  );

-- migrate:down

-- Refused while any SOL 1 class or registration exists, which is the safe direction: a down
-- that would delete or relabel them is not written (principle 12). Refused too while any account
-- is ticked SOL 1 Coordinator, so dropping the column loses no current tick.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE coordinates_sol_1) THEN
    RAISE EXCEPTION 'an account is ticked SOL 1 Coordinator; clear it before reverting 0060';
  END IF;
END
$$;
ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_sol_1_manual_unmet;

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_unmet_known;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_unmet_known CHECK (
    unmet <@ ARRAY['HAS_LEADER', 'CELL_REGULAR', 'DCC_REGULAR', 'SUYNL_LESSONS_1_TO_4']::text[]
  );

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_manual;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_manual CHECK (manual_confirmed);

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_bible;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_bible CHECK (bible_confirmed);

ALTER TABLE equipping_registrations DROP CONSTRAINT equipping_registrations_level;
ALTER TABLE equipping_registrations
  ADD CONSTRAINT equipping_registrations_level CHECK (level IN ('LIFE_CLASS'));

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_encounter_by_level;
ALTER TABLE equipping_classes ALTER COLUMN encounter_season_id SET NOT NULL;

ALTER TABLE equipping_classes DROP CONSTRAINT equipping_classes_level;
ALTER TABLE equipping_classes
  ADD CONSTRAINT equipping_classes_level CHECK (level IN ('LIFE_CLASS'));

ALTER TABLE accounts DROP CONSTRAINT accounts_coordinates_sol_1_needs_full_view;

ALTER TABLE accounts DROP COLUMN coordinates_sol_1;
