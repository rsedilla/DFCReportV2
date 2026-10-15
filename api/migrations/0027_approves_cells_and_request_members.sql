-- migrate:up

-- ---------------------------------------------------------------------------
-- Approves Cells on an account (SKILL.md section 7, decision 0352)
--
-- An administrator ticks it on a Leader account, as Full view is ticked; with it the
-- account holds `cell.approve_leadership` over its own branch, excluding itself, and
-- decides the Cell leadership requests section 10 allows it. It means nothing on an
-- account that does not hold `LEADER`.
--
-- Additive: one column with a default, so every existing account starts without it,
-- as a new one does. No effective date is set, so this is not backdating (section 5).
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ADD COLUMN approves_cells boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- The three members a new-Cell request names (SKILL.md section 10, decision 0353)
--
-- Part of what the request asked, so a row is never changed or removed, pending or
-- decided. A request sent before this migration names none and is approved without
-- them, so nothing is backfilled.
-- ---------------------------------------------------------------------------

CREATE TABLE cell_leadership_request_members (
  request_id uuid NOT NULL REFERENCES cell_leadership_requests (id),
  person_id uuid NOT NULL REFERENCES persons (id),
  PRIMARY KEY (request_id, person_id)
);

CREATE INDEX cell_leadership_request_members_person ON cell_leadership_request_members (person_id);

CREATE FUNCTION cell_leadership_request_member_is_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'request %: the members a request names are part of what it asked, and are never '
    'changed or removed (SKILL.md section 10).',
    OLD.request_id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER cell_leadership_request_members_fixed
  BEFORE UPDATE OR DELETE ON cell_leadership_request_members
  FOR EACH ROW EXECUTE FUNCTION cell_leadership_request_member_is_fixed();

-- Only a new-Cell request names members (a restart is one); a handover names none. And they
-- are named once: only in the transaction that wrote the request (its `requested_at` is that
-- transaction's `now()`), and at most three, so nothing adds a member afterwards.
CREATE FUNCTION cell_leadership_request_member_is_for_a_new_cell() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cell_leadership_requests
    WHERE id = NEW.request_id AND kind = 'NEW_CELL'
  ) THEN
    RAISE EXCEPTION
      'request %: only a new-Cell request names members (SKILL.md section 10).',
      NEW.request_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cell_leadership_requests
    WHERE id = NEW.request_id AND requested_at = now()
  ) THEN
    RAISE EXCEPTION
      'request %: members are named when the request is sent and never added later '
      '(SKILL.md section 10).',
      NEW.request_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (SELECT count(*) FROM cell_leadership_request_members WHERE request_id = NEW.request_id) >= 3 THEN
    RAISE EXCEPTION
      'request %: a new-Cell request names three members (SKILL.md section 10).',
      NEW.request_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cell_leadership_request_members_new_cell
  BEFORE INSERT ON cell_leadership_request_members
  FOR EACH ROW EXECUTE FUNCTION cell_leadership_request_member_is_for_a_new_cell();

-- migrate:down
-- migrate:down:refuse-if-populated cell_leadership_request_members

-- Loses every tick and every named member. It refuses while any member is recorded; the
-- ticks are dropped without a guard, as 0024 drops Full view. Their audit entries stay: the audit log is
-- append-only (section 21), and they remain true of what happened.

DROP TRIGGER cell_leadership_request_members_new_cell ON cell_leadership_request_members;

DROP FUNCTION cell_leadership_request_member_is_for_a_new_cell();

DROP TRIGGER cell_leadership_request_members_fixed ON cell_leadership_request_members;

DROP FUNCTION cell_leadership_request_member_is_fixed();

DROP TABLE cell_leadership_request_members;

ALTER TABLE accounts DROP COLUMN approves_cells;
