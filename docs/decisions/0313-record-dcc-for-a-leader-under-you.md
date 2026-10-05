# 2026-10-05 — Record DCC for a leader under you who has an account

Decision 0301 let *People I oversee* list another leader's DCC rows and gave each one *See
checklist* only, read only, "until a screen records on another leader's behalf". The API already
accepted such a save (Section 14, `dcc.submit_on_behalf`); no screen offered it. The owner chose
this version from clickable copies of the Record page and the Sunday screen, beside their Claude
Design, which gives every row of that list a Record button. `architecture-guardian`'s three reviews
raised a Stop Condition each; the owner settled all three and approved the corrected wording the same
day.

## The ruling

**1. Another leader's DCC row in *People I oversee* carries Record beside See checklist wherever
the actor may record for that leader** (point 4). Otherwise it keeps See checklist only. This ends
decision 0301 point 3's exception for those rows.

**2. Record opens the Sunday recording screen for that leader**, showing the people on that leader's
checklist for that Sunday (Section 9), narrowed as of now to those the actor holds under
`dcc.take_attendance` (owner's ruling on the first Stop Condition). They are in decision 0312's
sections: their 12,
then any leader beneath them with no account, then the Network roots where their checklist holds
them.

**3. Under the date, a red box reads** *"Recording for {leader}. These are the people {leader}
records. It is saved under your name, and {leader} sees it on their own checklist,"* followed by the
link *Back to your own checklist*.

**4. Who may: anyone holding both `dcc.take_attendance` and `dcc.submit_on_behalf` over that
leader.** By default that is a leader over anyone beneath them, and an administrator or Senior
Pastor over anyone in the church. The Record button itself appears only on *People I oversee*,
which lists the actor's own branch.

**5. One new read, `GET /api/v1/dcc/events/{id}/leaders/{leaderId}/roster`**, requiring both
capabilities against that leader, as of now. It returns only the people the actor holds under
`dcc.take_attendance` today.

**6. Saving uses the existing route**, `POST /api/v1/dcc/events/{id}/submit`, which checks every
line.

**7. The record is saved under the name of the person who recorded it** (`recorded_by`).

**8. It still counts as that leader's obligation in every report** (Section 20).

**9. Changing a mark already recorded still needs `dcc.correct_subtree`.**

**10. A save need not mark everybody**, as Section 9 already allows. Section 9's sentence calling a
submission one leader's whole checklist, which contradicted that, is reworded.

**11. For a leader whose account is not active, pending or disabled**, the box's last clause reads
*"… and {leader} will see it once their account is active."*

**12. A row for a leader holding no account opens the screen of the nearest leader above them who
holds one, found as of the Sunday** (owner's rulings on the second and third Stop Conditions): the
leader whose checklist holds that leader's people for that Sunday, in a section of their own (Section
9, decision 0312). The row stays listed under the leader the record is missing for, and carries Record
only where the actor may record for the leader so found, now; otherwise See checklist alone.

**13. The API decides per row whether a DCC row carries Record**, as it does for a Cell meeting, so
the screen never offers a Record that the read would refuse.

## Why

An upline following up a downline's DCC records could see what was missing and do nothing about it
from the screen that showed it. The box is there because the screen is otherwise the actor's own,
and recording somebody else's people should never be mistaken for recording one's own. The read
asks for `dcc.take_attendance` as well because a grant of `dcc.submit_on_behalf` alone would
otherwise reach people its holder may not record at all.

---

Decision 0313, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-04 — A DCC checklist shows your 12 first](0312-a-dcc-checklist-shows-your-12-first.md)
