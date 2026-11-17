# 2026-11-17 — *# of People* counts Cell Members, Cell Leaders and those Not in a Cell

Owner ruling, 2026-11-17, from screenshots of the Senior Pastors' *People* and a Full view
leader's *# of People*, on a phone and a laptop, today beside the change, settled one question at
a time. The owner asked that Bishop Oriel's People page show how many of his people are in a Cell
Group and how many lead one; asked whether somebody who leads no Cell is a member, answered "I
think they need to be inside a cell group"; asked for a column counting the people "who is not yet
included in the cell"; and answered "Yes, as shown", "Yes, month's last day", "Yes, same four" and
"Yes, keep one line"; and, asked by `architecture-guardian`'s review whether members of a Cell
closed as created in error count, "Yes, Not in a Cell".

## The ruling

**1. *# of People* is split in three, beside its Total.** Every box and every row of the table
carries four figures, in this order:

- ***Cell Members***: the people counted who hold a Cell membership at the count's instant and
  lead no Cell then.
- ***Cell Leaders***: the people counted who lead a Cell at that instant.
- ***Not in a Cell***: the people counted who do neither.
- ***Total***: the people counted, today's *# of People* figure, renamed.

**2. A person is counted in one of the three, so they add up to the Total**, in every row, the
root's own row, *Others* and every box. Somebody who leads one Cell and is a member of another
(decision 0353) is counted under *Cell Leaders* alone. Each column also adds up down the table,
as *# of People* does (Section 20).

**3. They are counted when *# of People* is**: a month that has ended at its final millisecond,
the current month as of now (decision 0326), over the people that month's *# of People* counts
(decision 0339 leaving out a Person outside the pastoral tree), so an ordinary join or move made
later does not move a month that has ended. A backdated change, a merge (decision 0012) or a
closure as created in error can, as they can move any figure of a month that has ended.

**4. A Cell closed `CREATED_IN_ERROR` gives nobody a membership or a leadership at any instant**,
the months before its closure included, so its members and its leader count as they would without
it: a member as *Not in a Cell*, unless they are in another Cell. The leadership half follows
decision 0330, which takes such a Cell out of *# of Cell Leaders*. The membership half is the
owner's answer, 2026-11-17, "Yes, Not in a Cell", given knowing that *CG Attendance* still counts
attendance recorded at such a Cell (by owner choice), so a month may say somebody attended a Cell
meeting while counting them in no Cell.

**5. *Cell Leaders* here is *# of Cell Leaders* read over the people counted.** It counts the
leaders of the same Cells, at the same instant, and differs only where a leader is not among the
people *# of People* counts.

**6. Every reader of *# of People* sees the four**: the two Senior Pastors' *People*, with its
*Men* · *Women* · *Both* switch, each Network its own four; a Full view leader's *# of People* for
their own branch, and a Primary's 12 opened from the Senior Pastors' *People*; and the Admin's and
a Network Admin's *Counts*, which show the same panel. The four boxes are side by side from `sm`
up and two by two on a phone, each saying when it is as of. The table's columns are *Primaries*
(or *Leader*), *Cell Members*, *Cell Leaders*, *Not in a Cell* and *Total*.

**7. *Yearly* stays one line**, the Total, month by month. The split is read on *Monthly*, a month
at a time.

## Why

A pastor reading *# of People* wants to know how many of those people a Cell Group is caring for,
and how many are waiting for one. *Not in a Cell* is that second number. It uses the rule of
`Cells`' *Awaiting CG Assignment* (decision 0233), where leading a Cell counts as having one, though
the two are counted differently: that list is the reader's people as they are now, and this figure
a month's people, placed as *# of People* places them, so the two agree only for the current month
over the same people.
Counting a leader once is what lets the three add up to the Total, so a reader can check a row by
adding it, which Section 20 asks of every figure.

## What it does not settle

Whether a Cell's leader is a member of their own Cell, which `CLAUDE.md` keeps open. A leader is
counted under *Cell Leaders* whatever the answer, so this ruling does not need it. Section 15's
*Unique Cell People*, which is listed and not defined, is not defined by *Cell Members* either:
one counts attendance, the other memberships.

## Where it lives

`SKILL.md` Section 19 (the Senior Pastors' and a Full view leader's tabs) and Section 22's route
list. `GET /api/v1/reports/church-counts` and `GET /api/v1/reports/counts/branch` add
`cell_members`, `leading_a_cell` and `not_in_a_cell` to every set of figures, as both answer the
same set, and `GET /api/v1/reports/people/branch` answers each of `total`, `own` and a row as
`people` with the same three beside it. The members are read from
`cells` (`CellsReadService.membersInForceAt`), which owns `cell_memberships`.

Previous: [2026-11-16 — Every account holder ticks that they have read the Privacy Notice](0496-every-account-holder-ticks-that-they-have-read-the-privacy-notice.md)
