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

~~**Section 16 counts New Cell Leaders by when a leadership assignment starts.**~~
*Withdrawn. The premise is true and the inference is not: Section 16 counts a person's
first qualifying leadership from `cell_leaderships`, and no Section 16 metric reads
`cell_meetings` — so that figure would not move by one however this column were resolved.
Section 21 already says as much about the audit log one domain over. What stands in its
place is Section 14, which makes the responsible leader a reporting dimension.*

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

**Resolving at read time through the Cell's leader now.** The literal reading, and it is
not what Section 7 does for scope either. Section 7 resolves a Cell meeting through the
Cell's leader "as of the period being viewed", falling back to its last leader where the
Cell is closed — so *now* is its answer for a write and not for a read.

*A first version of this section said scope "does resolve through the Cell's leader now",
citing the subsection that refutes it. Read correctly, scope and attribution converge on
the meeting's own period for a read and diverge only for a write, which is a narrower and
truer statement than the one it replaced.* What remains is that they are different
questions: who may act on a record is not who the record belongs to.

**Stamping whoever holds the Cell at the moment of submission.** Simplest, and it
differs from the ruling only for a meeting recorded after a handover — which is a live
case inside the submission window, since a leader has until the 7th of the following
month. It would attribute a meeting to somebody who did not lead the Cell that week,
which is the thing the freeze exists to prevent.

## The instant

**Not "the week", which this ruling first said.** A week is a period and a handover or a
closure lands on a day, so resolving at the week's start attributes a Saturday meeting to
a leader who left on the Wednesday — the outcome the freeze exists to prevent. Settled in
[decision 0165](0165-four-stop-conditions-the-stage-four-rulings-raised.md): the instant
is the meeting's `actual_date` where it has one and its `scheduled_date` otherwise, which
matches Section 9's "as of the event date" and is the same instant the meeting's roster is
read at.

## What it costs

Resolving the leader as of a past date is a query against `cell_leaderships` rather than a
read of the Cell's current row, and a meeting cannot be recorded for a date the Cell had
no leader on.

*A first version of this section said that case was unreachable "because an `ACTIVE` Cell
has exactly one leader and a `CLOSED` Cell is refused". The second half is not a rule
Sections 10 or 11 state — what Section 11 says is that a closed Cell has no **open**
leadership row, and an as-of read finds the closed row covering an earlier date perfectly
well. Read as written it would have refused every meeting of a Cell closed mid-month,
which Section 10 contradicts in terms.* Whether a closed Cell accepts a record at all is
settled in 0165, and it does, for the weeks it was open, until the window shuts.

---

Decision 0163, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A Cell meeting has no row until it is reported](0162-a-cell-meeting-has-no-row-until-it-is-reported.md) | Next: [2026-08-31 — A Cell submission versions the meeting; a DCC submission versions the person](0164-a-cell-submission-versions-the-meeting-a-dcc-submission-versions-the-person.md)
