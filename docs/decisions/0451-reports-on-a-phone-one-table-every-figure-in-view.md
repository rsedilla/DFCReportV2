# 2026-11-06 — Reports on a phone: one table, every figure in view

The owner looked at Reports in the installed app on an iPhone and found it hard to read. A
leader's Attendance showed each disciple as three wrapped lines ("Total 4 · VIP 1 · 2nd Timer 1 ·
3rd Timer 0 · 4th Timer 1 · Regular 1"), so twelve leaders took several screens and could not be
compared at a glance. # of Cell Groups ran off the right edge. The Senior Pastors' tables cut
off after "2nd Timer". The month bar broke onto two lines at 320 pixels wide. The table started
only after a heading line, a note about Yearly and a long sentence about when the period closes.
The owner chose each change below from screenshots of the app at 390 and 320 wide, and from a
comparison with how other apps lay out tables, figures and period pickers on a phone.

## The ruling

**Below `lg`, a Full view leader's and the Senior Pastors' tables under Reports are one table with
every figure in view.** These are a Full view leader's 12 on Attendance and their three # tabs,
and the Senior Pastors' Primaries tables on all five, which the Admin's Counts also shows. This
replaces decision 0365's two short
lines a leader, and the owner's of 2026-10-08 for the Senior Pastors' # tables. The number columns
are equal. The Admin's own Attendance table and a leader opened through *Figures for* keep their
form.

**A table with several figures shortens its headings and its names.**
- The headings read *Total · VIP · 2nd · 3rd · 4th · Reg*. On # of Cell Groups they read *Total ·
  J12 · Y · YP · C*, with the line *Y = Youth · YP = Young Pro · C = Couple* under the table.
- A leader's name is the whole first-name field and the surname's first letter, the title and the
  middle name left out: *John Andrew Peter E. Santos* is *John Andrew Peter S.* This is the
  owner's example, *Raymond S.*, and it sets aside on these tables Section 3's composed name
  (decisions 0271 and 0375).
- A Pastor or Pastora is the one exception to leaving the title out: the title is written *Ps*
  before the name, so *Pastora Lina Ocampo* is *Ps Lina O.* The owner asked for this on
  2026-11-07, after seeing the names without it. Any other title, *Bishop* among them, is left
  out.
- Where two in one table would read the same, each takes more of the surname until they differ
  (*John Andrew Sa.*, *John Andrew So.*). A group in which one would need its whole surname takes
  every whole surname (*John Santo*, *John Santos*), and two alike to the whole surname keep their
  full names. The comparison never stops on the space in a two-word surname.
- The name is built from the stored fields, never by splitting a full name: a surname may be two
  words (*Dela Cruz*) and a middle name a whole word. So each report row naming a leader now
  carries `first_name`, `last_name` and `title` beside `full_name`.
- The own row says *You*, *You · no Cell* or *You · 2 Cells*. Decision 0293's two lines read
  *Under 2+ leaders* and *Elsewhere in branch*.

**A table with one figure keeps full names.** # of People and # of Cell Leaders have room, and
shortening there would only lose information.

**A screen reader hears every heading and name in full.** A name that is a link is named by its
short form and then its full one, so a person speaking what it shows selects it (WCAG 2.5.3).

**A # tab's figures are tiles.** The label sits above the figure. A tab with one figure gives it
the whole row on a phone and a larger figure at every width. The first tile says *As of today* for
the current month, or *As of 31 October 2026* for one that has ended. That replaces *as at today,
so far* beside the month; the owner asked for *so far* to go.

**Under the date on Attendance, one short note or none.**
- A Full view leader's note says *As of today* while the period's records are still open (Section
  13), and on DCC names any Sunday with no service. Once its records have closed, a period with
  every Sunday held says nothing.
- The count of Sundays, the closing time ("Still open, until Mon, 4 Jan, 12 noon") and *Closed*
  are gone from that note. The closing time belongs to recording, and Record keeps it.
- The Senior Pastors' *so far* beside the month reads *As of today*, said under the bar on a phone. The Admin's *Open until* and
  *Closed* tags under Reports read *As of today* or nothing.
- Section 17 asks a report to say whether its period is open or closed. Under Reports an open one
  says *As of today* and a closed one says nothing, so the absence of the note is what says closed.
  The owner chose to hide *Closed*. Record's *Recording Progress* keeps its closing time and
  *Closed* tag.

**The month bar takes its box's width on a phone.** ‹ and › sit at the two ends with the period
between them on one line. A week inside one month reads *8–14 Jun 2026*.

**Two notes go.** "Yearly is a graph of the last 12 months, one point a month." is removed
everywhere: the Yearly button carries a graph, and opening it shows one. The heading line beside
*Reports* ("Who came to a Cell, and where they are in their journey.") is not shown on a phone.

**The note under Weekly is shortened** to "Weeks don't add up to the month: a person counts once."
Section 20's rule that periods are never added together is unchanged.

**From `lg`** the tables keep their full headings and names. Their columns become fixed equal
shares, and the tiles and the words change as above.

## Why

Phone tables elsewhere either keep few columns with short headings and right-aligned numbers, or
pin the name and scroll the rest. They name people by first name and surname initial, and keep
the "as of" note on the figure it describes. Period pickers step with ‹ and › and stay on one
line. A table a leader can read without scrolling sideways, and compare row by row, is what
Reports is for.

---

Decision 0451, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3, 17 and 19.

Previous: [2026-11-06 — A session ends thirty days after its sign-in, seven for an Admin or Senior Pastor](0450-a-session-ends-thirty-days-after-sign-in.md)
