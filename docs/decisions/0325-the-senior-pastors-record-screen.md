# 2026-10-08 — The Senior Pastors' Record screen

The two Senior Pastors record little themselves: the two roots' own DCC lines and their direct
leaders' (decision 0322). What they need from `Record` is whether the church has recorded. The
owner designed their screen one question at a time, from the running application with the
proposal laid over it, on 2026-10-07 and 2026-10-08.

## The ruling

**1. An account holding `SENIOR_PASTOR` sees two tabs on `Record`: *Recording status*, which opens
first, and *Awaiting a record*, showing their own work only, with no *People I oversee* switch.**
It shows none of the other lists of Section 19 and no month figures; an administrator acts on
those. The API tells the client which screens an account has, from its honoured role (decision
0323, point 5).

**2. *Recording status* counts leaders, for a week or a month** (a week runs Monday to Sunday,
decision 0054),
chosen by a switch and opening on the current week:

- **A leader owes a record in the period** when a Cell meeting whose scheduled date falls in it
  has begun (Section 13) and they led that Cell on that date (the earlier-starting leadership on the day of a handover,
  decision 0187), its frozen responsible leader where
  the meeting has a record (decision 0163); a later handover never moves it (owner, 2026-10-08), or when, as of a DCC event in it that has begun and
  is not removed (decision 0229), they are the submitter of at least one DCC line (Section 9). They count whether or not their account
  is active. **Who held an account is read as of that event** (owner, 2026-10-08), so an account
  given later moves no past week or month.
- **A leader has recorded their Cell group** when every such meeting has a record, and **their DCC checklist** when each such event has a record for someone on it, whoever
  entered it, an administrator stepping in included.
- **Each leader counts once over the period, all or nothing** (owner, 2026-10-08). Decision 0224
  rejected that shape for coverage, which is unchanged; it is chosen here for this screen alone.
- **Two columns, Cell group and DCC, each "X of Y leaders"**, Y being the leaders who owed one.

**3. The whole church comes first, as two boxes**, one per column, each saying *Whole Church*
and showing the period before it underneath. **Each box also shows X as a percentage of Y** (owner, 2026-10-08). It is rounded
down, so it reads 100% only when X equals Y, and a box reading 0 of 0 shows none. No other
recording figure is shown as a percentage, and this applies to these two boxes alone.

**4. Then one table for each root's direct leaders**, headed by the root's title and name and how many rows it has.
The rows are the root's children on Section 20's placement graph at the period's final
millisecond, and each counts that leader and every leader beneath them on that same graph, with
no percentage. Where Section 20 refuses that graph, for a cycle or under decision 0212, the
tables and *Others* refuse and the boxes stand. **Each Senior Pastor sees both tables in full** (owner, 2026-10-08), the other
root's direct leaders beside their own on one screen, an exception to Section 13 for this screen
alone. Rows are in surname order, with no row numbers,
never sorted by a figure, and each name opens that leader's branch. **Under them an *Others*
line counts every leader who owed a record and sits in neither table** (owner, 2026-10-08): the
two roots, and anyone whose placement reaches neither table. So the rows and *Others* add up to
the two boxes.

**5. Each row, *Others* included, carries a status**: *Completed* where every leader the row counts recorded
everything they owed in the period, otherwise *N leaders still to record*, a leader missing both
counted once. **Completed is shown as a pale red label** (owner, 2026-10-08), an exception to
Sections 13, 17 and 19, which never show a status by colour, for this word on this screen alone.
The word carries the meaning without the colour, and the other status stays plain text. A row
where nobody owed anything says *Nothing owed*, in plain text.

**6. A period stays open while the submission window of any month it touches is open** (Section
13), and says so; after that it changes only as a closed period does (Section 20).

**7. A link at the foot, *See which Cells are behind*, opens Section 15's list.**

**8. What the build's tests must show**, at the API: the definitions in point 2 for a leader with
two Cells, a leader whose Cell's meeting day has not begun, a leader with no account, a leader
whose account is not active, a handover after a meeting's date and on its day, and a meeting
rescheduled across a period's edge; the whole church's Y for each column equals the sum of the two
tables' rows and *Others*, and so does its X, with a leader in neither table counted in *Others*; a row is Completed exactly when its leaders
owe nothing unrecorded, and its N counts a leader once; the tables and *Others* refuse where Section 20 refuses the graph;
and a reader without `reports.view_subtree` at
Whole Church is refused the figures.

---

Decision 0325, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-08 — People I oversee stops two levels down](0324-people-i-oversee-stops-two-levels-down.md)
