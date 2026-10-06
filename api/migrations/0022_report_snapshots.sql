-- migrate:up

-- ---------------------------------------------------------------------------
-- Stored closed months (SKILL.md section 20, decision 0320)
--
-- A closed month's two monthly reports are stored, each carrying the version its
-- month had when it was computed. The triggers below move a month's version, and the
-- version of every later stored month, whenever a row a stored report reads changes,
-- so a stored month whose version has moved is recomputed rather than served.
--
-- **A version row exists only for a month somebody has asked to store.** A write into
-- the open month therefore finds no row to move and takes no lock: only a closed month
-- is stored, and no stored month is later than the open one. What a change that is in
-- flight while a month is first stored does is handled on the storing side, in
-- `ReportingService`, which waits for every transaction running when the row was
-- created to finish before computing (decision 0320's guarantee, and the test that
-- fails without it).
--
-- Additive: two new tables and triggers that write only `report_month_versions`.
-- Section 2 admits the triggers as the one exemption that lives in the database.
-- ---------------------------------------------------------------------------

CREATE TABLE report_month_versions (
  -- The first day of an Asia/Manila month.
  month date PRIMARY KEY,
  version bigint NOT NULL DEFAULT 0,

  CONSTRAINT report_month_versions_first_of_month CHECK (EXTRACT(DAY FROM month) = 1)
);

CREATE TABLE report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_kind text NOT NULL,
  scope_type text NOT NULL,
  -- A Person or Cell id, or a Network name; null for Whole Church.
  scope_id text,
  period date NOT NULL REFERENCES report_month_versions (month),
  source_version bigint NOT NULL,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_snapshots_kind CHECK (report_kind IN ('DCC_MONTHLY', 'CELL_MONTHLY')),
  CONSTRAINT report_snapshots_scope_type
    CHECK (scope_type IN ('CELL', 'LEADER', 'NETWORK', 'WHOLE_CHURCH')),
  CONSTRAINT report_snapshots_whole_church_has_no_id
    CHECK ((scope_type = 'WHOLE_CHURCH') = (scope_id IS NULL))
);

CREATE UNIQUE INDEX report_snapshots_one_per_report
  ON report_snapshots (report_kind, scope_type, scope_id, period) NULLS NOT DISTINCT;

-- Moves the version of `from_month` and of every later stored month. Rows are taken
-- in month order, so two changes moving overlapping months within one statement each
-- lock in the same order.
CREATE FUNCTION report_months_move_from(from_month date) RETURNS void
LANGUAGE sql AS $$
  WITH moved AS (
    SELECT month FROM report_month_versions
    WHERE month >= date_trunc('month', from_month)::date
    ORDER BY month
    FOR UPDATE
  )
  UPDATE report_month_versions v
  SET version = v.version + 1
  FROM moved
  WHERE v.month = moved.month
$$;

-- The Asia/Manila month of an instant.
CREATE FUNCTION report_month_of(at timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT date_trunc('month', at AT TIME ZONE 'Asia/Manila')::date
$$;

-- A record that belongs to a month (a DCC event, a Cell meeting): any change to it
-- moves the month of every listed date column, old and new. TG_ARGV names the columns.
CREATE FUNCTION report_months_move_dated_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  column_name text;
  earliest date;
  value text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      value := to_jsonb(OLD) ->> column_name;
      IF value IS NOT NULL THEN
        earliest := LEAST(earliest, value::date);
      END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      value := to_jsonb(NEW) ->> column_name;
      IF value IS NOT NULL THEN
        earliest := LEAST(earliest, value::date);
      END IF;
    END IF;
  END LOOP;

  IF earliest IS NOT NULL THEN
    PERFORM report_months_move_from(earliest);
  END IF;
  RETURN NULL;
END
$$;

-- An effective-dated row: the month of the earliest instant the write moves, old value
-- or new. TG_ARGV names the instant columns. An update that moves none of them still
-- moves from the earliest it holds, since another column of the row has changed.
CREATE FUNCTION report_months_move_effective() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  column_name text;
  earliest timestamptz;
  fallback timestamptz;
  old_value text;
  new_value text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    old_value := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ->> column_name END;
    new_value := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ->> column_name END;

    IF TG_OP = 'UPDATE' THEN
      fallback := LEAST(fallback, old_value::timestamptz, new_value::timestamptz);
      IF old_value IS DISTINCT FROM new_value THEN
        earliest := LEAST(earliest, old_value::timestamptz, new_value::timestamptz);
      END IF;
    ELSE
      earliest := LEAST(earliest, old_value::timestamptz, new_value::timestamptz);
    END IF;
  END LOOP;

  earliest := COALESCE(earliest, fallback);
  IF earliest IS NOT NULL THEN
    PERFORM report_months_move_from(report_month_of(earliest));
  END IF;
  RETURN NULL;
END
$$;

-- A DCC attendance row belongs to its event's month.
CREATE FUNCTION report_months_move_dcc_attendance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  earliest date;
BEGIN
  SELECT min(e.event_date) INTO earliest
  FROM dcc_events e
  WHERE e.id IN (
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.dcc_event_id END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.dcc_event_id END
  );

  IF earliest IS NOT NULL THEN
    PERFORM report_months_move_from(earliest);
  END IF;
  RETURN NULL;
END
$$;

-- A Cell attendance row or a meeting change belongs to its meeting's reporting month.
CREATE FUNCTION report_months_move_cell_meeting_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  earliest date;
BEGIN
  SELECT min(m.reporting_month) INTO earliest
  FROM cell_meetings m
  WHERE m.id IN (
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.cell_meeting_id END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.cell_meeting_id END
  );

  IF earliest IS NOT NULL THEN
    PERFORM report_months_move_from(earliest);
  END IF;
  RETURN NULL;
END
$$;

-- A Person Merge moves every month (section 3).
CREATE FUNCTION report_months_move_all() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM report_months_move_from('0001-01-01'::date);
  RETURN NULL;
END
$$;

CREATE TRIGGER report_months_dcc_events
  AFTER INSERT OR UPDATE OR DELETE ON dcc_events
  FOR EACH ROW EXECUTE FUNCTION report_months_move_dated_record('event_date');

CREATE TRIGGER report_months_dcc_attendance
  AFTER INSERT OR UPDATE OR DELETE ON dcc_attendance
  FOR EACH ROW EXECUTE FUNCTION report_months_move_dcc_attendance();

CREATE TRIGGER report_months_cell_meetings
  AFTER INSERT OR UPDATE OR DELETE ON cell_meetings
  FOR EACH ROW EXECUTE FUNCTION report_months_move_dated_record('reporting_month');

CREATE TRIGGER report_months_cell_attendance
  AFTER INSERT OR UPDATE OR DELETE ON cell_attendance
  FOR EACH ROW EXECUTE FUNCTION report_months_move_cell_meeting_child();

CREATE TRIGGER report_months_cell_meeting_changes
  AFTER INSERT OR UPDATE OR DELETE ON cell_meeting_changes
  FOR EACH ROW EXECUTE FUNCTION report_months_move_cell_meeting_child();

CREATE TRIGGER report_months_pastoral_assignments
  AFTER INSERT OR UPDATE OR DELETE ON pastoral_assignments
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_network_assignments
  AFTER INSERT OR UPDATE OR DELETE ON network_assignments
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_cells
  AFTER INSERT OR UPDATE OR DELETE ON cells
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('created_at', 'closed_at');

CREATE TRIGGER report_months_cell_leaderships
  AFTER INSERT OR UPDATE OR DELETE ON cell_leaderships
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_cell_memberships
  AFTER INSERT OR UPDATE OR DELETE ON cell_memberships
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_cell_schedules
  AFTER INSERT OR UPDATE OR DELETE ON cell_schedules
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_cell_categories
  AFTER INSERT OR UPDATE OR DELETE ON cell_categories
  FOR EACH ROW EXECUTE FUNCTION report_months_move_effective('started_at', 'ended_at');

CREATE TRIGGER report_months_persons
  AFTER UPDATE OF merged_into_id ON persons
  FOR EACH ROW WHEN (OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id)
  EXECUTE FUNCTION report_months_move_all();

-- migrate:down

-- Both tables are a cache, always derivable from the records (section 20), so the down
-- section carries no refuse-if-populated guard.
DROP TRIGGER report_months_persons ON persons;
DROP TRIGGER report_months_cell_categories ON cell_categories;
DROP TRIGGER report_months_cell_schedules ON cell_schedules;
DROP TRIGGER report_months_cell_memberships ON cell_memberships;
DROP TRIGGER report_months_cell_leaderships ON cell_leaderships;
DROP TRIGGER report_months_cells ON cells;
DROP TRIGGER report_months_network_assignments ON network_assignments;
DROP TRIGGER report_months_pastoral_assignments ON pastoral_assignments;
DROP TRIGGER report_months_cell_meeting_changes ON cell_meeting_changes;
DROP TRIGGER report_months_cell_attendance ON cell_attendance;
DROP TRIGGER report_months_cell_meetings ON cell_meetings;
DROP TRIGGER report_months_dcc_attendance ON dcc_attendance;
DROP TRIGGER report_months_dcc_events ON dcc_events;

DROP FUNCTION report_months_move_all();
DROP FUNCTION report_months_move_cell_meeting_child();
DROP FUNCTION report_months_move_dcc_attendance();
DROP FUNCTION report_months_move_effective();
DROP FUNCTION report_months_move_dated_record();
DROP FUNCTION report_month_of(timestamptz);
DROP FUNCTION report_months_move_from(date);

DROP TABLE report_snapshots;
DROP TABLE report_month_versions;
