# 2026-09-15 — A Cell meeting's recorded marks are read under the capability that records it

Decision 0223 gave a Cell meeting's roster each member's recorded mark, so that a correction
resubmits what is stored rather than blanking it. It deliberately did not settle which
capability may read those marks, and Section 7 gave two answers. Its capability-boundaries
list said a meeting's roster is guarded by "`cell.take_attendance` for a submission and
`cell.correct_subtree` for a correction", while
`GET /api/v1/cells/{id}/meetings/{meeting_id}/roster` declares `cell.take_attendance` alone.

`CLAUDE.md` recorded it as a Stop Condition to settle "with the correction screen, which is
the first thing that will hold both capabilities in one hand". The recording screens of the
redesign (UI-3) are that screen, and `architecture-guardian` raised the question on them.

## The ruling

**A Cell meeting's roster, marks included, is read under `cell.take_attendance`, resolved
against the meeting.** Every actor the roster admits sees what is recorded for each member.
`cell.correct_subtree` guards changing a record that already stands, and nothing about
reading it.

So an actor holding `cell.take_attendance` without `cell.correct_subtree` sees a recorded
meeting's marks and cannot change them. The recording screen built with this ruling shows
those marks read-only and offers "Edit this record" only to an account holding
`cell.correct_subtree`. That offer is a courtesy; the API decides, against the meeting
(Section 1, Principle 4).

## The ground

**It is decision 0194's reason, in the domain that asks for more.** A leader marking a DCC
checklist sees who is already marked, so that nobody is asked twice. A leader opening a
recorded Cell meeting is in the same position, and hiding the marks would show them a roster
that looks as though nothing was recorded.

**It is what the route already does, so it adds no reader.** The roster and the submit route
carry the same declaration (Section 7), and the roster has returned the marks since decision
0223. The ruling states that behaviour rather than changing it.

**Hiding the marks from such an actor was set out and not chosen.** Carrying the marks only
for an actor holding `cell.correct_subtree` over the meeting was buildable. It would change
what the API gives an actor the route already admits, for a case no role default produces,
and it would present a recorded meeting as a list of names with nothing against them.
Refusing a recorded meeting's roster outright to anybody without `cell.correct_subtree` was
set out too, and would hide even whether the meeting was held.

## What this does not do

**It changes no route and no role default.** In Section 7's role defaults the Senior Pastor,
Admin and Leader columns give `cell.take_attendance` and `cell.correct_subtree` the same scope
as each other, so no default account sees anything different.

**It does not settle how a meeting status recorded in error is corrected**, which stays open.
The recording screen keeps a recorded status as it is and does not offer to change it.

---

Decision 0246, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-14 — The sidebar is Record, Reports, People, Cells and Network, and a whole-church reader starts on Reports](0245-the-sidebar-follows-the-design.md)
