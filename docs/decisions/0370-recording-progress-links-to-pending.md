# 2026-10-19 — Recording Progress links each count to its Pending list

Recording Progress (decisions 0325 and 0334) and the two Pending lists (decisions 0336 and
0368) answer one question two ways: who has not recorded. Recording Progress counts it, one
row per leader of the reader's 12 or of a root's Primaries, for a week or a month; Pending CG
Records and Pending DCC Records list each meeting and Sunday still open, with Record. A
Primary reading "2 leaders still to record" against a leader had to leave the tab and find
that branch in the other one. On 19 Oct the owner chose, from real screenshots, to join them
rather than merge them (option B2).

## The ruling

1. **Each row's two figures link to the Pending lists.** On Recording Progress, the Cell group
   figure opens *Pending CG Records* and the DCC figure *Pending DCC Records*, each narrowed to
   that row's leader and everyone beneath them. A figure links only where the period shown is
   still open, somebody in it has not recorded, and that leader is within the list's scope now
   (owner, 2026-10-19): a row is named for its period, and a leader moved out of the reader's
   branch since then would be refused, so their figure stays plain text, as does a figure with
   nothing outstanding, a closed period, and the *Others* line. The server says per row whether
   that leader is within the list's scope now, as `opens_pending`; whether the period is open
   and how much is outstanding come from the same response.
2. **The narrowed list says so**, naming the leader whose branch it shows, with *Show
   everyone* to clear it. Search, the Network filter and *Late only* still apply within it.
3. **The links are where the Pending lists are**: a Full view leader's Recording Progress and
   the Admin's. The Senior Pastors' Record has no Pending lists (decision 0325), so their
   Recording Progress carries no links.
4. **Both routes take `?leader_id=`**: `GET /api/v1/cells/meetings/pending` and `GET
   /api/v1/dcc/pending-leaders` keep only the rows whose leader is that person or beneath them
   in the tree now, within the reader's own scope. The person must be within that scope, or
   the request is refused `SCOPE_DENIED` whether or not they exist; one inside it who names
   nobody, a Person absorbed by a merge included, answers `NOT_FOUND`. This is decision 0253's
   order for a report's scope selector, applied here by the owner's ruling and written into
   Section 7.
5. **The two may not match exactly, and need not.** A Recording Progress row counts the leader
   and everyone beneath them on Section 20's placement graph for its period, and counts closed
   weeks inside a month, and a Cell meeting against the leader who led it that day (decision
   0187); the Pending lists hold only what is still open, under the leader who files it now. The
   link shows what can still be done in that branch, which is what it is for, and an empty list
   says so.

Nothing changes about what is owed, who may record it, or any figure.

## Why

Two tabs that answer one question in two shapes are worth keeping when the shapes do
different work: the counts show a period, closed weeks and lateness, and the lists show what
can still be fixed and offer Record. What was missing was the path between them. A merged tab
would have mixed periods already over with items still open, and re-ruled decisions 0334 and
0368 to do it.

Decision 0370, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7 and 19 and the route list in Section 22.

Previous: [2026-10-19 — A new Cell's three members are people the leader asking oversees](0369-new-cell-members-are-people-you-oversee.md)
