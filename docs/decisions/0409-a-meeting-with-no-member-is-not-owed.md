# 2026-10-29 — A Cell meeting dated when the Cell had no member is not owed

Owner ruling, 2026-10-29, chosen from screenshots of Record's *Pending CG Records* and the
meeting screen on the demo database, beside two alternatives: correcting when the members joined,
and keeping the meeting owed while the screen only explains.

## What was wrong

A Cell whose members were added to the app after its first meetings had, by the records, nobody
on those dates. The meeting screen offered *Met* and *Save meeting*, and the save was refused,
because a meeting that met is recorded for every member (Section 13) and there was none; the leader
saw only "Some fields need correcting." *Did not meet* could be saved, and would be false where the
Cell did meet. So the meeting stayed on the leader's and the Primary's *Pending CG Records* until
its week closed, with nothing either of them could do.

Correcting the join dates was considered and set aside. No leader may backdate a Cell membership
(only an Admin's backdating capability reaches one, Section 7), and the people concerned were usually not in the app at all before they were added, so
their record, Network and pastoral leader would all have to be backdated with them.

## The ruling

**1. A scheduled meeting dated when the Cell had no member is not owed.** "Had a member" is the
roster's own rule (Section 13): a membership whose Manila start date is on or before the meeting's
date and whose end date, if any, is on or after it. Such a meeting is in no coverage denominator
(Section 12: Reports, the Cells list, the by-leader rows and the Branch screen), is not behind
(Section 12), and is on no recording list: not *Update Records*, not *Pending CG Records*, not
Recording Status. A Cell's leader holds no membership, so a Cell with only its leader owes nothing.

**2. It is not recorded either.** Its screen says "No member was in this Cell on [date], so there
is nothing to record and this meeting is not counted as owed", and offers no form. A first
submission for it is refused, `INVARIANT_VIOLATION`, with the same words. The Cell's list of
meetings shows such a date as *No members that day*.

**3. A record already made on such a date stays as it was** (Section 13), and is corrected as any
record is. Reports match records to owed meetings date by date, so it is in neither term there; the
Cells list counts records on their own, so its numerator counts it, as it already counts a record
left outside the schedule by a backdated closure — the open question in `CLAUDE.md` on what such a
record counts towards now names both.

## Three answers the review asked for (owner, 2026-10-30)

**4. It reaches months already reported.** Those meetings could never be recorded, so counting
them as missing was the error. A past month's Cell coverage may therefore drop. Months already
stored as finished reports are computed again once (migration 0034), so every surface agrees.

**5. A Cell with only its leader owes nothing.** Its leader is not a member of their own Cell;
their attendance is recorded in DCC. The question of whether a leader is a member stays open in
`CLAUDE.md` for everything else it decides.

**6. A backdated closure's dispersal stays as it is.** Members moved to another Cell from a past
date make that Cell's meetings from then owed; where their week has closed only an Admin can
record them. Those meetings were owed before this ruling too, so nothing is worse.

## Why this is not "recording less looks better"

Section 12 derives the coverage denominator from the schedule so that a leader cannot shrink it.
This keeps that: whether the Cell had a member is read from membership rows, and no screen or route
ends a membership in the past except a closure, which ends the schedule with it, so no past meeting
stops being owed. Section 7 lets an Admin's backdating reach a membership; a tool that ends one in
the past is not built, and must say what happens to the meetings it owed (owner, 2026-10-30); a membership opened in the past, as a backdated closure's dispersal opens one, only makes
more of a Cell's past meetings owed. What a Cell
with no members owes from then on is nothing, which is true; *No meeting in 3 months* (decision
0355) still lists it for the Admin, since it holds no meeting.

## What it does not change

DCC, whose obligations are people rather than meetings (Section 9). A Cell that scheduled nothing
still reads `0 of 0` and stays in an aggregate (decision 0225); a Cell with no member all month now
reads the same. How a meeting's roster is read, and every rule about recording one that is owed.

Decision 0409, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 12 and 13.

Previous: [2026-10-29 — Person Merge](0408-person-merge.md)
