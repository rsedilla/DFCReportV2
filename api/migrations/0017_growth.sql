-- migrate:up

-- ---------------------------------------------------------------------------
-- Growth: SUYNL lessons, Training graduations and Conquest confirmations
-- (SKILL.md sections 27 and 28; rulings of 2026-09-16, decisions 0249 and 0250)
--
-- Three tables owned by three modules — `suynl`, `training` and `conquest` —
-- grouped on one screen and never in one module (section 28: `Growth` is a label
-- on a sidebar item and never a module).
--
-- **Every row is a statement by a leader, and none is ever deleted.** Each table
-- carries the same five columns for that: who the statement is about, whose
-- statement it is, which account filed it, when, and — where it was later
-- withdrawn — the correction that superseded it. Section 28 requires the
-- no-delete trigger here rather than in application code, and a CHECK keeps the
-- three correction columns set together or not at all.
--
-- **Partial uniqueness over live rows**, as section 5 uses for an active pastoral
-- assignment: one current row per person and lesson, per person and program, and
-- per person and goal. A superseded row stays, so a person may carry many.
-- ---------------------------------------------------------------------------

CREATE TYPE training_program AS ENUM (
  'ENCOUNTER',
  'LIFE_CLASS',
  'SOL_1',
  'SOL_2',
  'SOL_3'
);

-- The four goals of section 27, in its ladder order.
CREATE TYPE conquest_goal AS ENUM (
  'WIN_3',
  'OPEN_A_CELL',
  'COMPLETION_OF_12',
  'RAISE_12_LEADERS'
);

-- The nine capabilities sections 27 and 28 add, in the order section 7 lists
-- them. `capabilities.ts` says these join the enum in the migration that builds
-- the modules, and this is it. A value added here is not used by this migration:
-- PostgreSQL refuses a new enum value in the transaction that created it, and
-- nothing is granted here anyway — a grant is an operator action.
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'conquest.confirm_on_behalf';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'suynl.confirm_on_behalf';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.view_subtree';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.confirm';
ALTER TYPE capability ADD VALUE IF NOT EXISTS 'training.confirm_on_behalf';

-- ---------------------------------------------------------------------------
-- `read_only` is valid on a read capability, and section 7 now names eight
--
-- `capability_grants_read_only_is_a_read` (0001) listed the five read
-- capabilities that existed then. `read_only` defaults to true, so leaving it
-- alone would make the ordinary grant of `conquest.view_subtree`,
-- `suynl.view_subtree` or `training.view_subtree` not merely ineffective but
-- uninsertable — the failure decision 0204 records against this same constraint,
-- one capability class over.
--
-- Replaced rather than deferred to the pull request that builds the services: a
-- migration is correctable in place only until it merges, and a constraint that
-- exists and is wrong is worse than one that is absent, because the application
-- layer then permits a row shape the schema refuses.
--
-- It cannot refuse existing data: the nine values did not exist before this
-- migration, so no grant can name one, and the replacement list is strictly
-- wider than the one it replaces.
-- ---------------------------------------------------------------------------

ALTER TABLE capability_grants
  DROP CONSTRAINT capability_grants_read_only_is_a_read;

ALTER TABLE capability_grants
  ADD CONSTRAINT capability_grants_read_only_is_a_read
    CHECK (
      read_only = false
      OR capability IN (
        'people.view_subtree',
        'dcc.view_subtree',
        'cell.view_subtree',
        'reports.view_subtree',
        'audit.view',
        'conquest.view_subtree',
        'suynl.view_subtree',
        'training.view_subtree'
      )
    );

-- ---------------------------------------------------------------------------
-- SUYNL: ten lessons, one row per lesson done (section 28, *SUYNL*)
--
-- No stated date: the day a tick carries is the Asia/Manila date of
-- `confirmed_at`, which is what makes section 27's Win 3 date derivable from one
-- clock rather than from two that can disagree.
--
-- Graduation is not stored. Ten current rows are a graduation, dated by the
-- tenth — so a correction that removes one takes the graduation with it, with
-- nothing to keep in step.
-- ---------------------------------------------------------------------------

CREATE TABLE suynl_lessons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES persons(id),
  lesson            smallint NOT NULL,
  -- The Person whose statement this is, null-permitting because a Network root
  -- has no pastoral leader to confirm for them (sections 5 and 9). Nothing here
  -- can tell a root from a person whose leader was simply not resolved, so which
  -- nulls are legitimate is the service's to refuse — the same division
  -- `dcc_attendance.responsible_leader_id` states in 0011.
  confirmed_by      uuid REFERENCES persons(id),
  -- The Account that filed it, which differs from `confirmed_by` on behalf.
  recorded_by       uuid NOT NULL REFERENCES accounts(id),
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  superseded_at     timestamptz,
  corrected_by      uuid REFERENCES accounts(id),
  correction_reason text,

  CONSTRAINT suynl_lessons_lesson_in_range CHECK (lesson BETWEEN 1 AND 10),

  -- Set together or not at all: a superseded row without a reason is a withdrawal
  -- nobody has to explain, which section 28 refuses.
  --
  -- `~ '\S'` rather than the schema's usual `btrim(x) <> ''`: one-argument `btrim`
  -- strips spaces and nothing else, so that idiom stores a reason of one tab or one
  -- newline. `cell-meeting-submit.dto.ts` names the same hole at the edge and calls
  -- the older precedents a gap to close rather than a shape to copy; this is the
  -- shape it points at. Found by the tests written against this migration.
  --
  -- **`correction_reason IS NOT NULL` stays, and dropping it is a live defect.**
  -- `~` propagates null, so without it the arm evaluates to null for a superseded
  -- row carrying no reason at all — and a CHECK whose expression is null passes.
  -- The `IS NOT NULL` tests around it do not have that property, which is why
  -- exactly one case broke when this was written without the conjunct.
  CONSTRAINT suynl_lessons_correction_is_whole CHECK (
    (superseded_at IS NULL AND corrected_by IS NULL AND correction_reason IS NULL)
    OR (
      superseded_at IS NOT NULL
      AND corrected_by IS NOT NULL
      AND correction_reason IS NOT NULL
      AND correction_reason ~ '\S'
    )
  )
);

CREATE UNIQUE INDEX suynl_lessons_one_current_per_lesson
  ON suynl_lessons (person_id, lesson)
  WHERE superseded_at IS NULL;

-- The tab reads a person's whole ladder at once, and Win 3 reads three lessons
-- for each of a leader's disciples.
CREATE INDEX suynl_lessons_by_person
  ON suynl_lessons (person_id, confirmed_at)
  WHERE superseded_at IS NULL;

CREATE TRIGGER suynl_lessons_no_delete
  BEFORE DELETE ON suynl_lessons
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- ---------------------------------------------------------------------------
-- Training: five graduations (section 28, *Training*)
--
-- `graduated_on` is nullable deliberately, and it is section 3's reason for an
-- optional birthday: leaders are recording graduations from years back, and a
-- mandatory date somebody cannot supply gets filled with a fiction. A figure
-- counting graduations in a period therefore counts the dated rows only, which
-- section 28 requires the screen to say.
-- ---------------------------------------------------------------------------

CREATE TABLE training_graduations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES persons(id),
  program           training_program NOT NULL,
  graduated_on      date,
  -- Null-permitting for a Network root, as on suynl_lessons above; which nulls
  -- are legitimate is the service to refuse.
  confirmed_by      uuid REFERENCES persons(id),
  recorded_by       uuid NOT NULL REFERENCES accounts(id),
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  superseded_at     timestamptz,
  corrected_by      uuid REFERENCES accounts(id),
  correction_reason text,

  -- Both halves for the reasons given on `suynl_lessons` above: `~ '\S'` rather
  -- than `btrim`, and `IS NOT NULL` beside it so null does not pass.
  CONSTRAINT training_graduations_correction_is_whole CHECK (
    (superseded_at IS NULL AND corrected_by IS NULL AND correction_reason IS NULL)
    OR (
      superseded_at IS NOT NULL
      AND corrected_by IS NOT NULL
      AND correction_reason IS NOT NULL
      AND correction_reason ~ '\S'
    )
  )
);

CREATE UNIQUE INDEX training_graduations_one_current_per_program
  ON training_graduations (person_id, program)
  WHERE superseded_at IS NULL;

CREATE INDEX training_graduations_by_person
  ON training_graduations (person_id)
  WHERE superseded_at IS NULL;

CREATE TRIGGER training_graduations_no_delete
  BEFORE DELETE ON training_graduations
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- ---------------------------------------------------------------------------
-- Conquest: confirmations of a goal reached before the church was encoded
-- (section 27, *Structure*)
--
-- Every goal is derived from records, so this table is not how a goal is
-- ordinarily reached. It holds the history those records cannot: a goal reached
-- before any of this was written down, stated by the leader who knows it.
--
-- `reached_on` is required here, unlike a graduation date: a confirmation whose
-- whole purpose is history nobody else holds would say nothing without one.
-- ---------------------------------------------------------------------------

CREATE TABLE conquest_confirmations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES persons(id),
  goal              conquest_goal NOT NULL,
  reached_on        date NOT NULL,
  -- Null-permitting for a Network root, as on suynl_lessons above; which nulls
  -- are legitimate is the service to refuse.
  confirmed_by      uuid REFERENCES persons(id),
  recorded_by       uuid NOT NULL REFERENCES accounts(id),
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  superseded_at     timestamptz,
  corrected_by      uuid REFERENCES accounts(id),
  correction_reason text,

  -- Both halves for the reasons given on `suynl_lessons` above.
  CONSTRAINT conquest_confirmations_correction_is_whole CHECK (
    (superseded_at IS NULL AND corrected_by IS NULL AND correction_reason IS NULL)
    OR (
      superseded_at IS NOT NULL
      AND corrected_by IS NOT NULL
      AND correction_reason IS NOT NULL
      AND correction_reason ~ '\S'
    )
  )
);

CREATE UNIQUE INDEX conquest_confirmations_one_current_per_goal
  ON conquest_confirmations (person_id, goal)
  WHERE superseded_at IS NULL;

CREATE INDEX conquest_confirmations_by_person
  ON conquest_confirmations (person_id)
  WHERE superseded_at IS NULL;

CREATE TRIGGER conquest_confirmations_no_delete
  BEFORE DELETE ON conquest_confirmations
  FOR EACH ROW EXECUTE FUNCTION refuse_delete_of_history();

-- migrate:down:refuse-if-populated suynl_lessons training_graduations conquest_confirmations

-- These three hold history — a leader's statement about a person, which section 28
-- says is never deleted — so reverting is refused once any of them holds a row, as
-- it is for the tables of 0001, 0002 and 0009. Reverting an empty Growth is how a
-- development database goes back; reverting a populated one is the data loss the
-- migration policy forbids.

DROP TABLE conquest_confirmations;
DROP TABLE training_graduations;
DROP TABLE suynl_lessons;

-- The `read_only` list goes back to the five of 0001. It must be restored rather
-- than left wide: a down that leaves a constraint looser than the schema it
-- reverts to is a revert that did not revert.
ALTER TABLE capability_grants
  DROP CONSTRAINT capability_grants_read_only_is_a_read;

ALTER TABLE capability_grants
  ADD CONSTRAINT capability_grants_read_only_is_a_read
    CHECK (
      read_only = false
      OR capability IN (
        'people.view_subtree',
        'dcc.view_subtree',
        'cell.view_subtree',
        'reports.view_subtree',
        'audit.view'
      )
    );

DROP TYPE conquest_goal;
DROP TYPE training_program;

-- The nine capability values stay. PostgreSQL cannot remove an enum value, and
-- the alternative — rebuilding the type — would rewrite `capability_grants`,
-- which the migration policy refuses on a table holding history. A value nothing
-- grants is inert.
