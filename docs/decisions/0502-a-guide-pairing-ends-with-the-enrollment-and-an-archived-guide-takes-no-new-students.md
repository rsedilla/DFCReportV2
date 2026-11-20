# 2026-11-20 — A Guide pairing ends with the enrollment, and an archived Guide takes no new students

Owner rulings of 2026-11-20, asked while the Guides step of decision 0501 was being built,
on three questions `architecture-guardian` raised as Stop Conditions in its review of that
step, and on two asked earlier the same day. Decision 0501 is merged, so these are a ruling of
their own rather than an amendment to it.

**1. A pairing ends when the student's enrollment ends** (owner, 2026-11-20, "Pairing ends
too"). Moved to another class, withdrawn or archived, the student's pairing with their Guide
is closed at the enrollment's own instant, by the same account, recorded as ended because the
enrollment ended. The Guide's count drops, and the record says why it ended. The other answer
was to leave the old pairing open on the ended enrollment for screens to ignore; it was not
chosen because the record would never say it ended, and a Guide removed later would stamp it
with a reason that was not why it ended.

**2. An archived Guide takes no new students** (owner, 2026-11-20, "No new students"). A Guide
archived while their class runs keeps the students they already have; sharing out and *Swap*
pass them over, and the class's Edit says so. It follows Section 3, which gives an archived
Person no new live relationship. How many more Guides a sex needs counts an archived Guide as
taking nobody more.

**3. A sex corrected after pairing is swapped by hand** (owner, 2026-11-20, "Coordinator swaps
by hand"). A student's or a Guide's sex corrected under Section 4 leaves the pairing as it was;
the student's line on *Students* says their Guide is not the same sex, and *Swap* lists the
Guides of the student's sex as it now reads. Nothing is shared out again on its own. The other
answer was for DREAMS to end the pairing and share the student out afresh.

**4. Naming a Guide takes nobody from another Guide** (owner, 2026-11-20, "No, swap by hand").
Only students with no Guide are shared out; a Guide named late starts with none, and the
Coordinator moves students to them with *Swap*. Recorded in decision 0501, point 8, before it
merged, and stated here so the five answers of the Guides step read together.

**5. A student's own Cell leader may be their Guide** (owner, 2026-11-20, "yes"). Nothing in
sharing out or in *Swap* keeps the two apart. Recorded in decision 0501, point 8, before it
merged; this retires the bullet of `CLAUDE.md`'s open list that 0501 left asking it.

**Search results carry a *Choose* button on each person** (owner, 2026-11-20, option B of three
screenshots), with a line saying how many were found and what choosing does, for the Register,
Teacher and Guide searches alike. The Guide search also says why each person may guide, such as
*Passed SOL 1*, as 0501 point 4 asks. That is presentation and is recorded here only because it
was decided in the same sitting.

## What holds it

Point 1 is held by the database as well as by the service: a trigger on
`equipping_enrollments` closes the pairing whenever an enrollment ends, whichever path ends it,
and a pairing cannot be opened on an ended enrollment or with a removed Guide. A Guide is
removed only once none of their pairings is open, a removed Guide stays removed, and an ended
pairing stays ended (migration 0052). **Point 2 is held by the service alone**, in sharing out
and in *Swap*: whether a Person is archived is `people`'s, and a trigger reading it from the
school's tables would cross a module boundary (Section 2).

Previous: [2026-11-20 — Equipping: the school from the class to the final grade, and SOL 1 to 3](0501-equipping-the-school-from-the-class-to-the-final-grade-and-sol-1-to-3.md)
