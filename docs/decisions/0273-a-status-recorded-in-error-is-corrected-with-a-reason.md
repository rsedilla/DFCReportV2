# 2026-09-22 — A meeting status recorded in error is corrected with a reason

Decision 0195 admitted the four moves Section 13 names and left open how a status recorded
*in error* is corrected: a leader who filed "Did not meet" for a meeting that happened, or
"Met" for one that did not, had no route, and the month's figures stayed wrong. The owner's
Claude Design let a filed record be edited, answer included, with "Saving replaces what is
already filed". The owner chose this answer from a drawing of that beside it.

## The ruling

**`HELD` → `NOT_HELD` and `NOT_HELD` → `HELD` are status corrections**, on the same submit
route as every other change to a meeting.

**Each requires a `correction_reason`.** Without one it is refused as `INVARIANT_VIOLATION`.

**Otherwise it is made as a move is**: `cell.correct_subtree`, the meeting's `version`, and
the month's window or an Admin amendment.

**The first report stays legible.** A `cell_meeting_changes` row records the two statuses,
with the reason as its note, and a `cell_meeting.status_corrected` audit entry records the
before, the after and the reason. A correction to `NOT_HELD` closes every mark with nothing
replacing it (decision 0183) rather than deleting any. A correction to `HELD` carries the whole
roster of the scheduled date, as a first submission does.

**A `RESCHEDULED` meeting is left out.** It already has its own move to `NOT_HELD`, and
Section 12 counts it as held. A meeting moved and then declared `NOT_HELD` is stored as
`NOT_HELD`, and what correcting it to `HELD` should do is open in `CLAUDE.md`.

The meeting row keeps only the current reason and note, so a correction's audit entry
carries the ones it replaced.

## Why

The design's "saving replaces" would have made the first answer disappear, which Section 13's
history rows exist to prevent. A reason is what tells a correction from a move afterwards.

Rejected: keeping it as it was until after the pilot, which leaves a mistaken tap in the
month's figures for good.

## Found while building it

The web client sent a correction's version as `submitted_version`, a field the route does
not declare, so every Cell meeting correction from the screen was refused as
`VALIDATION_FAILED`. It now sends `version`. The mocked browser tests never checked the body.

---

Decision 0273, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-22 — No list of details to collect; the person's record offers to add one](0272-no-list-of-details-to-collect.md)
