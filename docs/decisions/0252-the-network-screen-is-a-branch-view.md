# 2026-09-18 — The Network screen is a branch view, and it carries its figures with their month

Section 22 names the tree routes and no ruling said what the Network screen shows. The owner's
Claude Design handoff draws it as a branch view with figures. A screen without figures was
built on 2026-09-17 from rulings that never consulted that design; the owner rolled that work
back on 2026-09-18 and decided each part again with the design beside it. This records what
was decided.

## The ruling

**1. The screen shows one person's branch.** A breadcrumb, a focus
block for the person in focus — their member ID, where they sit, and who they report to — and
that person's direct reports, twenty at a time.

**2. The structure is the pastoral tree in force now**, guarded by `people.view_subtree`. Its
headcounts — direct reports and people beneath — are counts of that tree now. **Cell Leaders
beneath** counts the people beneath who are current Cell Leaders now (Section 11, decision
0025), read under `cell.view_subtree`.

**3. Each row shows two figures for the current month, never added together**: DCC records
behind and Cell meetings behind. Each is a sum, over that row's branch as it stands now, of
each leader's own obligations left unmet — for DCC the leader-events decision 0224 counts on
events that have happened (decision 0229), for a Cell the scheduled meetings whose day has begun
(decision 0238) with no record, each owned by the leader who led the Cell on its date (Section
20). DCC is read under `dcc.view_subtree` and Cell under `cell.view_subtree`; a reader lacking
one sees neither that figure nor a zero. The month is always named and marked as still open
(Section 17). Past months are read in Reports (decision 0254).

**4. Rows are ordered by name.** No figure is coloured and nothing is ranked (Section 13). A
filter showing only rows where either figure is above zero is permitted, because Section 13 permits filtering.

**5. A row's name and its Open control focus that person.** "Up one level" is unavailable on
the reader's own node. A Move control is offered on each row to a reader holding
`people.manage_pastoral_assignment` and opens the reassignment Section 5 governs, whose refusals are the API's. This reverses the
owner's choice of 2026-09-15 to move people only from their profile, which was recorded in a
code comment and in no ruling.

**6. Search finds people by name**, through the People search of decision 0244, ten at a
time. Choosing a result focuses them.

**7. The tree hands nothing to Reports.** A leader's figures for a period are read in Reports,
which owns the period.

---

Decision 0252, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-17 — The recording queue is a route of its own, and it reaches a closed Cell](0251-the-recording-queue-is-a-route-of-its-own.md)
