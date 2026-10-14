-- migrate:up

-- ---------------------------------------------------------------------------
-- What a request's named Cell was called when the request was sent (SKILL.md
-- section 10, *Creating a Cell* and *Transferring Cell leadership*; decision 0346)
--
-- A sender reads back the requests they sent with no capability, because that list
-- returns only what the sender's own account created (section 7, decision 0269). A
-- handover names a running Cell and a restart names a closed one, and neither row
-- held anything of that Cell but its identifier, so the list could name it only by
-- its code: reading the Cell's own category and day would show a sender a Cell's
-- details after it has left their branch. These two columns record the category and
-- the day of the Cell the request names, as they stood when it was sent, so the name
-- is the sender's own record.
--
-- Both are nullable and nothing is backfilled. A request sent before this migration
-- recorded no name and keeps showing its code; filling one in now would be writing
-- the Cell's present configuration into a past record, which is the backdating the
-- migration policy refuses.
-- ---------------------------------------------------------------------------

ALTER TABLE cell_leadership_requests
  ADD COLUMN named_cell_category cell_category,
  ADD COLUMN named_cell_day_of_week smallint;

ALTER TABLE cell_leadership_requests
  ADD CONSTRAINT cell_leadership_requests_named_cell_day_iso
    CHECK (named_cell_day_of_week IS NULL OR named_cell_day_of_week BETWEEN 1 AND 7);

-- Both or neither: a name is a category and a day, and half of one names nothing.
ALTER TABLE cell_leadership_requests
  ADD CONSTRAINT cell_leadership_requests_named_cell_is_whole
    CHECK ((named_cell_category IS NULL) = (named_cell_day_of_week IS NULL));

-- Only a request that names a Cell carries its name: a handover, or a restart. A plain
-- new-Cell request names none, and its own category and day are the Cell it asks for.
ALTER TABLE cell_leadership_requests
  ADD CONSTRAINT cell_leadership_requests_named_cell_is_named
    CHECK (
      named_cell_category IS NULL
      OR kind = 'HANDOVER'
      OR restart_of_cell_id IS NOT NULL
    );

-- A record of the moment it was sent, so it is never rewritten. Migration 0009's
-- finality trigger already freezes every column of a decided request; this freezes
-- these two on a pending one too, which that trigger deliberately leaves writable
-- for the category and day a new-Cell request asks for.
CREATE FUNCTION cell_leadership_request_named_cell_is_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.named_cell_category IS DISTINCT FROM OLD.named_cell_category
     OR NEW.named_cell_day_of_week IS DISTINCT FROM OLD.named_cell_day_of_week THEN
    RAISE EXCEPTION
      'request %: the name of the Cell it named when it was sent is not rewritten '
      '(SKILL.md section 10).',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cell_leadership_requests_named_cell_fixed
  BEFORE UPDATE ON cell_leadership_requests
  FOR EACH ROW EXECUTE FUNCTION cell_leadership_request_named_cell_is_fixed();

-- migrate:down

DROP TRIGGER cell_leadership_requests_named_cell_fixed ON cell_leadership_requests;

DROP FUNCTION cell_leadership_request_named_cell_is_fixed();

ALTER TABLE cell_leadership_requests
  DROP CONSTRAINT cell_leadership_requests_named_cell_is_named,
  DROP CONSTRAINT cell_leadership_requests_named_cell_is_whole,
  DROP CONSTRAINT cell_leadership_requests_named_cell_day_iso;

ALTER TABLE cell_leadership_requests
  DROP COLUMN named_cell_day_of_week,
  DROP COLUMN named_cell_category;
