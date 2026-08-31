-- migrate:up

-- ---------------------------------------------------------------------------
-- Attendance (SKILL.md sections 9, 12, 13 and 14)
--
-- Five tables and two enums, for the two attendance domains. They arrive together
-- because they share the rules that make them safe -- append-only correction, a
-- version per record, and a partial unique index over the live row -- and splitting
-- them would state each of those twice.
--
-- **What is deliberately not here.** `report_snapshots` (section 20) belongs to
-- `reporting` and arrives with Stage 5, which is the stage that reads it.
-- `notifications` (section 13, owned by `reporting` per section 26) arrives with the
-- dashboard that displays them, for the reason `docs/ROADMAP.md` records: their
-- content is church-wide, including names, readable only under a grant section 13
-- requires the content to narrow with, so they are rendered at read time against a
-- reader's scope and there is no reader yet.
-- ---------------------------------------------------------------------------

CREATE TYPE cell_meeting_status AS ENUM ('HELD', 'RESCHEDULED', 'NOT_HELD');

-- Section 13 fixes this list and says why it is fixed: "reasons that can be edited
-- at runtime make reporting incomparable across periods". Adding one is an
-- amendment to the specification and a migration, which is the point.
CREATE TYPE cell_meeting_not_held_reason AS ENUM (
  'LEADER_UNAVAILABLE',
  'WEATHER_OR_CALAMITY',
  'HOLIDAY_OR_CHURCH_EVENT',
  'NO_MEMBERS_AVAILABLE',
  'OTHER'
);

-- ---------------------------------------------------------------------------
-- dcc_events (SKILL.md section 9, DCC calendar)
--
-- One row per Sunday, generated ahead by `npm run generate:dcc` on a rolling
-- horizon. A row is never deleted: a Sunday the church did not meet keeps its row
-- with `removed_at` set, so a month showing four events where the calendar holds
-- five is explained by a record rather than by an absence (section 9).
-- ---------------------------------------------------------------------------

CREATE TABLE dcc_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A `date` rather than a timestamp, and unique. Section 9 makes the Sunday the
  -- identity of the event, and the uniqueness is what makes the generation command
  -- idempotent as a property of the table rather than of the command -- so a run
  -- that races another, or repeats, cannot double a month's N.
  event_date date NOT NULL UNIQUE,

  removed_at timestamptz,
  removed_by uuid REFERENCES accounts (id),
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Section 9: "one applicable DCC event per Sunday". A date is stored without a
  -- zone, and the command computes it in Asia/Manila (section 20), so the check is
  -- on the date itself: ISO day 7 is Sunday.
  CONSTRAINT dcc_events_is_a_sunday
    CHECK (EXTRACT(ISODOW FROM event_date) = 7),

  -- Stated as an equivalence, on the shape `cells_closed_iff_closed_at` uses and
  -- for the same reason: a removal with no reason is a decision nobody can read
  -- back, and a reason on a live event is a judgement attached to a service that
  -- took place.
  CONSTRAINT dcc_events_removal_is_whole
    CHECK (
      (removed_at IS NOT NULL) = (removed_by IS NOT NULL)
      AND (removed_at IS NOT NULL) = (btrim(coalesce(removal_reason, '')) <> '')
    )
);

-- The calendar is read by date constantly -- the roster for a Sunday, N for a
-- month, the horizon -- and `event_date` is already unique, so this index exists
-- for the range scans rather than for the lookups.
CREATE INDEX dcc_events_by_date ON dcc_events (event_date DESC);

-- ---------------------------------------------------------------------------
-- dcc_attendance (SKILL.md section 9)
--
-- Append-only. A correction marks the prior row superseded and writes a new one,
-- so the record carries its own history (section 1, principle 12; section 14).
-- ---------------------------------------------------------------------------

CREATE TABLE dcc_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dcc_event_id uuid NOT NULL REFERENCES dcc_events (id),
  person_id uuid NOT NULL REFERENCES persons (id),
  present boolean NOT NULL,

  -- Section 9: the person's direct pastoral leader as of the event date, fixed.
  -- "nullable only for a Network root", who has no pastoral leader and whose
  -- attendance Admin records -- and who is excluded from coverage denominators.
  -- Nothing here can tell a root from a person whose leader was simply not
  -- resolved, so this column is null-permitting and the service is what refuses
  -- the second case (section 9, A DCC attendance record requires a pastoral
  -- leader).
  responsible_leader_id uuid REFERENCES persons (id),

  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),

  superseded_at timestamptz,

  -- The row that replaced this one, not an actor. Section 9 says so explicitly,
  -- because `superseded_by` reads like the other `_by` columns in this schema and
  -- is the one that is not an account.
  --
  -- **Deferred, and a correction is impossible without it.** Section 13 says the
  -- prior row is marked superseded and a new row written, and does not say in which
  -- order -- because with an immediate constraint neither order exists. Insert the
  -- replacement first and the partial unique index refuses it: for that instant two
  -- live rows exist for one person at one event, which is the thing the index is
  -- for. Supersede first and this foreign key refuses it, because the row it points
  -- at has not been written yet.
  --
  -- Deferred, the service mints the replacement's id, supersedes the predecessor
  -- onto it, inserts, and commits. Neither invariant is weakened: both hold at every
  -- commit, which is where they are read.
  --
  -- A deferred *unique index* would have been the other way out and PostgreSQL has
  -- none -- only a unique constraint can be deferred, and a constraint cannot be
  -- partial. So this is the only end of the pair that can move.
  superseded_by uuid REFERENCES dcc_attendance (id) DEFERRABLE INITIALLY DEFERRED,

  correction_reason text,

  -- Section 14's concurrency check, per (event, person) -- the unit a DCC
  -- submission compares, because a DCC event is church-wide and two leaders
  -- recording different people must never conflict (ruling of 2026-08-31).
  version integer NOT NULL DEFAULT 1,

  CONSTRAINT dcc_attendance_version_positive CHECK (version >= 1),

  CONSTRAINT dcc_attendance_supersession_is_whole
    CHECK ((superseded_at IS NOT NULL) = (superseded_by IS NOT NULL))
);

-- Section 9: "At most one non-superseded row may exist per (dcc_event_id,
-- person_id), enforced by a partial unique index where superseded_at is null."
-- Two live rows for one person at one event inflate their monthly bucket and break
-- the reconciliation section 20 requires.
CREATE UNIQUE INDEX dcc_attendance_one_live
  ON dcc_attendance (dcc_event_id, person_id)
  WHERE superseded_at IS NULL;

-- Section 2 names the indexes reporting depends on and requires them in the first
-- migration rather than once somebody complains. These are the two it names for
-- attendance, for the domain that did not exist then.
CREATE INDEX dcc_attendance_by_event ON dcc_attendance (dcc_event_id, person_id);
CREATE INDEX dcc_attendance_by_person ON dcc_attendance (person_id, dcc_event_id);

-- Coverage counts responsible leaders with a record for an event (section 9), which
-- is a scan by event and leader over live rows only.
CREATE INDEX dcc_attendance_coverage
  ON dcc_attendance (dcc_event_id, responsible_leader_id)
  WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- cell_meetings (SKILL.md section 13)
--
-- **A row exists only once the meeting has been reported** (ruling of 2026-08-31).
-- The three statuses are all things a leader reports, so a row generated ahead
-- would need a fourth state for "not yet told us" -- which is the ambiguity the
-- three exist to remove. An unreported meeting is derived from the Cell's schedule
-- against the calendar, and is an outstanding task rather than a row.
-- ---------------------------------------------------------------------------

CREATE TABLE cell_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES cells (id),

  -- The identity, and it is the scheduled date rather than the week. A schedule
  -- change takes effect on the first of a month (section 10) while a week begins on
  -- a Monday (section 20), so a week straddling that boundary can hold two
  -- scheduled meetings under two schedules, reporting in two months -- and keyed on
  -- the week one of them would be unrecordable (ruling of 2026-08-31).
  scheduled_date date NOT NULL,
  scheduled_time time NOT NULL,

  -- Both derived from `scheduled_date` and stored, because a report groups by them
  -- and a reschedule must not move either. Checked below rather than trusted.
  week_starting date NOT NULL,
  reporting_month date NOT NULL,

  status cell_meeting_status NOT NULL,

  -- Set where the meeting was rescheduled, and only there. A HELD meeting took
  -- place on its scheduled date and a NOT_HELD one did not take place at all, so an
  -- actual date on either is a second answer to a question the status already
  -- settles.
  actual_date date,
  actual_time time,

  not_held_reason cell_meeting_not_held_reason,
  not_held_note text,

  -- Section 13: nullable, defaulting to the meeting's responsible leader. Null here
  -- means "the responsible leader ran it", which is the ordinary case; a value means
  -- somebody else did, and facilitating is never leadership.
  facilitated_by uuid REFERENCES persons (id),

  -- Whoever led the Cell on the meeting's date, frozen when this row is first
  -- written and never re-resolved -- not by a later handover, and not by a later
  -- reschedule (rulings of 2026-08-31). Re-resolving would move a recorded meeting
  -- between leaders' totals inside a period that may have closed, which section 20
  -- forbids.
  responsible_leader_id uuid NOT NULL REFERENCES persons (id),

  submitted_by uuid REFERENCES accounts (id),
  submitted_at timestamptz,

  -- Section 14's concurrency check, and for a Cell the unit is the meeting: one
  -- submission is one leader's account of one meeting, which is what section 14's
  -- own example is about and what section 22's conflict body can carry.
  version integer NOT NULL DEFAULT 1,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cell_meetings_version_positive CHECK (version >= 1),

  -- Section 20: a calendar week begins on Monday, ISO 8601. Derived rather than
  -- trusted, because a client sends the scheduled date and a week computed
  -- elsewhere would put the meeting in a week the date does not fall in.
  CONSTRAINT cell_meetings_week_starting_derived
    CHECK (week_starting = scheduled_date - ((EXTRACT(ISODOW FROM scheduled_date)::integer) - 1)),

  -- Section 13: the reporting month is the scheduled date's, "fixed at creation",
  -- and a reschedule never moves it -- "a January 31 Cell meeting rescheduled to
  -- February 2 remains part of January's Cell meeting report".
  CONSTRAINT cell_meetings_reporting_month_derived
    CHECK (reporting_month = date_trunc('month', scheduled_date)::date),

  CONSTRAINT cell_meetings_actual_date_iff_rescheduled
    CHECK ((status = 'RESCHEDULED') = (actual_date IS NOT NULL)),

  -- The time follows the date. A rescheduled meeting has both or neither, which is
  -- what section 13 asks be preserved: original date/time and new date/time.
  CONSTRAINT cell_meetings_actual_time_with_date
    CHECK ((actual_date IS NOT NULL) = (actual_time IS NOT NULL)),

  -- Section 13: "The reason is required" for NOT_HELD, and only for it -- a reason
  -- on a meeting that took place is a judgement about a meeting that happened.
  CONSTRAINT cell_meetings_not_held_reason_iff_not_held
    CHECK ((status = 'NOT_HELD') = (not_held_reason IS NOT NULL)),

  CONSTRAINT cell_meetings_other_requires_note
    CHECK (not_held_reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(not_held_note, '')) <> ''),

  CONSTRAINT cell_meetings_note_only_with_reason
    CHECK (not_held_note IS NULL OR not_held_reason IS NOT NULL),

  CONSTRAINT cell_meetings_submission_is_whole
    CHECK ((submitted_by IS NOT NULL) = (submitted_at IS NOT NULL))
);

-- The identity (ruling of 2026-08-31). One logical meeting per Cell per scheduled
-- date; a reschedule moves `actual_date` and leaves this alone, so it survives a
-- meeting moving and refuses a second row for the same slot.
CREATE UNIQUE INDEX cell_meetings_one_per_scheduled_date
  ON cell_meetings (cell_id, scheduled_date);

-- Coverage and N are both read per Cell per reporting month (sections 12 and 13).
CREATE INDEX cell_meetings_by_cell_month
  ON cell_meetings (cell_id, reporting_month);

-- "Reporting rolls up to them" (section 13) -- the responsible leader is a
-- reporting dimension, read across a period.
CREATE INDEX cell_meetings_by_leader_month
  ON cell_meetings (responsible_leader_id, reporting_month);

-- ---------------------------------------------------------------------------
-- cell_attendance (SKILL.md section 13)
--
-- The same append-only shape as `dcc_attendance`, and the same reason: "An UPDATE
-- plus an audit row does not satisfy Principle 12 -- the record must carry its own
-- history, and a shape offering only one mutable row per person per meeting
-- cannot."
-- ---------------------------------------------------------------------------

CREATE TABLE cell_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_meeting_id uuid NOT NULL REFERENCES cell_meetings (id),
  person_id uuid NOT NULL REFERENCES persons (id),
  present boolean NOT NULL,
  recorded_by uuid NOT NULL REFERENCES accounts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  -- Deferred for the reason `dcc_attendance.superseded_by` gives at length: with an
  -- immediate constraint there is no order in which a correction can be written.
  superseded_by uuid REFERENCES cell_attendance (id) DEFERRABLE INITIALLY DEFERRED,
  correction_reason text,

  -- Guards a correction to one person's record, which section 14 names separately
  -- from a submission. A submission bumps the meeting's version; a correction bumps
  -- this one.
  version integer NOT NULL DEFAULT 1,

  CONSTRAINT cell_attendance_version_positive CHECK (version >= 1),

  CONSTRAINT cell_attendance_supersession_is_whole
    CHECK ((superseded_at IS NOT NULL) = (superseded_by IS NOT NULL))
);

CREATE UNIQUE INDEX cell_attendance_one_live
  ON cell_attendance (cell_meeting_id, person_id)
  WHERE superseded_at IS NULL;

CREATE INDEX cell_attendance_by_meeting ON cell_attendance (cell_meeting_id, person_id);
CREATE INDEX cell_attendance_by_person ON cell_attendance (person_id, cell_meeting_id);

-- ---------------------------------------------------------------------------
-- No attendance against a meeting that did not take place (SKILL.md section 13)
--
-- "NOT_HELD -- the responsible leader explicitly reports that the meeting did not
-- take place and is not being made up. A reason is required. No attendance is
-- recorded."
--
-- A constraint trigger rather than a check, because the fact lives in two tables:
-- the status is on the meeting and the rows are here. Deferred, so a correction
-- that supersedes every row and then declares the meeting NOT_HELD in one
-- transaction is legal -- section 13 requires exactly that path, since "a
-- RESCHEDULED meeting that ultimately does not take place may be changed to
-- NOT_HELD".
--
-- It fires from both sides. Writing attendance against a NOT_HELD meeting and
-- declaring a meeting NOT_HELD while attendance stands are the same corruption
-- reached from two directions, and a trigger on one table only catches the first.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_no_attendance_when_not_held() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  subject uuid;
  offending_meeting uuid;
BEGIN
  -- **Branched in control flow, not in a CASE over NEW.** PL/pgSQL hands the whole
  -- expression to SQL, so every field reference in it must resolve against the row
  -- to hand -- and `NEW.cell_meeting_id` does not exist when this fires on
  -- `cell_meetings`, whichever branch the CASE would have taken. The first version
  -- of this function did that and failed on every insert with `record "new" has no
  -- field "cell_meeting_id"`.
  IF TG_TABLE_NAME = 'cell_meetings' THEN
    subject := NEW.id;
  ELSE
    subject := NEW.cell_meeting_id;
  END IF;

  SELECT m.id INTO offending_meeting
    FROM cell_meetings m
   WHERE m.status = 'NOT_HELD'
     AND m.id = subject
     AND EXISTS (
       SELECT 1 FROM cell_attendance a
        WHERE a.cell_meeting_id = m.id
          AND a.superseded_at IS NULL
     );

  IF offending_meeting IS NOT NULL THEN
    RAISE EXCEPTION
      'a meeting reported NOT_HELD carries no attendance (SKILL.md section 13): meeting %',
      offending_meeting
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cell_attendance_not_when_not_held
  AFTER INSERT OR UPDATE ON cell_attendance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_no_attendance_when_not_held();

CREATE CONSTRAINT TRIGGER cell_meetings_not_held_has_no_attendance
  AFTER INSERT OR UPDATE ON cell_meetings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_no_attendance_when_not_held();

-- ---------------------------------------------------------------------------
-- cell_meeting_changes (SKILL.md section 13)
--
-- "A meeting's changes live in their own rows, not in columns on the meeting. A
-- meeting rescheduled twice would overwrite the first reschedule in a single set of
-- columns, and section 13 requires a RESCHEDULED meeting later declared NOT_HELD to
-- preserve both records."
-- ---------------------------------------------------------------------------

CREATE TABLE cell_meeting_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_meeting_id uuid NOT NULL REFERENCES cell_meetings (id),
  from_status cell_meeting_status NOT NULL,
  to_status cell_meeting_status NOT NULL,
  from_date date,
  from_time time,
  to_date date,
  to_time time,
  reason cell_meeting_not_held_reason,
  note text,
  actor_id uuid NOT NULL REFERENCES accounts (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cell_meeting_changes_note_only_with_reason
    CHECK (note IS NULL OR reason IS NOT NULL)
);

-- Read as one meeting's history, oldest first, which is how a reader follows what
-- happened to it.
CREATE INDEX cell_meeting_changes_by_meeting
  ON cell_meeting_changes (cell_meeting_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Attendance and its history are never deleted (SKILL.md section 5, Database
-- enforcement)
--
-- The no-delete rule reaches "pastoral assignments, Cell category changes,
-- attendance corrections, and other important changes" (section 1, principle 12).
-- A correction supersedes; it never removes. `refuse_delete_of_history()` already
-- exists and already says the right thing -- close the row and open a new one.
-- ---------------------------------------------------------------------------

CREATE TRIGGER dcc_attendance_no_delete
  BEFORE DELETE ON dcc_attendance
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_attendance_no_delete
  BEFORE DELETE ON cell_attendance
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_meetings_no_delete
  BEFORE DELETE ON cell_meetings
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_meeting_changes_no_delete
  BEFORE DELETE ON cell_meeting_changes
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- A removed Sunday keeps its row, which is the whole of section 9's removal
-- design: "A removed event is retained rather than deleted, so a month showing
-- four events where the calendar holds five is explained by a record rather than
-- by an absence."
CREATE TRIGGER dcc_events_no_delete
  BEFORE DELETE ON dcc_events
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- ---------------------------------------------------------------------------
-- The calendar's first Sunday (SKILL.md sections 7 and 9)
--
-- Seeded null, and set once by the generation command's first run to the Sunday on
-- or before that day (ruling of 2026-08-31). It records when this church's calendar
-- began, which is what lets a report over an earlier range say "before we started"
-- rather than "no service".
--
-- Seeded rather than left absent, because `settings_key_is_known` is a closed list
-- and a key the application writes without a row would have to INSERT rather than
-- UPDATE -- two paths where the other two keys have one.
-- ---------------------------------------------------------------------------

ALTER TABLE settings DROP CONSTRAINT settings_key_is_known;

ALTER TABLE settings ADD CONSTRAINT settings_key_is_known
  CHECK (key IN ('cell_attention_months', 'initial_encoding_open', 'dcc_calendar_start'));

INSERT INTO settings (key, value, updated_by) VALUES
  ('dcc_calendar_start', 'null'::jsonb, NULL);

-- migrate:down

-- **The one place a `settings` row legitimately disappears, and the trigger has to be
-- stood down for it.** `settings_no_delete` (migration 0002) refuses a delete because
-- a setting is corrected by writing a value, never by removing the row -- and its
-- message says exactly that. That reasoning is about a key the system still has. Here
-- the key itself is ceasing to exist along with the calendar it configures, so there
-- is no value to write instead, and leaving the row would strand it outside
-- `settings_key_is_known` the moment the constraint is narrowed two statements below.
--
-- Disabled and re-enabled rather than dropped and recreated, so the trigger's own
-- definition is never restated here and cannot drift from 0002's.
ALTER TABLE settings DISABLE TRIGGER settings_no_delete;
DELETE FROM settings WHERE key = 'dcc_calendar_start';
ALTER TABLE settings ENABLE TRIGGER settings_no_delete;

ALTER TABLE settings DROP CONSTRAINT settings_key_is_known;

ALTER TABLE settings ADD CONSTRAINT settings_key_is_known
  CHECK (key IN ('cell_attention_months', 'initial_encoding_open'));

DROP TRIGGER dcc_events_no_delete ON dcc_events;
DROP TRIGGER cell_meeting_changes_no_delete ON cell_meeting_changes;
DROP TRIGGER cell_meetings_no_delete ON cell_meetings;
DROP TRIGGER cell_attendance_no_delete ON cell_attendance;
DROP TRIGGER dcc_attendance_no_delete ON dcc_attendance;

DROP TRIGGER cell_meetings_not_held_has_no_attendance ON cell_meetings;
DROP TRIGGER cell_attendance_not_when_not_held ON cell_attendance;
DROP FUNCTION assert_no_attendance_when_not_held();

DROP TABLE cell_meeting_changes;
DROP TABLE cell_attendance;
DROP TABLE cell_meetings;
DROP TABLE dcc_attendance;
DROP TABLE dcc_events;

DROP TYPE cell_meeting_not_held_reason;
DROP TYPE cell_meeting_status;
