# 2026-08-31 — A Cell meeting is addressed by its week

Section 22 sketches `POST /api/v1/cells/{id}/meetings/{meeting_id}/submit`, which reads
as though a Cell meeting has an identifier before anybody has reported it. Nothing else
in the specification says one exists.

**`{meeting_id}` is the Monday of the week the meeting belongs to, as a `YYYY-MM-DD`
Asia/Manila date. A `cell_meetings` row is written by the first submission, and there is
no row before it.** `(cell_id, week_starting)` is unique.

## Why no row before it is reported

One rule decides it and two others agree with it, which is less than "three rules
already say so" — the claim this section opened with.

**Section 13 has exactly three statuses and all three are things a leader reports.** It
says an unreported meeting "is therefore not a status at all. It is an outstanding task".
A row generated ahead would need a fourth state — a null status is one — and Section 25
rule 8 forbids adding one. That is not a technicality: the ambiguity between "did not
happen" and "not yet told us" is what the three statuses exist to remove, and a nullable
status reintroduces it inside the table.

**Section 12 counts N from rows** — "N = count of HELD + RESCHEDULED meetings", with
unreported meetings excluded because "an unreported meeting is an absence of data, not a
fact about attendance". *That is consistent with this ruling and does not decide it: a row
carrying a fourth state would be excluded from N in exactly the same way. "Absence of data
is absence of a row" is the conclusion, and the first version of this section offered it
as a premise.*

**What does support it independently is Section 13's own arithmetic**, written before this
ruling: `Total Meetings = Held + Rescheduled + Not Held` and
`Coverage = Total Meetings / Scheduled`. The numerator is a count of rows bearing one of
the three statuses and the denominator is derived from the schedule — two figures reached
two ways, which is only true if a row means a report.

**And the coverage line says the same thing in words.** Section 12 asks for "4 of 5
meetings recorded", where the 5 is derived from the Cell's schedule against the calendar —
which Section 13 calls "a calendar concept … not a meeting status". Generating rows would
make both sides the same count and the line would always read 5 of 5.

## Why the week rather than a UUID

**It names the thing Section 13 says the meeting *is*.** "A rescheduled meeting remains
one logical meeting, not two separate meetings, and does not create an additional
applicable meeting for that calendar week." The identity is the Cell and the week; a
reschedule changes the actual date and not the identity. An identifier that carries the
week says that, and a UUID would let two rows exist for one week until a constraint
refused them.

**It is stable before the row exists**, which is what the route needs: a client listing
a Cell's meetings sees weeks awaiting a record, and submits against one of them. A
retry names the same meeting, which is what Section 22's idempotency rules want of a
write that may be repeated on a bad connection.

**A week begins Monday** (Section 20, ISO 8601), so the identifier is unambiguous, and
Section 20 already makes that the boundary deciding which meetings fall in which week.

**It discloses nothing.** Section 22 refuses a route that addresses a *Cell* by its
enumerable handle, because a Cell's UUID being unguessable is what makes an
out-of-scope Cell indistinguishable from an absent one. That argument is about the Cell,
and the Cell is still addressed by its UUID here. A week is a date; knowing which Monday
it is reveals nothing about any Cell, and the caller has already been authorized against
the Cell in the path.

## What was rejected

**Rows generated ahead, as DCC events are.** It would make `{meeting_id}` a row id and
"awaiting a record" a stored fact rather than a derived one. Refused on Section 13's
three statuses, above — and separately because Section 2 puts the church at roughly 800
Cells, so it writes about 800 rows a week, for ever, most of which say only that a
meeting was scheduled, which the schedule already says.

The asymmetry with DCC is deliberate and has a reason. A DCC event must exist before
anyone submits because its *absence* is meaningful — Section 9 makes a Sunday with no
event a recorded, audited decision, and coverage is measured against a denominator that
exists before anyone submits. A Cell meeting's denominator is derived from the Cell's
schedule, which is already stored and already effective-dated, so nothing needs a row to
count against.

**A client-minted UUID.** Section 23 asks for stable UUIDs generatable by the client so
that a record drafted offline keeps its identity when it syncs, and this is the one
place that pulls the other way: two clients drafting the same week would mint different
identifiers and the second submission would be refused by the uniqueness rule, where the
week-keyed form has no conflict at all. Section 23's requirement is met — the identifier
is client-derivable, which is what "generatable by the client" is for — without the
collision.

---

Decision 0162, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — The DCC calendar is advanced by an Admin command](0161-the-dcc-calendar-is-advanced-by-an-admin-command.md) | Next: [2026-08-31 — A Cell meeting's responsible leader is frozen as of the meeting](0163-a-cell-meetings-responsible-leader-is-frozen-as-of-the-meeting.md)
