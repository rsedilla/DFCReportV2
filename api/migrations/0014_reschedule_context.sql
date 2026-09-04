-- migrate:up

-- ---------------------------------------------------------------------------
-- A change row's note stands on its own (SKILL.md section 13; ruling of
-- 2026-09-04)
--
-- Section 13 asks that a rescheduled meeting preserve "original scheduled date/time,
-- new scheduled date/time, optional note/context, who rescheduled it, timestamp".
-- Four of those five were written from the day `cell_meeting_changes` gained its
-- first writes. The fifth had nowhere to go.
--
-- `reason` on this table is typed `cell_meeting_not_held_reason`, which is the
-- closed enum of section 13's NOT_HELD reasons, and migration 0011 added
--
--     CONSTRAINT cell_meeting_changes_note_only_with_reason
--       CHECK (note IS NULL OR reason IS NOT NULL)
--
-- so a note required one of those reasons beside it. On a reschedule there is no such
-- reason and there never can be -- the meeting was moved, not abandoned -- so the
-- constraint made section 13's clause unimplementable rather than merely unimplemented.
-- The route accepted `correction_reason` on a move and wrote it to no row at all.
--
-- **The constraint was stricter than the specification, rather than derived from it.**
-- Section 13's own schema block for this table lists `reason nullable` and `note
-- nullable` as independent columns and couples them nowhere. The coupling was an
-- implementation choice made when the only change this table recorded was a NOT_HELD
-- declaration, where it happened to hold; a reschedule is the case it was never
-- written against, and it arrived with the transitions slice.
--
-- What is kept is the half that still says something: a `reason` is a NOT_HELD reason,
-- so a row carrying one is a declaration, and section 13 requires a note there only
-- where the reason is `OTHER`. That rule lives on `cell_meetings` where the status
-- does (`cell_meetings_other_requires_note`) and is not restated here, because this
-- table records the move rather than the meeting's current state.
--
-- **Additive in effect: this relaxes, it never refuses.** Every row that satisfied the
-- old constraint satisfies the new one, so no existing data is validated against a
-- narrower rule and no backfill is implied (CLAUDE.md, Migration policy). No column is
-- dropped and no history is rewritten.
--
-- **Reversible, with one condition stated rather than hidden.** The down section
-- restores the original constraint, which is correct on any database whose change rows
-- all predate this migration. It will abort where a reschedule has since recorded a
-- note -- which is the point of the change -- and that is the honest behaviour: the
-- rows carry a fact the older constraint has no way to hold, and destroying them to
-- satisfy a rollback would be exactly what section 5 forbids.
--
-- Nothing here touches `pastoral_assignments`, `cell_memberships`, `cell_leaderships`,
-- network assignments or attendance, so the snapshot-and-reconcile obligation
-- (CLAUDE.md, Migration policy) is not engaged: no row of any table is read, written or
-- moved, and the only object altered is one constraint on one table.
-- ---------------------------------------------------------------------------

-- **This migration relaxes and adds nothing, deliberately.** The first draft replaced the
-- constraint with a non-blank-and-at-most-500 check, and that would have shipped the sixth
-- constraint-driven 500 on this route: `not_held_note` writes this same column and its DTO
-- bounds it at 1000, so a legal note between 501 and 1000 characters would have met a
-- `CHECK` no service guard stood in front of. Two fields with different bounds share this
-- column, and one arbitrary bound over both is not a rule either of them states.
--
-- What remains is bounded where it enters: `correction_reason` at 500 and `not_held_note`
-- at 1000, each on its own DTO, and blankness normalised to null by the service, which is
-- where the two differ. `cell_attendance.correction_reason` is bare `text` for the same
-- reason, so this column now matches the sibling it was always modelled on.
ALTER TABLE cell_meeting_changes
  DROP CONSTRAINT cell_meeting_changes_note_only_with_reason;

-- migrate:down

ALTER TABLE cell_meeting_changes
  ADD CONSTRAINT cell_meeting_changes_note_only_with_reason
    CHECK (note IS NULL OR reason IS NOT NULL);
