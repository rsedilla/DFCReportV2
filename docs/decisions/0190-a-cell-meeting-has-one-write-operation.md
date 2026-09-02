# 2026-09-03 — A Cell meeting has one write operation, and `cell_attendance.version` is not compared

Section 14 named two Cell operations. A **submission**, carrying
`cell_meetings.version`, because "one submission is one leader's account of one meeting,
so the meeting is the unit". And, one bullet later, a **correction to one person's
record**, carrying `cell_attendance.version`: "That write names one person, so it compares
one person's version."

Slice 2c built the first and not the second. It offers a correction as a resubmission of
the whole roster, guarded by the meeting's version, superseding only the lines that
differ — so `cell_attendance.version` is written and never read.

Raised by `architecture-guardian` as a Stop Condition on the first pass of that slice:
the specification describes an operation the route does not offer, and neither Section 7
nor Section 22 says which of the two `cell.correct_subtree` guards.

## The ruling

**A Cell meeting has one write operation: an account of the meeting, sent as a roster and
guarded by `cell_meetings.version`.** The per-person operation is withdrawn from Section
14.

**`cell_attendance.version` orders one person's chain and is not compared.** Every
correction writes it one higher than the row it supersedes, so a person's record carries
the depth of its own history. If a per-person operation is ever added, this is the column
it compares.

## Why the withdrawal rather than the second route

**Section 14 refutes its own second bullet four sentences earlier.** The meeting is the
unit *because* "a Cell meeting belongs to one leader, so it has a unit" — and because
"Section 22 fixes that body as one `submitted` and one `current` pair". A per-person
operation needs a second unit and a second conflict body for a domain whose whole argument
is that it has one of each. The DCC domain needs the person because "a DCC event is
church-wide and many leaders record against it"; a Cell meeting has one leader, which is
the difference the two bullets were built on and which the second bullet then ignored.

**The effect a leader wants is already there.** Correcting one name is a resubmission with
that name flipped, and only the changed line is superseded — one pair of rows, not twenty.
What the meeting unit changes is not what gets written but what conflicts.

## What it costs

**Two people correcting different names at once conflict, where a per-person unit would
let both through.** That is the real cost and it is accepted: a Cell meeting belongs to one
leader, so two simultaneous correctors is the rare case rather than the ordinary one — and
Section 14's remedy is the one it prescribes everywhere, which is that a person resolves it
with both accounts in front of them. The DCC domain, where many leaders record against one
event, is exactly where that cost would be unacceptable, and that is why the unit differs
there.

## What this binds

- `POST /api/v1/cells/{id}/meetings/{meeting_id}/submit` is the whole of the Cell write
  surface. `cell.take_attendance` guards a first submission and `cell.correct_subtree` an
  amendment, which is Section 7's split with no ambiguity about which operation it names.
- `cell_attendance.version` keeps its column, its `CHECK` and its increment. Nothing reads
  it, and Section 14 now says so rather than describing it as a guard.
- A per-person route, if one is ever wanted, is a new operation with a ruling of its own,
  and this records what it would have to answer: what its conflict body is, and how two
  units coexist on one record.

No code changes: the route already implements the surviving operation.

---

Decision 0190, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — A Cell attendance audit entry targets the Cell, a DCC one the Person](0189-a-cell-attendance-audit-entry-targets-the-cell.md)
