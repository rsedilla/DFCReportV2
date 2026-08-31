# 2026-08-31 — A Cell meeting's responsible leader is frozen as of the meeting

Section 9 and Section 13 answer the same question in different words, and the difference
decides whether a handover rewrites who past meetings belong to.

Section 9, for DCC: the responsible leader is the person's direct pastoral leader "**as
of the event date**", and "**Fixed as of the event date.** A later reassignment never
moves historical records."

Section 13, for a Cell meeting: "**responsible leader** — the Cell's **current** leader
(Section 11)".

**A Cell meeting's responsible leader is whoever led the Cell on the meeting's week, and
it is frozen in `cell_meetings.responsible_leader_id` when the row is written.** Section
13 is amended to say so.

## Why

**The column can only hold one answer.** Section 13 gives `cell_meetings` a stored
`responsible_leader_id`. A literal reading of "current" makes that column wrong the
moment a Cell changes hands, and keeping it right would mean rewriting it on every
handover — which Section 1 principle 12 and Section 10's rule that a handover leaves the
Cell's history alone both refuse.

**Section 20 requires a closed month's figures not to move.** A handover in November that
re-attributed October's meetings would change October's per-leader totals after October
closed, which Section 3 makes a reproducibility guarantee: re-running a past period
returns what it returned.

**Section 16 counts New Cell Leaders by when a leadership assignment starts.** An
incoming leader whose past meetings moved with them would appear to have led in months
before their assignment began, which is the figure Section 16 exists to state precisely.

**And Section 9 already decided the same question**, for the same reason, in the
neighbouring domain. Reading Section 13's "current" as current-at-the-time makes the two
domains agree; reading it as current-now makes attendance history mean one thing for DCC
and another for Cells, with nothing saying why.

## What "current" was doing there

Nothing wrong. Section 13's sentence is defining the three roles a single meeting has —
responsible leader, facilitator, submitter — and distinguishing the leader from whoever
happened to run it that night. "Current" is doing the work of "not the facilitator",
which the two lines under it confirm. It is not an as-of rule stated in opposition to
Section 9's, and it should not be read as one; the amendment says which instant it means
rather than reversing anything.

## What was rejected

**Resolving at read time through the Cell's leader now.** The literal reading. It is what
Section 7 does for *scope* — authority over a Cell resolves through its current leader —
and the distinction matters: Section 7's own subsection says that "the period being
viewed" governs a read while a write "is acted on now", and who a record *belongs to* is
not who may act on it. Scope moving with a handover is correct and intended; attribution
moving with it is not.

**Stamping whoever holds the Cell at the moment of submission.** Simplest, and it
differs from the ruling only for a meeting recorded after a handover — which is a live
case inside the submission window, since a leader has until the 7th of the following
month. It would attribute a meeting to somebody who did not lead the Cell that week,
which is the thing the freeze exists to prevent.

## What it costs

Resolving the leader as of a past week is a query against `cell_leaderships` rather than
a read of the Cell's current row, and a Cell with no leadership row covering that week
cannot have a meeting recorded against it. That case is not reachable through any
operation Sections 10 and 11 define — an `ACTIVE` Cell has exactly one leader and a
`CLOSED` Cell is refused — and it is refused rather than defaulted, because a meeting
with no responsible leader is a record nothing rolls up.

---

Decision 0163, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A Cell meeting is addressed by its week](0162-a-cell-meeting-is-addressed-by-its-week.md) | Next: [2026-08-31 — A Cell submission versions the meeting; a DCC submission versions the person](0164-a-cell-submission-versions-the-meeting-a-dcc-submission-versions-the-person.md)
