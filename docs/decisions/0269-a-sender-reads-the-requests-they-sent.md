# 2026-09-21 — A sender reads the Cell leadership requests they sent, with no capability

Section 19 puts "the outcome of a Cell leadership request the user submitted" in every user's
own outstanding work, and Section 7 named no capability that could guard it. Nothing let a
requester learn whether a request was approved or declined. The owner chose this answer from a
drawing of the Record page, beside the app as built; the Claude Design handoff has no screen
for it.

## The ruling

**An account reads the Cell leadership requests it sent, with authentication and no
capability.** Section 7's second exemption widens by that one case: an endpoint returning only
records the caller's own account created, keyed on the caller's account and taking no
identifier from the request.

**`GET /api/v1/cells/leadership-requests/sent` answers them**, pending or decided within the
last 30 days, each with its kind, its state, the person it named, its Cell (a handover's, or the
one an approval minted), the Cell a restart resumes, and a decline's reason and note.

**The Record page shows them as "Your requests"**, state in words and never in colour, and
hides the block when there are none.

## Why

A request carries only what its sender asked and the decision on it, so reading it back
discloses nothing the sender's scope has to vouch for. The two alternatives, a new capability or
a reading of `cell.view_subtree` against the actor, would each gate a person's own request on a
grant somebody has to remember to issue.

---

Decision 0269, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — A reader outside the pastoral tree starts the Network screen at the roots](0268-a-reader-outside-the-tree-starts-at-the-roots.md)
