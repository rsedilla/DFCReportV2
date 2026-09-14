# 2026-09-14 — The sidebar is Record, Reports, People, Cells and Network, and a whole-church reader starts on Reports

Section 19 set out an eight-item leader sidebar — Dashboard, My People, My Network, DCC
Attendance, Cell Attendance, Cell Leaders, Network Summary, Search — and said of Senior
Pastors only that their navigation stays "similarly compact". The application's sidebar
had drifted from both: it carried a `DCC Figures` entry no list names, and `Cell
Attendance` pointed at a page of figures rather than at anywhere attendance is recorded.

The owner commissioned a redesign and ruled that where the design and Section 19 disagree
about the sidebar, the design wins.

## The ruling

**The sidebar has five items: `Record`, `Reports`, `People`, `Cells` and `Network`.**
`Account and session` sits in the sidebar's footer under the signed-in person's name, and
is not a navigation item.

**What you fill in is under `Record`, and what you read is under `Reports`.** Each module
keeps its section and its name; what changes is the label that reaches it.

| Section 19 item | Reached from |
| --- | --- |
| Dashboard | `Record` — the Dashboard *is* the `Record` item |
| DCC Attendance and Cell Attendance, recording | `Record` |
| DCC Attendance and Cell Attendance, figures | `Reports` |
| Network Summary (Section 16) | `Reports`, when it is built; its Tree view is what `Network` shows |
| My People and Search | `People` |
| Cell Leaders (Section 15) | `Cells` |
| My Network | `Network` |

**A Cell's meeting screens are recording, so they sit under `Record` wherever they are
reached from** — a Cell's list of meetings and the screen a meeting is recorded on,
whether a leader arrives from Record's outstanding work or from a Cell under `Cells`. The
first version of this ruling said recording belongs to `Record` and the application marked
these screens as `Cells` anyway, because their address begins with a Cell's; review
raised it as a question the ruling had not answered, and the owner settled it here.

**The order, and the screen a person lands on, follow the reach of `reports.view_subtree`.**
An account holding it at `WHOLE_CHURCH` sees `Reports · Record · Network · People · Cells`
and lands on `Reports`. Every other account sees `Record · Reports · People · Cells ·
Network` and lands on `Record`. By the role defaults that is the two Senior Pastors and
Admin in the first arrangement, and leaders in the second.

**When the Admin dashboard is built, it adds an `Admin` item for the accounts holding the
capabilities that screen needs, and becomes their landing screen.** Which capabilities
those are is not settled here: the screen's planned contents span several, and naming one
now would hide the item from somebody granted another. It is recorded as open.

*The first version said the item was "for administrators", which keyed a sidebar item to
a role in the ruling whose ground is that the sidebar never follows one. Review raised it
and the owner settled the wording.*

## The ground

**The split between recording and reading is the one a leader already makes.** The old
list named modules, so one module that is both recorded and read — DCC Attendance, Cell
Attendance — occupied one entry that could only lead to one of the two, and the
application resolved it differently for each: its DCC entry led to the recording calendar
and its Cell entry to figures. Two verbs make that choice once, for every domain.

**A Senior Pastor still records.** Section 19 says a Senior Pastor has "no attendance of
their own to record", and that is true of their own attendance. It is not true of the
records they owe: Section 9 puts a person's DCC record on the checklist of the nearest
account-holding leader above them, so a Senior Pastor's direct disciples are on that
Senior Pastor's checklist — which is how a Network root with no account left their
disciples on nobody's checklist. So `Record` stays in that arrangement, second rather than
first.

**The arrangement is decided by a capability, not by a role, because Section 7 makes a
capability and its scope the thing that decides.** A whole-church reporting grant is exactly
the property that makes `Reports` the useful first screen. It is also what the client can
read today: `GET /api/v1/auth/me` returns the account's grants and no role
(`api/src/auth/auth.service.ts`). That is a fact about the response rather than a rule, and
an additive field could change it without moving this ruling.

*The owner's approved proposal gave the Senior Pastors and Admin two different orders,
differing only in whether `Network` or `People` comes third. No grant distinguishes the two
roles for that purpose, so this ruling records the one order both receive rather than
reading a role through a proxy. The proposal is recorded so a reader does not reconstruct
two orders from it.*

**The design's own handoff disagrees with its drawing, and the drawing is what was ruled
on.** Its vocabulary table says the sidebar label is `DCC Attendance`, and that `Cells` is
`Cell Groups`. Neither appears in the sidebar it draws, and neither is adopted.

## What this does not do

**It changes no authorization.** Which links a person sees is courtesy; what a screen
returns is decided by the API (Section 1, Principle 4). A leader who types a reporting
address still receives their own scope.

**It removes no screen and redesigns none.** Every screen reached before is reached after.
Merging the two figures pages under one `Reports` screen, and the recording surfaces under
one `Record` queue, is later work with rulings of its own where it needs them.

**The sidebar still carries no counts** (Section 19, The sidebar is navigation).

**It settles nothing else the design proposes.** Its default ordering by coverage, its
coloured status tags, its single name field, its classification correction, its yearly
view and its export each disagree with the specification or name a route that does not
exist. Nor does it adopt the design's product name or its visual language.

*This said each of those "is a ruling of its own". When the owner took them one at a time the
same day, none became one: the specification already answered four of them, export was
left open (PR #127), and the yearly view was left out of the pilot while the questions it rests
on stay open. `docs/DESIGN_RECONCILIATION.md` records each outcome.*

---

Decision 0245, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-13 — The People screen lists the searcher's own scope, and the pickers keep the church](0244-the-people-screen-lists-the-searchers-own-scope.md)
