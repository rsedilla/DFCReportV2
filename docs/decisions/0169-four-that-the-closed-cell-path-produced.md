# 2026-08-31 — Four that the closed-Cell path produced

The fifth `architecture-guardian` pass found eleven, and three of them were defects
introduced by the previous batch rather than stale prose — all three on the closed-Cell
recording path, which 0165 opened and 0166 to 0168 have been narrowing since. This is the
fifth consecutive round in which a fix batch introduced something, which `CLAUDE.md`
records as the expected outcome rather than a surprise.

## A meeting's roster is read under the capability that records the meeting

`GET /api/v1/cells/{id}/meetings/{meeting_id}/roster`, guarded by `cell.take_attendance`
for a submission and `cell.correct_subtree` for a correction, resolved against the
meeting.

0168 required the closed-Cell write to carry "the Cell's roster as of that date" and named
no surface for it. The only roster route is `GET /api/v1/cells/{id}/members`, guarded by
`cell.manage_membership` — a **management** capability, so Section 7 rejects `read_only`
on it, and the guard resolves one target from the path. Satisfying 0168 on that route
would have meant putting a closed Cell in the former leader's `cell.manage_membership`
scope, which opens `POST` and `DELETE /members` on it — the writes Section 7 says resolve
through nobody, in the sentence immediately above.

**The route is the exact counterpart of `GET /api/v1/dcc/events/{id}/roster`**, which
Section 9 already guards under `dcc.*`. Taking attendance needs to know who there is to
record; that is a property of the attendance surface, not of membership management. Stated
generally rather than as a closed-Cell exception, because it is true of an open Cell too:
nobody should need the power to move a roster in order to mark it.

It settles nothing about `GET /api/v1/cells/{id}/members`, which manages membership and
whose read capability stays on `CLAUDE.md`'s open list for Stage 5.

## A closed Cell's meetings cannot be rescheduled

0168 authorized the closed-Cell write on "the date the submission declares", and defended
it on the ground that the bound "is not chosen by the actor". The *window* is not; the
instant inside it was a value in the request body, and nothing bounds a reschedule's
direction.

So A, who led until 10 March, could file the meeting scheduled 14 March — B's — declaring
an actual date of 8 March, be authorized as A, and have the record freeze to A. Authority
recovered through a date field the actor supplies, which is the shape Section 7 calls
"forced rather than chosen" to refuse. 0168 closed the direction where A *loses* a record
and opened the one where A *takes* one.

**A closed Cell's meetings cannot be rescheduled**, so `actual_date` equals
`scheduled_date` and the authorizing instant comes from the Cell's own schedule.

The rule is true of the world rather than a patch: a reschedule moves a meeting to another
date, and every other date a closed Cell has is after its closure and already refused. A
meeting that genuinely moved before the Cell closed is recorded on the date it happened,
by an Admin amendment.

## `responsible_leader_id` is frozen at first write and never re-resolved

0165 resolved it as of the meeting's date and said only that a later *handover* never
moves it. Section 13 permits a meeting to be rescheduled twice and permits a `RESCHEDULED`
meeting to become `NOT_HELD` — which has no actual date and falls back to the scheduled
one. Both move the instant the rule names, after the row exists, and neither is a handover.

**The column records who was responsible when the meeting was first reported, and nothing
moves it afterwards.**

Re-resolving on each edit would move a recorded meeting between leaders' totals inside a
period that may have closed — Section 20 forbids that and Section 3 makes it a
reproducibility guarantee, and the responsible leader is a reporting dimension by Section
14. The cost is that a meeting rescheduled across a leadership change keeps the leader it
was first recorded under; `cell_meeting_changes` carries every move, so the history is
legible rather than merely consistent.

## `dcc_calendar_start` is set by the command's first run, and only that run

0168 moved the key to the defaults seed to avoid making the command a second system-action
writer of `settings.updated_by`. It did not say what value the seed writes, and 0167 had
already refused both derivations available — from the earliest record, which moves as
records are added, and a fixed span behind the horizon, which leaves a long lapse
unrepairable. The seed runs before any calendar exists, so it has nothing to derive from.

**It is seeded null, and the command's first run sets it to the Sunday on or before that
day. The command refuses to move it afterwards.**

That is a value derived from a real event — when this church's calendar began — rather
than a date somebody invented in a migration. The single write is the calendar's own
creation rather than a settings change, and it happens exactly once, on a key that is null
exactly once; after that only an Admin moves it, under `settings.manage`, audited like any
other.

**What the key is for changed with the back-fill's withdrawal, and it survives that.** It
was a floor stopping a back-fill from reaching the epoch, and the command no longer reaches
a closed month at all. What it does now is record when the calendar began, so a report over
an earlier range can say "before we started" rather than "no service" — which is the
distinction Section 9 spends its removal machinery preserving everywhere else.

## And one the withdrawal missed in the other direction

0168 removed the additive path into a closed month and left the subtractive one open:
Section 9 made removing a Sunday a deliberate Admin action with no window bound at all,
and a removal moves that month's N and every bucket exactly as an addition would.

**Removing a Sunday reaches an open month only.** A closed month's calendar is fixed
exactly as its attendance is, and for the same reason. Decided here rather than escalated,
because the withdrawal's own argument settles it: the specification had just refused the
symmetric case on Section 20, and no rule distinguished the two.

---

Decision 0169, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — The closed-month back-fill is withdrawn](0168-the-closed-month-back-fill-is-withdrawn.md) | Next: [2026-08-31 — The submission window runs through the whole of the 7th](0170-the-submission-window-runs-through-the-whole-of-the-7th.md)