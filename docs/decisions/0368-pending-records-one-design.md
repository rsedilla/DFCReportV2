# 2026-10-18 — Pending CG Records laid out as Pending DCC Records, and Late only

Record's two Pending lists looked and worked differently. *Pending DCC Records* (decision 0336)
had one row per leader, each Sunday still open on its own line with its deadline, Record and
See checklist, a search, a Network filter for a whole-church reader, and fifty at a time.
*Pending CG Records* (decisions 0314, 0315 and 0340) had one row per Cell and month with a
count of meetings recorded, no search and no Record, and read every Cell of the reader's scope
on each visit. On 18 Oct the owner asked for one design for both, for the Admin and the
Primaries, and chose it from real screenshots.

## The ruling

1. **Pending CG Records has Pending DCC Records' layout.** One row per Cell and the leader who
   files its meetings, with a meeting that has come, has no record and whose week is still open
   (decision 0335), last month's included while its weeks are open (decision 0315), and a
   closed Cell's while its weeks are open. The
   row names the leader who files it, by first name, with the Cell under the name; each such
   meeting is a line of its own, oldest first, labelled as Update Records labels a row. It
   carries **See meeting**, and **Record** where the API says the reader may record the oldest
   meeting: their own, or on the leader's behalf (Section 14). Fifty at a time, with a search
   by Cell ID, leader or Member ID and, for a whole-church reader, a Network filter. A Cell
   handed over and then closed, whose meetings belong to each leader on their date (Section
   15), is a row for each leader.
2. **It is read at `GET /api/v1/cells/meetings/pending`**, under `cell.view_subtree` against
   the actor and narrowed to that capability's scope now, as Pending DCC Records reads its own
   under `dcc.view_subtree`: a Full view leader's whole branch and the Admin's whole church. A
   Cell is in it where the leader who files its meetings is — an `ACTIVE` Cell's current
   leader, a closed Cell's leader on the meeting's date (Section 7). It names no period, so it
   asks about now. Ordered by the leader's name and then the Cell ID, never by how much is owed
   (decision 0009).
3. **Both lists carry *Late only*.** `?late=true` on either route keeps only the items past
   their deadline whose week is still open, and the rows with one. A meeting or Sunday before
   the weekly rule has no deadline and is never late. Late stays a word, never a colour, and
   never an order.
4. **Its count says what has been read**, "50+" until the last page is read, as Pending DCC
   Records' does. This replaces decision 0340's point 4, which made the count exact by reading
   every page; the owner chose the shared count on 18 Oct, and the list no longer reads every
   Cell of the reader's scope on each visit.
5. **The same design serves the Admin and the Primaries**; what differs is the scope the
   server gives, the Network filter (shown only to a whole-church reader) and which rows carry
   Record (decided per row by the API).

Nothing changes about what is owed, who may record it or any figure.

## Why

The two lists answer the same question, what is still to record, and differed only because
they were built under different rulings five days apart. One design is one thing to learn, and
the Cell list's new shape lets it page, so Record no longer reads every Cell of the reader's
scope on each visit, which for the Admin was the whole church's. *Late only* is where the Admin
and a Primary can still make a difference, the items past due whose week has not closed.

Decision 0368, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 15 and 19 and the route list in Section 22.

Previous: [2026-10-18 — Correct sex and Change category](0367-correct-sex-and-change-category-screens.md)
