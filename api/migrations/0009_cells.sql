-- Stage 3, slice 1: the six tables the `cells` module owns.
--
-- Tables created:
--   cells                       SKILL.md section 10
--   cell_categories             section 10, Category changes
--   cell_schedules              section 10, Schedule changes
--   cell_leaderships            section 11
--   cell_memberships            section 10, Cell Membership
--   cell_leadership_requests    section 10, Creating a Cell
--
-- All six are indexed in section 26, and every one of them arrives here with its
-- indexes rather than in a later errand (section 2, Scale). Constraint DDL is
-- hand-written; nothing in this file is generated (CLAUDE.md, Migration policy).
--
-- **Five rulings settled before this file was written**, on 2026-08-28, and each
-- is carried by something here that can fail:
--
--   1. An ACTIVE Cell has exactly one leadership assignment and a CLOSED Cell has
--      none -- a deferred constraint trigger on both tables (section 11).
--   2. `cell.manage_configuration` governs category and schedule. It is already in
--      the `capability` enum; nothing in this migration touches it.
--   3. A schedule row starts on the first of a month in Asia/Manila, or at the
--      Cell's `created_at` -- a trigger, strict, with no backdating exception.
--   4. A Cell changes hands through request-and-approve, one table, two kinds, two
--      uniqueness rules -- `cell_leadership_requests` below.
--   5. A closure is never reversed -- `cells_record_is_final`.
--
-- **What this migration deliberately does not do.** It creates no endpoint, no
-- service and no row. Authorization for every operation over these tables lives in
-- the domain layer and in the guard, and arrives with the operations themselves.
-- Two rules are named where they would otherwise look forgotten: the prohibition on
-- naming yourself in a request, which crosses the Person/Account boundary and so
-- cannot be a check constraint, and the same-Network rule's second direction, which
-- belongs to `networks` and is named in docs/ROADMAP.md as its own Stage 3 item.
--
-- `actor_id` references `accounts (id)`, as it does in 0001: the actor is the
-- authenticated account that performed the action, null only for a system action
-- (section 21). It is on `cell_categories` and `cell_schedules` and deliberately not
-- on `cell_memberships`, for the reason given at that table.
--
-- **This file depends on two things 0001 creates**, `refuse_delete_of_history()` and
-- `network_as_of(uuid, timestamptz)`, and reuses them rather than restating them. The
-- runner reverts newest-first, so 0009's triggers are dropped before 0001's down
-- reaches either function; a `DROP FUNCTION` on one while these triggers stand would
-- fail rather than silently remove a rule, which is the right way round.

-- migrate:up

-- ---------------------------------------------------------------------------
-- Enumerations
--
-- Each is a closed enumeration in SKILL.md, and a closed enumeration in the
-- specification with a free-text column under it is not the same rule (section 25,
-- rules 5-9). Adding a value to any of these is an amendment to the section that
-- owns it, never a convenience.
-- ---------------------------------------------------------------------------

CREATE TYPE cell_state AS ENUM ('ACTIVE', 'CLOSED');

CREATE TYPE cell_category AS ENUM ('YOUTH', 'YOUNG_PRO', 'COUPLE');

-- Section 10, Closure reasons. Multiplication is deliberately absent and must not
-- be added: when a Cell multiplies a disciple opens a new Cell and the original
-- continues, so multiplication creates Cells and never closes one.
CREATE TYPE cell_closure_reason AS ENUM (
  'MERGED_INTO_ANOTHER_CELL',
  'LEADER_STEPPED_DOWN',
  'MEMBERS_DISPERSED',
  'CREATED_IN_ERROR',
  'OTHER'
);

CREATE TYPE cell_request_kind AS ENUM ('NEW_CELL', 'HANDOVER');

CREATE TYPE cell_request_state AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- Section 10, Declining. The list is fixed and not administrator-configurable. It
-- is short and neutral on purpose: a decline is a durable record about a named
-- person, and an unconstrained free-text field is where a judgemental label about a
-- prospective leader would be written (section 1, principle 7).
CREATE TYPE cell_decline_reason AS ENUM (
  'LEADER_DEVELOPMENT_CONTINUING',
  'TIMING_DEFERRED',
  'DUPLICATE_REQUEST',
  'SUBMITTED_IN_ERROR',
  'OTHER'
);

-- ---------------------------------------------------------------------------
-- cells (SKILL.md section 10)
--
-- Leader, category and schedule are deliberately not columns here. Each carries
-- history the specification guarantees and lives in its own effective-dated table:
-- three of the five tables section 26 names as history a column would lose silently
-- are Cell tables.
-- ---------------------------------------------------------------------------

-- Cell IDs are drawn from a sequence: server-assigned, never reused, gaps expected.
-- A rolled-back transaction consumes a value and that is accepted, exactly as for a
-- Member ID (section 10, Cell ID generation; section 3).
CREATE SEQUENCE cell_id_seq AS bigint START WITH 1 NO CYCLE;

CREATE TABLE cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id text NOT NULL UNIQUE
    DEFAULT 'CELL-' || lpad(nextval('cell_id_seq')::text, 6, '0'),
  state cell_state NOT NULL DEFAULT 'ACTIVE',
  closed_at timestamptz,
  closure_reason cell_closure_reason,
  closure_note text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cells_cell_id_format CHECK (cell_id ~ '^CELL-[0-9]{6,}$'),

  -- Stated as an equivalence rather than as two one-way checks, which is what stops
  -- the halves of a closure drifting apart: a CLOSED Cell with no closure date has
  -- no effective date for the leadership and memberships that ended with it, and an
  -- ACTIVE Cell carrying one is a closure somebody started and did not finish.
  CONSTRAINT cells_closed_iff_closed_at
    CHECK ((state = 'CLOSED') = (closed_at IS NOT NULL)),

  -- Section 10 gives the shape as "closure_reason nullable, required where
  -- closed_at is set". The reverse is not decoration: a reason on an open Cell is a
  -- judgement recorded about a Cell that is still running.
  CONSTRAINT cells_closure_reason_iff_closed
    CHECK ((closed_at IS NOT NULL) = (closure_reason IS NOT NULL)),

  CONSTRAINT cells_other_requires_note
    CHECK (closure_reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(closure_note, '')) <> ''),

  -- A note without a reason has nothing to qualify, and would survive as free text
  -- about a Cell with no operational fact attached to it.
  CONSTRAINT cells_note_only_with_reason
    CHECK (closure_note IS NULL OR closure_reason IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- A closure is final, and so is everything a later rule reads off this row
-- (SKILL.md section 10, Reopening; ruling of 2026-08-28).
--
-- Section 10 settled that a Cell closed by mistake is corrected by creating a new
-- Cell, and that "the mistaken closure stands in the record, with the reason and the
-- audit entry it carried". That is a rule an UPDATE can break, so it is a rule the
-- database holds -- the same reasoning that made `member_id` immutable in 0001.
--
-- It covers five columns rather than one, and each is load-bearing for something:
--
--   `state`      -- the rule itself. CLOSED never becomes ACTIVE again.
--   `closed_at`  -- the effective date the leadership and memberships ended on
--                   (section 10, What closing does). Moving it strands them.
--   `closure_reason`, `closure_note`
--                -- the record of why, which section 10 says stands.
--   `cell_id`    -- assigned once and immutable thereafter (section 10, Cell ID
--                   generation), for the reason a Member ID is: it appears in
--                   printed reports and in the memory of the people who use them.
--   `created_at` -- the anchor the schedule trigger below compares against. Moving
--                   it does not merely lose a fact; it retroactively invalidates the
--                   justification for a schedule row that was legal when written,
--                   with nothing that would revisit it.
--
-- Closing an ACTIVE Cell is the one transition permitted, and the four closure
-- columns may be written by that transition and never again.
--
-- **It fires on INSERT as well, and the first version did not.** A `cells` row
-- inserted directly as `CLOSED` satisfied everything: the leadership rule wants
-- zero open assignments for a CLOSED Cell and a fresh row has none, and the
-- configuration rule returns early for anything not `ACTIVE`. The result was a Cell
-- holding a Cell ID off the sequence and no category or schedule row at any point
-- in its history -- so "historical reports must use the category valid at the time
-- being reported" has no answer for it, and section 26 counts both tables among the
-- five that exist so a past period is answerable. Section 10 has no path that mints
-- a Cell already closed: a Cell "is created as ACTIVE", by approval or by the
-- initial-encoding path, and reaches CLOSED only through the transition below.
-- ---------------------------------------------------------------------------

CREATE FUNCTION cells_record_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION
        'cell % cannot be created as %: a Cell is created as ACTIVE and reaches '
        'CLOSED only by being closed (SKILL.md section 10, Creating a Cell). A Cell '
        'born closed has no category or schedule row for any period of its life.',
        NEW.id, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN
    RAISE EXCEPTION 'cell_id is immutable (cell %, % -> %)',
      OLD.id, OLD.cell_id, NEW.cell_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'created_at is immutable (cell %): a schedule row may start at it '
      '(SKILL.md section 10, Schedule changes)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'CLOSED'
     AND (NEW.state IS DISTINCT FROM OLD.state
          OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
          OR NEW.closure_reason IS DISTINCT FROM OLD.closure_reason
          OR NEW.closure_note IS DISTINCT FROM OLD.closure_note) THEN
    RAISE EXCEPTION
      'cell % is closed, and a closure is never reversed or rewritten (SKILL.md '
      'section 10, Reopening). Where a ministry restarts, create a new Cell.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cells_final_record
  BEFORE INSERT OR UPDATE ON cells
  FOR EACH ROW EXECUTE FUNCTION cells_record_is_final();

-- ---------------------------------------------------------------------------
-- cell_categories (SKILL.md section 10, Category changes)
--
-- A category change takes effect on the date it is made, not at the start of the
-- following month: nothing derives a count of scheduled meetings from a category,
-- so there is no figure a mid-month change would silently rewrite. That is why this
-- table carries no equivalent of the schedule trigger below.
-- ---------------------------------------------------------------------------

CREATE TABLE cell_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES cells (id),
  category cell_category NOT NULL,
  actor_id uuid REFERENCES accounts (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT cell_categories_period_ordered
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One open category per Cell (section 5, the effective-dated constraint list).
CREATE UNIQUE INDEX cell_categories_one_open
  ON cell_categories (cell_id)
  WHERE ended_at IS NULL;

-- "Historical reports must use the category valid at the time being reported"
-- (section 10), which is an as-of read by Cell across a period.
CREATE INDEX cell_categories_as_of_idx
  ON cell_categories (cell_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- cell_schedules (SKILL.md section 10, Schedule changes)
--
-- **Two columns beyond the shape section 10 gives, and both are amendments made in
-- this change rather than drift.** Section 10's block lists `cell_id`,
-- `day_of_week`, `time_of_day`, `started_at` and `ended_at`. `id` is added because
-- every other effective-dated table in this schema has a primary key and this one
-- has no natural one; `actor_id` because section 10 says a schedule change "is
-- audited as a category change is", and `cell_categories` carries the actor. A
-- shape is amended when a rule needs a column, deliberately and in the same change
-- (ruling of 2026-08-21); section 10 is amended here.
-- ---------------------------------------------------------------------------

CREATE TABLE cell_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES cells (id),

  -- ISO 8601 day number: 1 is Monday, 7 is Sunday. A calendar week begins on Monday
  -- (section 20), and this is `EXTRACT(ISODOW FROM ...)`, so deriving a month's
  -- scheduled meetings is a comparison against the calendar rather than a mapping
  -- table (sections 12 and 13). An enum was rejected for that reason: every use of
  -- this column is arithmetic against a date.
  day_of_week smallint NOT NULL,

  -- Wall-clock time, with no zone of its own. A leader means seven in the evening
  -- where they are, and section 20 makes Asia/Manila the zone every date derivation
  -- uses; a `timetz` would fix an offset onto a recurring local time, which is the
  -- one thing a standing weekly schedule does not mean.
  time_of_day time NOT NULL,

  actor_id uuid REFERENCES accounts (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,

  CONSTRAINT cell_schedules_day_of_week_iso
    CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT cell_schedules_period_ordered
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One open schedule per Cell (section 10, named there as a required constraint).
CREATE UNIQUE INDEX cell_schedules_one_open
  ON cell_schedules (cell_id)
  WHERE ended_at IS NULL;

-- A past month's coverage figure reads the schedule in force during that month
-- (section 10), which is an as-of read by Cell.
CREATE INDEX cell_schedules_as_of_idx
  ON cell_schedules (cell_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- A schedule row starts on the first of a month in Asia/Manila, or at the Cell's
-- `created_at` (SKILL.md section 10, Schedule changes; ruling of 2026-08-28).
--
-- **A trigger rather than a check constraint**, because the second half compares
-- against a column on another table, which a row-level check cannot see.
--
-- **The two halves are in different frames, and the zone is not optional.** "First
-- day of a month" is a calendar-day test and section 20 makes every date derivation
-- Asia/Manila, so a legitimate row starts at Manila 00:00 on the 1st -- stored as
-- 16:00 UTC on the last day of the *previous* month. A trigger comparing
-- `date_trunc('month', ...)` in UTC would refuse every schedule change there is,
-- while admitting a Cell *created* during a working day on the 1st by accident: the
-- defect would hide in exactly the rows the rule is not about. `created_at` is an
-- instant and needs no conversion.
--
-- **The test is the Cell's `created_at`, not whether the row is the Cell's first**,
-- and the difference is not pedantic. Correcting a first schedule row entered
-- wrongly closes it and opens the right one at the same instant (section 5), so the
-- corrective row is the Cell's *second* and still belongs at approval. A first-row
-- test refuses it; this admits it, and admits any number of later corrections to
-- the same instant.
--
-- **Strict, with no backdating exception**, which the specification reached after an
-- earlier draft made it advisory. Every legitimate row starts on a first of month, a
-- correction included, because a schedule change takes effect at the start of the
-- following month. `records.backdate_effective_date` governs how far back an
-- effective date may be set, which is a question about the actor and lives in the
-- domain layer; it does not govern what kind of date is legal, which is this
-- trigger's business alone.
--
-- **Immediate rather than deferred.** It reads `cells.created_at`, which is written
-- before the schedule row in the one transaction that writes both, and which
-- `cells_record_is_final` makes immutable afterwards -- so there is no ordering a
-- deferral would rescue. Firing immediately is also the better failure: deferred, a
-- violation arrives at COMMIT as a raw check_violation, which this repository has
-- repeatedly recorded as the 500-instead-of-an-answer failure.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_schedule_starts_at_month_or_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_created timestamptz;
BEGIN
  SELECT c.created_at INTO v_created FROM cells c WHERE c.id = NEW.cell_id;

  -- No such Cell. Say nothing and let the foreign key raise, which names the real
  -- problem; a message about months would send the reader somewhere else.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.started_at = v_created THEN
    RETURN NEW;
  END IF;

  IF NEW.started_at
     = (date_trunc('month', NEW.started_at AT TIME ZONE 'Asia/Manila')
        AT TIME ZONE 'Asia/Manila') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'schedule row for cell % starts at %, which is neither the first of a month in '
    'Asia/Manila nor the Cell''s created_at of % (SKILL.md section 10, Schedule '
    'changes). A schedule change takes effect at the start of the following month.',
    NEW.cell_id, NEW.started_at, v_created
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER cell_schedules_start_is_legal
  BEFORE INSERT OR UPDATE ON cell_schedules
  FOR EACH ROW EXECUTE FUNCTION assert_schedule_starts_at_month_or_creation();

-- ---------------------------------------------------------------------------
-- cell_leaderships (SKILL.md section 11)
-- ---------------------------------------------------------------------------

CREATE TABLE cell_leaderships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  cell_id uuid NOT NULL REFERENCES cells (id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT cell_leaderships_period_ordered
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- The *at most one* half of section 11's rule (section 5, the constraint list). The
-- *at least one* half is the deferred trigger below, because no unique index
-- constrains a row that is absent.
CREATE UNIQUE INDEX cell_leaderships_one_open_per_cell
  ON cell_leaderships (cell_id)
  WHERE ended_at IS NULL;

-- "A person is a current Cell Leader when they have at least one active leadership
-- assignment on an ACTIVE Cell" (section 11). Not unique: a Cell Leader may lead
-- many Cells, and section 10 says in terms never to assume otherwise.
CREATE INDEX cell_leaderships_open_by_person
  ON cell_leaderships (person_id)
  WHERE ended_at IS NULL;

-- As-of resolution for a past period, in both directions: which Cells this person
-- led then, and who led this Cell then.
CREATE INDEX cell_leaderships_person_period
  ON cell_leaderships (person_id, started_at DESC, ended_at);

CREATE INDEX cell_leaderships_cell_period
  ON cell_leaderships (cell_id, started_at DESC, ended_at);

-- ---------------------------------------------------------------------------
-- cell_memberships (SKILL.md section 10, Cell Membership)
-- ---------------------------------------------------------------------------

CREATE TABLE cell_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons (id),
  cell_id uuid NOT NULL REFERENCES cells (id),
  -- Section 10 gives this as "source/reason (optional)". Free text, and optional,
  -- because it explains an ordinary move rather than recording a judgement; the
  -- fixed lists in this file are the ones attached to a durable statement about a
  -- named person (section 1, principle 7).
  reason text,
  -- **No `actor_id`, deliberately**, and it was removed rather than never
  -- considered. Section 10's shape does not give one, and section 10 says instead
  -- that "every membership change is audit logged with actor, person, Cell, and
  -- effective date" -- which is an `audit_log` entry. `pastoral_assignments` is the
  -- closest analogue in this schema, the most heavily audited relationship in the
  -- system, and it carries no actor column for exactly that reason. Adding one here
  -- would be amending a shape that no rule needs amended, which is the drift the
  -- 2026-08-21 slot ruling forbids. `cell_categories` and `cell_schedules` differ
  -- because section 10 gives each of them an `actor_id` in its own shape -- the
  -- second by the amendment this change makes, and on the ground section 10 already
  -- states, that a schedule change is audited as a category change is.
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT cell_memberships_period_ordered
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- "A Cell member is assigned to exactly one active Cell Group at a time", and zero
-- is legitimate (section 10). Over the person rather than over the Cell, exactly as
-- pastoral assignment does -- which is what makes a move that leaves two open rows
-- impossible rather than merely discouraged, including under concurrent writes.
CREATE UNIQUE INDEX cell_memberships_one_open
  ON cell_memberships (person_id)
  WHERE ended_at IS NULL;

-- The roster of a Cell today, which is the leader's own screen.
CREATE INDEX cell_memberships_open_by_cell
  ON cell_memberships (cell_id)
  WHERE ended_at IS NULL;

-- "The roster for a meeting is exactly the people holding an active membership of
-- that Cell on the meeting date" (section 10), which is an as-of read by Cell.
CREATE INDEX cell_memberships_cell_period
  ON cell_memberships (cell_id, started_at DESC, ended_at);

CREATE INDEX cell_memberships_person_period
  ON cell_memberships (person_id, started_at DESC, ended_at);

-- ---------------------------------------------------------------------------
-- cell_leadership_requests (SKILL.md section 10, Creating a Cell)
--
-- **One table, two kinds**, and the name says what the workflow is about. Both
-- kinds carry the same state machine, the same decline reasons, the same approver
-- and the same two steps; splitting them would duplicate all four and let them
-- drift. `kind` decides which columns are required.
--
-- `requested_by` and `decided_by` reference `accounts`, as every actor column in
-- this schema does. **That is why the self-naming prohibition is not here.** Section
-- 10 forbids any holder of the capability, at any scope, from naming themselves --
-- but `prospective_leader_id` is a Person and `requested_by` is an Account, and no
-- check constraint spans that boundary. It is a domain check in `cells`, named here
-- so it does not read as forgotten. `decided_by <> requested_by` is expressible,
-- because both sides are accounts, and it is below.
-- ---------------------------------------------------------------------------

CREATE TABLE cell_leadership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind cell_request_kind NOT NULL,
  prospective_leader_id uuid NOT NULL REFERENCES persons (id),
  requested_by uuid NOT NULL REFERENCES accounts (id),

  category cell_category,
  day_of_week smallint,
  time_of_day time,

  state cell_request_state NOT NULL DEFAULT 'PENDING',
  decline_reason cell_decline_reason,
  note text,
  decided_by uuid REFERENCES accounts (id),

  -- "Required where kind is HANDOVER; for NEW_CELL, null until approval sets it"
  -- (section 10). A one-way check rather than an equivalence for that reason: an
  -- approved NEW_CELL row legitimately carries the Cell its approval minted.
  cell_id uuid REFERENCES cells (id),

  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,

  CONSTRAINT cell_leadership_requests_day_of_week_iso
    CHECK (day_of_week IS NULL OR day_of_week BETWEEN 1 AND 7),

  -- Section 10 states this as a check constraint rather than as a note, and gives
  -- the reason: the per-Cell uniqueness rule below is a partial unique index, a null
  -- does not conflict in one, so a HANDOVER row with no Cell would escape the rule
  -- entirely.
  CONSTRAINT cell_leadership_requests_handover_names_a_cell
    CHECK (kind <> 'HANDOVER' OR cell_id IS NOT NULL),

  -- An equivalence in both directions. A NEW_CELL request carries the category, day
  -- and time section 10 requires of it; a HANDOVER carries none of them, because
  -- "nothing else about the Cell changes" -- it keeps its category history and its
  -- schedule history, neither of which is a fact about who leads it. A handover
  -- carrying a day and a time is a request promising something the workflow does
  -- not do.
  CONSTRAINT cell_leadership_requests_new_cell_configuration
    CHECK (
      (kind = 'NEW_CELL')
      = (category IS NOT NULL AND day_of_week IS NOT NULL AND time_of_day IS NOT NULL)
    ),

  -- ...and never part of one. The equivalence above is satisfied by a HANDOVER
  -- carrying a day and a time but no category, which is a request half-describing a
  -- Cell it will not configure. Stated separately because one constraint cannot
  -- forbid partial configuration and require whole configuration at once without
  -- becoming unreadable.
  CONSTRAINT cell_leadership_requests_configuration_is_whole
    CHECK (
      (category IS NULL) = (day_of_week IS NULL)
      AND (category IS NULL) = (time_of_day IS NULL)
    ),

  -- A decision has a decider and a date; a PENDING request has neither. Stated as
  -- equivalences because both halves are wrong: a decided request with no decider
  -- loses who took a durable decision about a named person, and a PENDING one
  -- carrying a decider records a decision that has not been made.
  CONSTRAINT cell_leadership_requests_decided_by_iff_decided
    CHECK ((state = 'PENDING') = (decided_by IS NULL)),
  CONSTRAINT cell_leadership_requests_decided_at_iff_decided
    CHECK ((state = 'PENDING') = (decided_at IS NULL)),

  -- "No actor may approve a request they submitted" (section 10). Section 10 is
  -- explicit that this is the enforceable control and is what must be checked on
  -- every approval -- do not rely instead on the two capabilities never meeting in
  -- one actor, because separation expressed only through role defaults is separation
  -- an Admin-issued grant can undo.
  --
  -- **Approval only, and the first version of this file said "either way".** That
  -- extended section 10 by fiat in a comment -- a domain rule invented in a
  -- migration, which is the failure CLAUDE.md names in its own preamble -- and it
  -- was not merely unauthorised, it was terminal. Section 7 gives Admin
  -- `cell.request_leadership` and gives `cell.approve_leadership` to Admin alone, so
  -- on a single-Admin deployment a request that Admin submits can be approved by
  -- nobody (correctly) and, with that constraint, declined by nobody either. It
  -- stays PENDING for ever, and `..._one_pending_new_cell` then blocks every future
  -- NEW_CELL request for that prospective leader, permanently. `SUBMITTED_IN_ERROR`
  -- exists in the fixed decline list for exactly that case, and the constraint made
  -- it unreachable for the actor most likely to need it.
  --
  -- Whether a requester may decline their own request is a real question and it is
  -- escalated rather than answered here (CLAUDE.md, Open). Until it is settled the
  -- database enforces what section 10 states and nothing more.
  CONSTRAINT cell_leadership_requests_approver_is_not_requester
    CHECK (state <> 'APPROVED' OR decided_by IS DISTINCT FROM requested_by),

  -- "For NEW_CELL, null until approval sets it" (section 10). The `HANDOVER` half
  -- is the check above; this is the half the first version of this file quoted and
  -- did not implement, having dropped the `state` dimension where both halves are
  -- expressible. Both illegal states were accepted: an APPROVED NEW_CELL with no
  -- Cell, which is an approval that minted nothing, and a PENDING NEW_CELL already
  -- naming one, which is a Cell that exists before the decision to create it.
  --
  -- A DECLINED NEW_CELL carries none either, because a decline creates no Cell.
  CONSTRAINT cell_leadership_requests_new_cell_names_its_cell_at_approval
    CHECK (kind <> 'NEW_CELL' OR state <> 'APPROVED' OR cell_id IS NOT NULL),
  CONSTRAINT cell_leadership_requests_new_cell_has_no_cell_before_approval
    CHECK (kind <> 'NEW_CELL' OR state = 'APPROVED' OR cell_id IS NULL),

  -- A decline carries a reason from the fixed list, and nothing else does.
  CONSTRAINT cell_leadership_requests_reason_iff_declined
    CHECK ((state = 'DECLINED') = (decline_reason IS NOT NULL)),
  CONSTRAINT cell_leadership_requests_other_requires_note
    CHECK (decline_reason IS DISTINCT FROM 'OTHER' OR btrim(coalesce(note, '')) <> ''),
  CONSTRAINT cell_leadership_requests_note_only_with_reason
    CHECK (note IS NULL OR decline_reason IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- What a request asked is immutable, and a decision is never withdrawn
-- (SKILL.md section 10, Declining).
--
-- **The first version of this file refused a DELETE here and never considered an
-- UPDATE**, one table after `cells_record_is_final` was written for precisely that
-- reason. Section 10 says declined requests "are retained -- they are part of the
-- record of how a leader was developed", and an UPDATE setting the row back to
-- PENDING with the decision columns nulled erases who declined, when, and why, and
-- returns the row to the queue. Deleting it and rewriting it to nothing are the same
-- act by two routes, and only one was closed.
--
-- Two rules, and they differ in when they bite:
--
--   Its kind, the person it names, who submitted it and when are immutable from the
--   moment it is written. Editing any of those turns one person's request into
--   another's, keeping the original's audit trail. **Deliberately not the category,
--   day and time**: those are what a NEW_CELL request asks *for*, section 10 puts no
--   rule on revising them before a decision, and freezing them would forbid
--   correcting a mistyped time without declining and resubmitting.
--
--   The *decision* is immutable once made. While PENDING the decision columns are
--   writable, because recording a decision is what writes them.
--
-- **This does not settle whether a decision may legitimately be revised** -- whether
-- a DECLINED request may later be approved, or an APPROVED one re-decided. Section
-- 10 does not say, and the conservative direction is taken rather than left to fall
-- out of an omission: a relaxation must not become a capability by omission, which
-- is the reasoning of the 2026-08-24 ruling on an explicit null birthday. It is
-- escalated in CLAUDE.md, and if the answer is that a re-decision path should exist,
-- it arrives as a deliberate amendment rather than as a gap nobody noticed.
-- ---------------------------------------------------------------------------

CREATE FUNCTION cell_leadership_request_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.prospective_leader_id IS DISTINCT FROM OLD.prospective_leader_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION
      'request %: its kind, the person it names, who submitted it and when are '
      'immutable (SKILL.md section 10). Decline it and submit another.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state <> 'PENDING' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION
      'request % was already decided (%): a decision is not withdrawn or rewritten, '
      'and a declined request is retained as part of the record of how a leader was '
      'developed (SKILL.md section 10, Declining).',
      OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cell_leadership_requests_final
  BEFORE UPDATE ON cell_leadership_requests
  FOR EACH ROW EXECUTE FUNCTION cell_leadership_request_is_final();

-- **Two uniqueness rules, one per kind, and they are not the same rule** (section
-- 10). Each answers the ambiguity its own kind actually has, and neither is widened
-- to cover both: a pending new Cell for a person and a pending handover of some
-- other Cell to the same person are different questions about different Cells, both
-- legitimate. Widening the first across kinds would make the second unsubmittable
-- rather than declinable, and `DUPLICATE_REQUEST` exists precisely so that a person
-- adjudicates a case like that rather than an index refusing it.

-- Two pending NEW_CELL requests for one person are indistinguishable downstream:
-- both may be approved and nothing catches the duplicate, because a leader may
-- legitimately lead many Cells.
CREATE UNIQUE INDEX cell_leadership_requests_one_pending_new_cell
  ON cell_leadership_requests (prospective_leader_id)
  WHERE state = 'PENDING' AND kind = 'NEW_CELL';

-- Two pending HANDOVER requests for one Cell are contradictory rather than
-- indistinguishable: both may be approved, and the second silently ends the
-- leadership the first opened.
CREATE UNIQUE INDEX cell_leadership_requests_one_pending_handover
  ON cell_leadership_requests (cell_id)
  WHERE state = 'PENDING' AND kind = 'HANDOVER';

-- The Admin queue (section 19). A pending request holds up a real leader's account
-- provisioning, so the person who can act on it must be able to see it.
CREATE INDEX cell_leadership_requests_pending
  ON cell_leadership_requests (requested_at)
  WHERE state = 'PENDING';

-- A request's outcome appears to the requester in their own outstanding work
-- (section 19).
CREATE INDEX cell_leadership_requests_by_requester
  ON cell_leadership_requests (requested_by, requested_at DESC);

-- ---------------------------------------------------------------------------
-- An ACTIVE Cell has exactly one leadership assignment; a CLOSED Cell has none
-- (SKILL.md section 11; ruling of 2026-08-28).
--
-- "Not at most one: a Cell with no leader is not a state this system has, and it
-- must be impossible rather than merely unusual." Three rules lose their subject at
-- once if it is possible -- `cell.manage_membership` is held first of all by the
-- Cell's current leader; a Cell takes its Network from its leader, which is what the
-- membership trigger below compares against; and Cell attendance is recorded by a
-- leader against their own Cell.
--
-- **Deferred, and that is what lets a Cell change hands at all.** Ending one
-- assignment and opening another leaves the Cell momentarily with none, and a check
-- firing at COMMIT sees only the state the transaction ends in. Any operation
-- replacing a Cell's leader is therefore a single transaction, whatever workflow
-- authorizes it.
--
-- **A trigger is the weaker mechanism and it is chosen knowing that.** This
-- repository has twice replaced a constraint trigger with a denormalized column
-- under a partial unique index -- the Senior Pastor slot and the Network root seat --
-- because `pg_restore --disable-triggers` skips a trigger and never skips an index.
-- Both of those enforce *at most one of something*, which is what a unique index
-- expresses. This rule is the opposite shape: "at least one" is a statement about a
-- row that is **absent**, and no index constrains an absence. A `cells.leader_id`
-- column would have to be non-null, which forbids the momentary state a change of
-- leader passes through, and would still need a two-table check to stay honest
-- against `cell_leaderships`. The restore weakness is accepted rather than designed
-- around, and what makes it tolerable is that a leaderless Cell is visible: every
-- screen that names a Cell names its leader.
--
-- **This counts rows, and the 2026-08-21 ruling says a counting trigger is not a
-- constraint. That ruling is about the other direction, and the difference is
-- re-derived here rather than assumed** (section 25, rule 19). The failure it
-- records is two concurrent transactions each counting *below* a cap, neither seeing
-- the other's uncommitted row, both committing, and the cap being exceeded. Here the
-- cap -- at most one open row per Cell -- is held by
-- `cell_leaderships_one_open_per_cell`, a unique index, which is exactly the remedy
-- that ruling reached for. What this trigger adds is the floor, and the floor cannot
-- be undershot concurrently: reaching zero means closing the single open row, and
-- the index permits only one such row, so only one transaction can close it. Where a
-- second transaction opens a replacement it has not committed, this one raises --
-- conservatively and correctly, since section 11 requires the replacement to happen
-- in the same transaction as the close.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_cell_leadership_matches_state(p_cell_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_state cell_state;
  v_open bigint;
BEGIN
  SELECT c.state INTO v_state FROM cells c WHERE c.id = p_cell_id;

  -- Unreachable while `cells_no_delete` stands, and kept as a cheap guard rather
  -- than by borrowing 0001's justification for its equivalent branch, which does not
  -- hold here.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_open
    FROM cell_leaderships cl
   WHERE cl.cell_id = p_cell_id
     AND cl.ended_at IS NULL;

  IF v_state = 'ACTIVE' AND v_open <> 1 THEN
    RAISE EXCEPTION
      'cell % is ACTIVE and has % open leadership assignment(s): an ACTIVE Cell has '
      'exactly one (SKILL.md section 11). A change of leader is one transaction, '
      'ending the outgoing assignment and opening the incoming one together.',
      p_cell_id, v_open
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_state = 'CLOSED' AND v_open <> 0 THEN
    RAISE EXCEPTION
      'cell % is CLOSED and has % open leadership assignment(s): closing a Cell ends '
      'its leadership assignment on the closure effective date (SKILL.md section 10, '
      'What closing does).',
      p_cell_id, v_open
      USING ERRCODE = 'check_violation';
  END IF;

  -- **The date, not only the count**, which the first version of this file asserted
  -- in a comment and enforced nowhere. `cells_record_is_final` freezes `closed_at`
  -- on the ground that it is "the effective date the leadership and memberships
  -- ended on", and section 10 says twice that both end *on that date*. Counting
  -- alone admitted a leadership assignment ending four hundred days after its Cell
  -- closed -- which by section 11 makes that person a current Cell Leader of a
  -- closed Cell for the whole period, and puts them in every count section 11
  -- governs.
  --
  -- `<=` rather than `=` because a Cell's earlier leaderships legitimately ended
  -- before it closed, at handovers. Equality for the row that was open at closure
  -- follows without being stated: an ACTIVE Cell always holds exactly one open row,
  -- so the only way to reach a closed Cell whose last assignment ended earlier is to
  -- end it in some earlier transaction -- and that transaction is refused by the
  -- ACTIVE branch above, because the Cell was still ACTIVE when it ran.
  IF v_state = 'CLOSED' AND EXISTS (
    SELECT 1
      FROM cell_leaderships cl
      JOIN cells c ON c.id = cl.cell_id
     WHERE cl.cell_id = p_cell_id
       AND cl.ended_at > c.closed_at
  ) THEN
    RAISE EXCEPTION
      'cell % is CLOSED and holds a leadership assignment ending after its closure '
      'date: closing a Cell ends its leadership assignment on the closure effective '
      'date (SKILL.md section 10, What closing does).',
      p_cell_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- A CLOSED Cell holds no open membership, and none ending after it closed
-- (SKILL.md section 10, What closing does).
--
-- **The third bullet of the closure list, which the first version of this file left
-- to nothing.** Section 10 gives closure as one transaction doing three things: the
-- state becomes CLOSED, the leadership assignment ends on that date, and "active
-- memberships end on that date, preserving every membership record in full". The
-- second was enforced above and the third by nothing at all -- so a Cell could be
-- closed with its members still in it, and a membership could be opened into an
-- already-closed Cell.
--
-- The consequence is the one section 10 names in terms. The roster for a meeting is
-- "exactly the people holding an active membership of that Cell on the meeting
-- date", and `cell_memberships_one_open` is over the *person* -- so somebody left
-- open in a closed Cell can be given a membership nowhere else, which is the "never
-- silently drop a person out of every Cell" failure that index exists to prevent,
-- reached from the other side.
--
-- Separate from the leadership rule rather than folded into it, because the two are
-- different shapes: an ACTIVE Cell must have exactly one leader and may have any
-- number of members, zero included. Only the CLOSED half is symmetrical.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_cell_memberships_match_state(p_cell_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_state cell_state;
  v_closed_at timestamptz;
  v_open bigint;
BEGIN
  -- **`FOR SHARE`, and the first version of this function did not have it.** The
  -- leadership rule above is a counting trigger and is safe anyway, because the two
  -- writes that could break it contend on one row: closing a Cell ends its single
  -- open leadership, and anything opening a replacement must update that same row
  -- first, so the two serialize on its lock.
  --
  -- **That argument was reused here and its premise does not hold.**
  -- `cell_memberships_one_open` is over `person_id`, not `cell_id`, so closing a Cell
  -- and adding a member to it touch no row in common. Under READ COMMITTED neither
  -- deferred check sees the other's uncommitted work: the closer counts zero open
  -- memberships, the adder reads the Cell as still ACTIVE and returns early, and both
  -- commit -- leaving a member open in a closed Cell, who can then join no other,
  -- which is the exact outcome this rule exists to prevent. Reproduced against the
  -- schema before this lock was added.
  --
  -- Reusing a shape without re-deriving why it had that shape is section 25 rule 19,
  -- and it happened here inside the paragraph that cites it.
  --
  -- `FOR SHARE` rather than `FOR UPDATE`: two transactions adding members to the same
  -- Cell must not block each other, and a share lock does not conflict with itself.
  -- It does conflict with the row lock a closure's `UPDATE cells` holds, which is the
  -- only ordering needed -- the adder waits for the closer, then re-reads the state
  -- and refuses.
  --
  -- **Two costs come with it, and both are stated here rather than left to be met.**
  -- Neither is reachable today, because no endpoint writes these tables; both must be
  -- answered by the closure endpoint, and both are escalated in CLAUDE.md.
  --
  -- **It can deadlock on section 10's own closure operation.** Closure requires the
  -- members to be presented and "assigned to another Cell in bulk", so a transaction
  -- routinely closes one Cell and writes memberships into another. Two leaders doing
  -- that into each other's Cells take the two `cells` rows in opposite orders -- the
  -- closure's `UPDATE` on its own, this `FOR SHARE` on the other's -- and PostgreSQL
  -- picks a victim with `40P01`. `isLockTimeout` in `common/errors/postgres-errors.ts`
  -- matches `55P03` only, deliberately, so a deadlock renders `INTERNAL_ERROR` today.
  -- The remedy is the shape section 5 already uses for the person lock -- both paths
  -- taking the rows in a defined order -- plus a decision about `40P01`, which
  -- CLAUDE.md carries as open and which this makes reachable from an ordinary
  -- operation rather than only from the import.
  --
  -- **And it is an unbounded wait inside a transaction**, which section 5 makes a
  -- requirement to bound: `lock_timeout` is set in exactly one place in this
  -- repository, inside `lockPersonsWithin`, and a membership write has no reason to
  -- take a person lock. A closer left idle in a transaction blocks this one for ever
  -- while it holds one of section 24's ten connections.
  SELECT c.state, c.closed_at INTO v_state, v_closed_at
    FROM cells c WHERE c.id = p_cell_id FOR SHARE;

  IF NOT FOUND OR v_state <> 'CLOSED' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_open
    FROM cell_memberships cm
   WHERE cm.cell_id = p_cell_id
     AND cm.ended_at IS NULL;

  IF v_open <> 0 THEN
    RAISE EXCEPTION
      'cell % is CLOSED and has % open membership(s): closing a Cell ends its active '
      'memberships on the closure effective date, preserving every record in full '
      '(SKILL.md section 10, What closing does). A person left in a closed Cell can '
      'join no other, because a person holds at most one open membership.',
      p_cell_id, v_open
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM cell_memberships cm
     WHERE cm.cell_id = p_cell_id
       AND cm.ended_at > v_closed_at
  ) THEN
    RAISE EXCEPTION
      'cell % is CLOSED and holds a membership ending after its closure date '
      '(SKILL.md section 10, What closing does).',
      p_cell_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Named for both rules it now carries. The first version was
-- `assert_cell_leadership_from_cells`, which stopped describing it the moment the
-- membership check was added beside the leadership one -- and a trigger whose name
-- says less than it does is how the next reader concludes the membership half is
-- unenforced.
CREATE FUNCTION assert_cell_relationships_from_cells() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_cell_leadership_matches_state(NEW.id);
  PERFORM assert_cell_memberships_match_state(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_memberships_from_memberships() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_cell_memberships_match_state(NEW.cell_id);

  IF TG_OP = 'UPDATE' AND OLD.cell_id IS DISTINCT FROM NEW.cell_id THEN
    PERFORM assert_cell_memberships_match_state(OLD.cell_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_cell_leadership_from_leaderships() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_cell_leadership_matches_state(NEW.cell_id);

  -- A leadership row moved between Cells leaves the Cell it came from as much a
  -- subject of this rule as the one it went to. No operation in section 10 or 11
  -- moves one, and checking costs a statement on a path nothing takes.
  IF TG_OP = 'UPDATE' AND OLD.cell_id IS DISTINCT FROM NEW.cell_id THEN
    PERFORM assert_cell_leadership_matches_state(OLD.cell_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cells_relationships_match_state
  AFTER INSERT OR UPDATE ON cells
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_cell_relationships_from_cells();

CREATE CONSTRAINT TRIGGER cell_leaderships_match_cell_state
  AFTER INSERT OR UPDATE ON cell_leaderships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_cell_leadership_from_leaderships();

CREATE CONSTRAINT TRIGGER cell_memberships_match_cell_state
  AFTER INSERT OR UPDATE ON cell_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_memberships_from_memberships();

-- ---------------------------------------------------------------------------
-- An ACTIVE Cell has an open category row and an open schedule row
-- (SKILL.md section 10, Creating a Cell).
--
-- "The category and schedule rows are not optional extras. A Cell created without a
-- schedule row has no derivable set of scheduled meetings, and therefore no coverage
-- figure for its first month." docs/ROADMAP.md names that omission as the single
-- named risk of this stage, which is a reason to make it impossible rather than a
-- reason to remember it.
--
-- **It constrains the ACTIVE side only, and the silence is deliberate.** Section 11
-- says what a CLOSED Cell's leadership is -- none -- so that trigger states both
-- halves. For these two the specification says less: section 10's "What closing
-- does" lists three writes and neither of these is among them, while a parenthetical
-- about coverage says a Cell closed part-way through a month has fewer scheduled
-- meetings "because its schedule row ... ends at closure". Those do not plainly
-- agree, and a trigger asserting the closed half would settle a rule this file has
-- no authority to settle. Recorded as an open question rather than guessed at.
--
-- Deferred for the same reason as the leadership trigger: section 10 opens the Cell
-- and both rows in one transaction, and the Cell is written first.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_active_cell_is_configured(p_cell_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_state cell_state;
BEGIN
  SELECT c.state INTO v_state FROM cells c WHERE c.id = p_cell_id;

  IF NOT FOUND OR v_state <> 'ACTIVE' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cell_categories cc
     WHERE cc.cell_id = p_cell_id AND cc.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cell % is ACTIVE with no open category row (SKILL.md section 10, Creating a '
      'Cell). The category history row opens in the same transaction as the Cell.',
      p_cell_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cell_schedules cs
     WHERE cs.cell_id = p_cell_id AND cs.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'cell % is ACTIVE with no open schedule row (SKILL.md section 10, Creating a '
      'Cell). Without one the Cell has no derivable set of scheduled meetings and no '
      'coverage figure for its first month.',
      p_cell_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION assert_configured_from_cells() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_active_cell_is_configured(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION assert_configured_from_configuration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_active_cell_is_configured(NEW.cell_id);

  IF TG_OP = 'UPDATE' AND OLD.cell_id IS DISTINCT FROM NEW.cell_id THEN
    PERFORM assert_active_cell_is_configured(OLD.cell_id);
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cells_are_configured
  AFTER INSERT OR UPDATE ON cells
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configured_from_cells();

CREATE CONSTRAINT TRIGGER cell_categories_keep_cell_configured
  AFTER INSERT OR UPDATE ON cell_categories
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configured_from_configuration();

CREATE CONSTRAINT TRIGGER cell_schedules_keep_cell_configured
  AFTER INSERT OR UPDATE ON cell_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_configured_from_configuration();

-- ---------------------------------------------------------------------------
-- A member and their Cell's leader share a Network
-- (SKILL.md section 10, Managing Cell membership; section 4).
--
-- The homogeneous-network rule reaches Cell membership as it reaches a pastoral
-- edge, and this is `assert_assignment_same_network` from 0001 applied to the other
-- relationship. It compares as of the membership's own `started_at`, for that
-- trigger's reason: a membership must have been legal when it was opened, and
-- validating against `now()` would reject a correction that was true at the time.
--
-- **The Cell's Network is its leader's** (section 11), and that is stable across the
-- Cell's life rather than merely stable in practice: section 10 makes approval of a
-- handover reject "where the incoming leader and the Cell's current leader do not
-- share a Network", so no operation this specification defines moves a Cell between
-- Networks.
--
-- **Deferred**, because a Cell, its leadership row and its first memberships may be
-- written in one transaction, and a check firing per statement would reject whichever
-- landed before the leadership row it reads.
--
-- **Two other writes can break this rule, and the first version of this file named
-- only one of them.** It said the uncovered direction was a Network change, and sent
-- the reader to `networks` -- accurate about the path it named, silent about a path
-- half of which is in this module.
--
--   A **Network change on the member** writes `network_assignments`, which this
--   trigger does not fire on. That one is a precondition in `networks`, the second
--   half of the one Stage 2 built for pastoral relationships, and docs/ROADMAP.md
--   carries it as its own Stage 3 item.
--
--   A **cross-Network handover** writes `cell_leaderships`, a table this migration
--   owns and creates. Section 10 makes the refusal explicit rather than incidental --
--   approval must reject a handover "where the incoming leader and the Cell's current
--   leader do not share a Network" -- and it is expressible here, so it is enforced
--   here rather than left to an approval endpoint that does not exist. That is the
--   trigger below.
--
--   A **Network change on the Cell's leader** writes `network_assignments` and is
--   the widest of the three: it moves the Cell's own Network, so every member of
--   every Cell that person leads is stranded at once. Nothing covers it. Section 4
--   refuses a Network change while the person leads anyone *pastorally*, and leading
--   a Cell is a different relationship (section 1, principle 3) that no rule refuses.
--   Which side moves -- refuse the change while they lead a Cell, or hand the Cell
--   over first -- is a pastoral decision section 4 does not make, and it is escalated
--   in CLAUDE.md rather than guessed at here.
--
-- **The first version of this comment named the second path and implemented it as a
-- check on the members rather than on the leaders**, which is not the rule section 10
-- states: a Cell with no members changed Networks freely. The second version of the
-- comment named two of the three paths. Both are recorded rather than tidied, because
-- the fault is the one this repository keeps recording -- a rule written from the
-- part of the mechanism being looked at.
-- ---------------------------------------------------------------------------

CREATE FUNCTION assert_membership_same_network() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row cell_memberships%ROWTYPE;
  v_leader uuid;
  v_member network;
  v_leader_network network;
BEGIN
  -- Deferred to commit, so read the row as it finally stands rather than as it stood
  -- when the statement ran.
  SELECT * INTO v_row FROM cell_memberships WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Who led the Cell at the moment the membership opened.
  -- `cell_leaderships_one_open_per_cell` makes at most one row open at a time, so
  -- this is the leader rather than one of several.
  SELECT cl.person_id INTO v_leader
    FROM cell_leaderships cl
   WHERE cl.cell_id = v_row.cell_id
     AND cl.started_at <= v_row.started_at
     AND (cl.ended_at IS NULL OR cl.ended_at > v_row.started_at)
   ORDER BY cl.started_at DESC
   LIMIT 1;

  IF v_leader IS NULL THEN
    RAISE EXCEPTION
      'cell membership %: cell % had no leader as of %, so the Cell has no Network to '
      'compare against (SKILL.md section 11).',
      v_row.id, v_row.cell_id, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  v_member := network_as_of(v_row.person_id, v_row.started_at);
  v_leader_network := network_as_of(v_leader, v_row.started_at);

  IF v_member IS NULL OR v_leader_network IS NULL THEN
    RAISE EXCEPTION
      'cell membership %: Network is unknown for member % or for the Cell''s leader % as of %',
      v_row.id, v_row.person_id, v_leader, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_member <> v_leader_network THEN
    RAISE EXCEPTION
      'cell membership % crosses Networks: member % is %, and cell % is led by %, who '
      'is %, as of % (SKILL.md section 10, Managing Cell membership).',
      v_row.id, v_row.person_id, v_member, v_row.cell_id, v_leader,
      v_leader_network, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cell_memberships_same_network
  AFTER INSERT OR UPDATE ON cell_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_membership_same_network();

-- The same rule from the other side. A leadership write moves the Cell's Network, so
-- it is validated against the members the Cell already has rather than only against
-- the ones added afterwards.
--
-- **It reads memberships open at the incoming assignment's own start**, which is the
-- instant from which that leader governs. Memberships opened later are validated by
-- their own trigger against the leader then in force, so nothing is checked twice and
-- nothing is missed between the two.
--
-- **Deferred**, and it has to be: section 10 resolves a conflict of this kind by
-- moving the members, and a handover that moves every member out in the same
-- transaction is legal. Firing per statement would reject it on whichever write
-- landed first. At commit those memberships are closed and no longer selected.
--
-- A closing row returns early. Ending an assignment governs nobody, and the incoming
-- row written beside it is what carries the rule.
CREATE FUNCTION assert_leadership_stays_in_network() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row cell_leaderships%ROWTYPE;
  v_leader network;
  v_outgoing_id uuid;
  v_outgoing network;
  v_outgoing_ended_at timestamptz;
  v_member_id uuid;
  v_member network;
BEGIN
  SELECT * INTO v_row FROM cell_leaderships WHERE id = NEW.id;
  IF NOT FOUND OR v_row.ended_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_leader := network_as_of(v_row.person_id, v_row.started_at);

  IF v_leader IS NULL THEN
    RAISE EXCEPTION
      'cell leadership %: Network is unknown for leader % as of %',
      v_row.id, v_row.person_id, v_row.started_at
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row this one succeeds: the latest row for this Cell that had already
  -- started. At a creation there is none and both branches below are skipped.
  --
  -- **`ended_at` is deliberately not in this predicate, and its first version had it
  -- there.** The condition was `ended_at IS NULL OR ended_at >= v_row.started_at`,
  -- which selects the previous row only where the two abut. One microsecond of gap
  -- selected nothing, `FOUND` was false, and the whole leader-to-leader rule below
  -- was skipped -- so a cross-Network handover committed. The rule failed *open*,
  -- which is the worst direction, and silently.
  --
  -- That is not a contrived timestamp. Section 10 records the identical trap two
  -- subsections up, for the Cell and its schedule row: "`created_at DEFAULT now()`
  -- beside an application-computed `started_at` differs by microseconds". Any
  -- approval endpoint that reads the clock twice produces this shape by accident.
  --
  -- The tie-break is part of the rule rather than tidiness. Two rows can share a
  -- `started_at` -- section 5 corrects a row by closing it and opening the right one
  -- at the same instant -- and `ORDER BY started_at DESC` alone then picks between
  -- them arbitrarily, refusing a legitimate handover on some fraction of runs
  -- according to which UUID sorted first. Measured against that shape before the
  -- tie-break existed: two refusals in six.
  --
  -- `ended_at DESC` is what decides it: of two rows starting at one instant the later
  -- one to end is the one in force. `NULLS FIRST` cannot decide a case -- a null there
  -- would be a second open row, which the unique index refuses -- and is written for
  -- what the ordering *means* rather than for a case it settles. `id` makes the order
  -- total.
  SELECT cl.person_id, network_as_of(cl.person_id, v_row.started_at), cl.ended_at
    INTO v_outgoing_id, v_outgoing, v_outgoing_ended_at
    FROM cell_leaderships cl
   WHERE cl.cell_id = v_row.cell_id
     AND cl.id <> v_row.id
     AND cl.started_at <= v_row.started_at
   ORDER BY cl.started_at DESC, cl.ended_at DESC NULLS FIRST, cl.id DESC
   LIMIT 1;

  IF FOUND THEN
    -- **Section 10 in so many words**: on approving a handover "the outgoing
    -- leadership assignment ends, the incoming one opens **at the same instant**".
    -- Nothing carried that, and the gap it left is what let the rule below be
    -- skipped -- so this is the structural fix rather than a second predicate on the
    -- query above.
    --
    -- It also states section 11's rule about the moment rather than about the count.
    -- `assert_cell_leadership_matches_state` counts open rows at COMMIT, so a Cell
    -- that was leaderless for a microsecond passes it while "who led this Cell at
    -- that instant" has no answer -- and section 11 says a Cell with no leader "must
    -- be impossible rather than merely unusual". `assert_membership_same_network`
    -- already treats a leaderless instant as an error from the other side, so the two
    -- halves of the schema disagreed until this.
    --
    -- A null `ended_at` on the predecessor is the overlap rather than the gap: two
    -- rows open at once, which `cell_leaderships_one_open_per_cell` refuses on its
    -- own. **This disjunct therefore decides nothing**, and an earlier version of
    -- this comment claimed it caught the case "where the newer one is written
    -- closed" -- which the early return above makes unreachable, and which
    -- `cell_leadership_is_opened_open` now refuses outright. It is kept as a guard
    -- against a null rather than removed, and the claim is withdrawn.
    IF v_outgoing_ended_at IS NULL OR v_outgoing_ended_at <> v_row.started_at THEN
      RAISE EXCEPTION
        'cell % leadership is not contiguous: the assignment before this one ends at '
        '% and this one starts at % (SKILL.md section 10, On approving a handover -- '
        'the outgoing assignment ends and the incoming one opens at the same '
        'instant; section 11 -- a Cell is never without a leader).',
        v_row.cell_id, v_outgoing_ended_at, v_row.started_at
        USING ERRCODE = 'check_violation';
    END IF;

    -- **The rule section 10 actually states**: reject a handover "where the incoming
    -- leader and the Cell's current leader do not share a Network". Leader to
    -- leader, and unconditional -- it says nothing about members.
    IF v_outgoing IS DISTINCT FROM v_leader THEN
      -- Worded for succession rather than for a handover, because this fires on
      -- every successor row and section 10 states the rule about a handover. The one
      -- other shape that reaches it is a section 5 correction of a Cell's first
      -- leadership row to a person of the other Network, which is refused here and
      -- which section 10 does not settle -- escalated in CLAUDE.md rather than
      -- distinguished by a mechanism this migration does not have. Telling that
      -- administrator to look for a conflict "between two leaders" would send them
      -- after something that is not there.
      RAISE EXCEPTION
        'cell % cannot pass from % (%) to % (%): a Cell takes its Network from its '
        'leader, and the two do not share one (SKILL.md section 10, Creating a Cell -- '
        'a handover is refused where the incoming leader and the Cell''s current '
        'leader do not share a Network). No operation this specification defines moves '
        'a Cell between Networks.',
        v_row.cell_id, v_outgoing_id, v_outgoing, v_row.person_id, v_leader
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- And the members, which is a second rule rather than the same one restated
  -- (section 10, Managing Cell membership). With the two rules above, a Cell's
  -- Network is fixed from its creation -- **which the previous version of this
  -- comment asserted while the code did not deliver it**, the gap above being the
  -- reason. So this is reachable where a member's own Network moved under them, which
  -- is the `networks` gap the comment further up names. It is kept because it states
  -- the invariant section 10 writes about membership directly, rather than leaving it
  -- as a consequence of the leader rule.
  SELECT cm.person_id, network_as_of(cm.person_id, v_row.started_at)
    INTO v_member_id, v_member
    FROM cell_memberships cm
   WHERE cm.cell_id = v_row.cell_id
     AND cm.started_at <= v_row.started_at
     AND (cm.ended_at IS NULL OR cm.ended_at > v_row.started_at)
     AND network_as_of(cm.person_id, v_row.started_at) IS DISTINCT FROM v_leader
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'cell % cannot be led by % (%) from %: member % is % and would be left in a '
      'Cell of the other Network (SKILL.md section 10, Managing Cell membership).',
      v_row.cell_id, v_row.person_id, v_leader, v_row.started_at, v_member_id, v_member
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cell_leaderships_stay_in_network
  AFTER INSERT OR UPDATE ON cell_leaderships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_leadership_stays_in_network();

-- ---------------------------------------------------------------------------
-- Nothing here is deleted (SKILL.md section 5; section 10).
--
-- The four effective-dated tables follow the rule 0001 already states and reuse its
-- function: a row entered in error is corrected by closing it and opening the right
-- one, which is what effective dating is for.
--
-- `cells` and `cell_leadership_requests` are not effective-dated and get a message
-- of their own, because the rule they carry is a different one. Section 10 says a
-- Cell ID is never reused and that a mistaken closure "stands in the record", and it
-- gives `CREATED_IN_ERROR` as the closure reason for a Cell that should not exist --
-- so removing the row is the one operation that would undo both. And declined
-- requests "are retained: they are part of the record of how a leader was
-- developed", which a DELETE ends.
--
-- TRUNCATE fires no row triggers and stays available, because it is how the test
-- suite resets; what is meant to keep it safe is privilege rather than a trigger
-- (section 24, and CLAUDE.md records that the least-privilege role does not exist
-- yet).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A leadership row is opened open, and its end is written once
-- (SKILL.md section 5; section 10, On approving a handover).
--
-- **The two writes the contiguity rule above cannot reach.** That check runs on the
-- row as it finally stands and returns early where the row is closed, which is right
-- for the writes section 10 defines -- a handover opens a row, a closure ends one --
-- and leaves two shapes unvalidated:
--
--   An **INSERT of an already-closed row** passes no contiguity check, no
--   leader-to-leader Network check and no overlap check. Probed against this schema,
--   a closed row overlapping the open one committed, and the consequence was a wrong
--   refusal elsewhere: `assert_membership_same_network` resolves the Cell's leader by
--   the greatest `started_at` in force, so it then read the stray row and refused a
--   legitimate member of the Cell's own Network.
--
--   An **UPDATE moving a closed row's `ended_at`** breaks the chain behind a
--   successor that nothing re-validates. Probed: after a valid handover, moving the
--   outgoing row's end a day later committed, leaving two leaders overlapping by a
--   day with the index and the count both satisfied.
--
-- **Refusing the write rather than validating it**, and the difference matters. No
-- operation section 10 or 11 defines writes a leadership row already closed, and a
-- row already closed is exactly what section 5 says is never overwritten in place.
-- Widening the contiguity check to cover these would mean deciding what a correction
-- to a closed historical stint looks like, which section 10 does not define -- and a
-- relaxation must not become a capability by omission (the 2026-08-24 ruling on an
-- explicit null birthday). Whether such a correction should exist at all is escalated
-- in CLAUDE.md rather than answered by a trigger.
--
-- `ended_at` moving from null to a value is the ordinary close, and is what a
-- handover and a closure both perform. Only a second write to it is refused.
-- ---------------------------------------------------------------------------

CREATE FUNCTION cell_leadership_is_opened_open() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION
        'cell leadership for cell % cannot be created already ended: a leadership '
        'assignment opens open and is ended by a handover or a closure (SKILL.md '
        'section 10, What closing does; On approving a handover).',
        NEW.cell_id
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION
      'cell leadership % has already ended, at %: a row that has been closed is not '
      'overwritten in place (SKILL.md section 5).',
      OLD.id, OLD.ended_at
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cell_leaderships_opened_open
  BEFORE INSERT OR UPDATE ON cell_leaderships
  FOR EACH ROW EXECUTE FUNCTION cell_leadership_is_opened_open();

CREATE FUNCTION refuse_delete_of_cell_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'rows of %.% are never deleted: a Cell that should not exist is closed with '
    'CREATED_IN_ERROR, and a request that should not have been made is declined '
    '(SKILL.md section 10)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER cells_no_delete
  BEFORE DELETE ON cells
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_cell_record();

CREATE TRIGGER cell_leadership_requests_no_delete
  BEFORE DELETE ON cell_leadership_requests
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_cell_record();

CREATE TRIGGER cell_categories_no_delete
  BEFORE DELETE ON cell_categories
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_schedules_no_delete
  BEFORE DELETE ON cell_schedules
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_leaderships_no_delete
  BEFORE DELETE ON cell_leaderships
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

CREATE TRIGGER cell_memberships_no_delete
  BEFORE DELETE ON cell_memberships
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- migrate:down:refuse-if-populated cells cell_categories cell_schedules cell_leaderships cell_memberships cell_leadership_requests

-- This down drops the tables it created, so it is safe only while they are empty.
-- The directive above is not a comment: the runner refuses to apply this section if
-- any table named there holds a row, and says so rather than executing.
--
-- It names all six, including `cell_leadership_requests`, which holds no attendance
-- and no relationship. Declined requests are part of the record of how a leader was
-- developed (section 10), and an operator reaching for `migrate:down` on a database
-- holding them is reaching for the wrong tool.

DROP TRIGGER IF EXISTS cell_memberships_no_delete ON cell_memberships;
DROP TRIGGER IF EXISTS cell_leaderships_opened_open ON cell_leaderships;
DROP FUNCTION IF EXISTS cell_leadership_is_opened_open();
DROP TRIGGER IF EXISTS cell_leaderships_no_delete ON cell_leaderships;
DROP TRIGGER IF EXISTS cell_schedules_no_delete ON cell_schedules;
DROP TRIGGER IF EXISTS cell_categories_no_delete ON cell_categories;
DROP TRIGGER IF EXISTS cell_leadership_requests_final ON cell_leadership_requests;
DROP FUNCTION IF EXISTS cell_leadership_request_is_final();
DROP TRIGGER IF EXISTS cell_leadership_requests_no_delete ON cell_leadership_requests;
DROP TRIGGER IF EXISTS cells_no_delete ON cells;
DROP FUNCTION IF EXISTS refuse_delete_of_cell_record();

DROP TRIGGER IF EXISTS cell_leaderships_stay_in_network ON cell_leaderships;
DROP FUNCTION IF EXISTS assert_leadership_stays_in_network();
DROP TRIGGER IF EXISTS cell_memberships_same_network ON cell_memberships;
DROP FUNCTION IF EXISTS assert_membership_same_network();

DROP TRIGGER IF EXISTS cell_schedules_keep_cell_configured ON cell_schedules;
DROP TRIGGER IF EXISTS cell_categories_keep_cell_configured ON cell_categories;
DROP TRIGGER IF EXISTS cells_are_configured ON cells;
DROP FUNCTION IF EXISTS assert_configured_from_configuration();
DROP FUNCTION IF EXISTS assert_configured_from_cells();
DROP FUNCTION IF EXISTS assert_active_cell_is_configured(uuid);

DROP TRIGGER IF EXISTS cell_memberships_match_cell_state ON cell_memberships;
DROP TRIGGER IF EXISTS cell_leaderships_match_cell_state ON cell_leaderships;
DROP TRIGGER IF EXISTS cells_relationships_match_state ON cells;
DROP FUNCTION IF EXISTS assert_memberships_from_memberships();
DROP FUNCTION IF EXISTS assert_cell_leadership_from_leaderships();
DROP FUNCTION IF EXISTS assert_cell_relationships_from_cells();
DROP FUNCTION IF EXISTS assert_cell_memberships_match_state(uuid);
DROP FUNCTION IF EXISTS assert_cell_leadership_matches_state(uuid);

DROP TRIGGER IF EXISTS cell_schedules_start_is_legal ON cell_schedules;
DROP FUNCTION IF EXISTS assert_schedule_starts_at_month_or_creation();

DROP TABLE IF EXISTS cell_leadership_requests;
DROP TABLE IF EXISTS cell_memberships;
DROP TABLE IF EXISTS cell_leaderships;
DROP TABLE IF EXISTS cell_schedules;
DROP TABLE IF EXISTS cell_categories;

DROP TRIGGER IF EXISTS cells_final_record ON cells;
DROP FUNCTION IF EXISTS cells_record_is_final();
DROP TABLE IF EXISTS cells;
DROP SEQUENCE IF EXISTS cell_id_seq;

DROP TYPE IF EXISTS cell_decline_reason;
DROP TYPE IF EXISTS cell_request_state;
DROP TYPE IF EXISTS cell_request_kind;
DROP TYPE IF EXISTS cell_closure_reason;
DROP TYPE IF EXISTS cell_category;
DROP TYPE IF EXISTS cell_state;
