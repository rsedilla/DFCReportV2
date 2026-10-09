# 2026-10-09 — The Senior Pastors' screens

Decision 0325 gave the two Senior Pastors their own `Record`. The owner designed the rest of what
they see from the running application with the proposal laid over it, one question at a time, on
2026-10-08 and 2026-10-09. They read the church and delegate the work: an administrator does
the changes.

## The ruling

**1. An account holding `SENIOR_PASTOR` has three sidebar items: `Record · Reports · Trends`.**
`Record` is decision 0325's. There is no `People`, `Cells` or `Growth` item. A person's page and a
leader's branch still open from a name on these screens, under the read capabilities they keep.
The API tells the client which screens an account has (decision 0323, point 5).

**2. The role no longer holds fourteen of its write capabilities:** `people.create`,
`people.edit_basic`, `people.manage_lifecycle`, `dcc.correct_subtree`, `cell.correct_subtree`,
`cell.manage_membership`, `cell.manage_leadership`, `cell.manage_configuration`,
`cell.manage_lifecycle`, `suynl.confirm`, `training.confirm`, `training.confirm_on_behalf`,
`conquest.confirm` and `conquest.confirm_on_behalf` (owner, 2026-10-09). It keeps every read
capability, `dcc.take_attendance`, `cell.take_attendance`, `cell.request_leadership` and
`people.manage_pastoral_assignment`, so they still record what they owe, a moved meeting, a
changed mark or a status correction aside, and still move a person to a new leader (decision 0002). Without
`cell.manage_lifecycle` they cannot ask for a Cell to be handed over or restarted (Section 10). An
administrator archives, corrects, files and asks instead.

**3. Their `Reports` has five tabs:** *CG attendance*, *DCC attendance*, *Number of Cells*,
*Number of people* and *Encounter candidates*. Each shows Whole Church figures first, then one
table for each root's direct leaders, the Men's root first, each headed by the root's title, name
and number of rows, with an *Others* line so the rows and *Others* add up to the figures above —
except CG attendance, which keeps decision 0293's two lines, once under both tables, because a
person at Cells in two branches is in both rows. Each Senior Pastor sees both tables in full, which extends decision
0325's exception to Section 13 to these tabs and to Trends' *Show* list.
Rows are in surname order, never sorted by a figure, with no row numbers, colour, percentages or
bars, and each name opens that leader's report. On a phone each row is two short lines.

- **CG attendance and DCC attendance** are decisions 0293 and 0294 for a Week, Month, Quarter or
  Year with previous and next: Total, VIP, 2nd timer, 3rd timer, 4th timer and Regular.
- **Number of Cells** is monthly, with previous and next: Cell Groups, Youth, Young Pro, Couple and
  Cell Leaders, counted at the month's final millisecond — the Cells `ACTIVE` then, by the category
  in force then, and the people leading one then (Section 11). The current month is counted as of
  now and says *so far* (owner, 2026-10-09). A row counts the Cells whose leader then is that leader or anyone beneath them.
- **Number of people** is monthly in the same way: every current Person at that instant, a row
  counting that leader and everyone beneath them (Section 16's Total People), whether or not they
  attended (owner, 2026-10-09).
- **Encounter candidates** is one figure, as of now: current people holding four or more current
  SUYNL lessons and no current Encounter or Life Class graduation (owner, 2026-10-09). It is a
  count and refuses nobody (Section 28). A row counts that leader's branch now. The Encounter
  seasons and the getting-ready table of decision 0297 are not shown to them.

A month's rows use Section 20's placement graph at the period's final millisecond, as decision
0325 does, and refuse where Section 20 refuses it; Encounter candidates uses the tree as it stands
now, as decision 0297 does. Every figure here and in Trends is read under `reports.view_subtree` at
Whole Church, and Encounter candidates under `suynl.view_subtree` at Whole Church as well.

**4. `Trends` draws one figure over the last twelve months, one point a month**, the current month
marked *so far*. The reader chooses CG attendance, DCC attendance, Number of Cells or Number of
people, drawing the figure that tab leads with — Total, Cell Groups or People. It shows three
lines: Whole Church, and each root's branch, named by its pastor with their Network beside
(decision 0294). The lines are told apart by weight, dash and a name at the line's end, not by
colour, and the same figures follow in a table. A month the figure cannot be read for is left out
and says so, as on the year view (decision 0257). A *Show* list names both roots' direct leaders; choosing one draws that
leader's branch as a single line. **One leader is drawn at a time, never two**, so that the graph
cannot become the ranking Sections 13 and 17 forbid.

**5. What the build's tests must show**, at the API: a Senior Pastor is refused each of the
fourteen capabilities in point 2 and still records their own DCC and reassigns within either
Network; on each tab of point 3 the rows and *Others*, or decision 0293's lines, add up to the Whole Church
figures; the Number
of Cells categories add up to Cell Groups; a Cell closed, created or recategorised in a month is
counted as it stood at that month's final millisecond; Encounter candidates leaves out somebody
with three lessons and somebody holding an Encounter or Life Class graduation; and a Leader
account is refused the Number of Cells, Number of people and Trends figures.

---

Decision 0326, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-08 — The Senior Pastors' Record screen](0325-the-senior-pastors-record-screen.md)
