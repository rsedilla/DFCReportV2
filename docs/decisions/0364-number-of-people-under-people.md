# 2026-10-18 — # of People under People, in Branch's place

The Senior Pastors have a *# of People* tab under Reports (decisions 0326 and 0327): a month's
people for the whole church, then one table per Network root's Primaries. On 18 Oct the owner
asked for the Primaries to have it too, under the `People` item rather than Reports, and for it
to replace the `Branch` tab everywhere. They chose it from mocks and then real screenshots.

## The ruling

1. **`People` carries *Add People*, *# of People* and *Family Tree*.** *# of People* takes
   `Branch`'s place, on the screens a Full view leader and the Admin have, as the server names
   them (decision 0323, point 5).
2. **A Full view leader's *# of People* is their own branch for a month**: a box headed *Your
   Disciples* with its people, one row per direct disciple counting them and everyone beneath
   them, their own row, and a total. A name opens that leader's count, with a way back. It is
   counted as the Senior Pastors' is: a month that has ended at its final millisecond, the
   current one as of now, nobody outside the pastoral tree (decision 0339), and placed on
   Section 20's placement graph for the month, so the rows add up to the box.
3. **It is read at `GET /api/v1/reports/people/branch`**, under `reports.view_subtree` against
   a `LEADER` selector, guarded and dated as every leader-scoped report is (decisions 0207 and
   0214). A leader reads their own branch and the branch of anyone beneath them, and nobody's
   above or beside. A row is named only where that leader would be admitted as a selector, as a
   My 12 row is (decision 0254).
4. **The Admin's *# of People* is the Senior Pastors' figure**, the whole church and both roots'
   tables, from the route it already uses.
5. **`Branch` is linked from nowhere.** A name that opened it, on the Senior Pastors' *#* tables
   and on *Recording Progress*, opens the person's page. The screen still opens at its address
   and is otherwise unchanged; removing it is left for later. *Where they sit*, *Move to another
   leader* and *Family Tree* are unchanged.
6. **Section 19 puts figures on the Dashboard and under `Reports`; this one sits under `People`
   by the owner's ruling.** The Senior Pastors keep theirs under Reports, having no People item.

## Why

The owner wanted the count beside the people it counts, for the leaders who look after them, and
one way into the tree rather than two: *Family Tree* already shows the branch, and Branch's
figures repeat what *Recording Progress* shows.

Decision 0364, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-18 — The Primaries' report controls, and no coverage line](0363-the-primaries-report-controls.md)
