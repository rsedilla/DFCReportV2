# 2026-10-05 — Record DCC for a leader under you who has an account

Decision 0301 let *People I oversee* list another leader's DCC rows and gave each one *See
checklist* only, read only, "until a screen records on another leader's behalf". The API already
accepted such a save (Section 14, `dcc.submit_on_behalf`); no screen offered it. The owner chose
this version from clickable copies of the Record page and the Sunday screen, beside their Claude
Design, which gives every row of that list a Record button.

## The ruling

**1. Another leader's DCC row in *People I oversee* carries Record beside See checklist.** This ends
decision 0301 point 3's exception: every row now carries the action that resolves it (Section 19).
See checklist still opens that leader's month, read only.

**2. Record opens the Sunday recording screen for that leader**, showing their checklist for that
Sunday: the people whose record they owe (Section 9), in the sections decision 0312 gives, their 12
first, then any leader beneath them who holds no account.

**3. Under the date, a red box reads** *"Recording for {leader}. These are the people {leader}
records. It is saved under your name, and {leader} sees it on their own checklist,"* followed by the
link *Back to your own checklist*.

**4. Who may: anyone holding `dcc.submit_on_behalf` over that leader.** By default that is a leader
for anyone beneath them, and an administrator or Senior Pastor for anyone in the church. Record is
offered only where that holds, so never for the actor's own upline or for anyone outside their
branch.

**5. One new read, `GET /api/v1/dcc/events/{id}/leaders/{leaderId}/roster`**, guarded by
`dcc.submit_on_behalf` against that leader.

**6. Saving uses the existing route**, `POST /api/v1/dcc/events/{id}/submit`, which already checks
every line.

**7. The record is saved under the name of the person who recorded it** (`recorded_by`).

**8. It still counts as that leader's obligation in every report** (Section 20).

**9. Changing a mark already recorded still needs `dcc.correct_subtree`.**

**10. Partial saves are kept**: not everyone needs a mark before saving, on this screen as on the
actor's own.

## Why

An upline following up a downline's DCC records could see what was missing and do nothing about it
from the screen that showed it. The box is there because the screen is otherwise the actor's own,
and recording somebody else's people should never be mistaken for recording one's own.

---

Decision 0313, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-04 — A DCC checklist shows your 12 first](0312-a-dcc-checklist-shows-your-12-first.md)
