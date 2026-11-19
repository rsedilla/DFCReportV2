# 2026-11-17 — Equipping: registration and enrollment for Life Class

Owner rulings of 2026-11-17, settled one question at a time from screenshots of the real app
changed for the picture (`.claude/tmp/people-cards/equip-*`, `warn-*`, `enroll-*`). The owner is
building a school in the church, and asked for it to be built on a branch that is not merged.
Each point below quotes or states the answer it rests on.

## The ruling

**1. DREAMS runs the church's school, and it is called Equipping.** It is a new module,
`equipping`, owning its own tables (Section 2). Its first two steps are built:
**Registration**, signing a person up for a level in a term, and **Enrollment**, putting a
registered person into a class. Faculty, make-up lessons, weekly grades, final grades and
posting grades follow, each by its own ruling. "We will first to have registration in life
class": Life Class is the only level for now.

**2. It replaces the enrolment application Section 28 expected.** Section 28 left a school's
enrolment and lessons to "an enrolment application planned elsewhere". That application is
this module. Training's graduations are unchanged by this ruling: nothing here files one, and
a graduation from a posted final grade is a later ruling.

**3. The Registrar.** A new role, `REGISTRAR`, given by the Admin (point 3a says how),
holds `equipping.manage` at Whole Church (the owner chose "Equipper Admin" and "Equipper";
this ruling builds the Equipper; the owner named it the **Registrar** on 2026-11-18, built here on
2026-11-20 before this branch merged, so the role is `REGISTRAR` throughout; the owner dropped the
Equipper Admin on 2026-11-19, the Registrar posting results and the Admin reviewing exceptions).
The Admin holds it too, by default ("the admin sees everything"). It is held alone, as
`NETWORK_ADMIN` is. The account shows the person's real name with "Registrar account" under
it, never a second name. It signs in with the second step ("the Equipping account gets the
second sign-in step", 2026-11-17) and its session ends seven days after sign-in, as an
Admin's does ("7 days", 2026-11-18).

**3a. The Registrar account is a Person record of its own, in no count of people** (owner,
2026-11-18: "can we decide two different person instead so it will not be confusing?" and
"the equipping account is not count of people"). This replaces the choice of 2026-11-17, two
emails tied to the same Person, which Section 6's one account per Person forbade. The Admin
creates the record and the account together, by its own form, as a Network Admin's are
(decision 0469). Like a Network Admin's record it is outside the pastoral tree and the Cells,
has no disciples and no DCC line, and is in no count of people (decision 0339). Only the Admin
reads it (point 13); to a Network Admin it answers `NOT_FOUND`, as to anybody else. A leader who also runs the school therefore has two records;
the duplicate check names one to the other when the Registrar record is made. What archiving
does to the Registrar account is in point 12, not in the owner's words.

**4. Its screens are the steps, in the sidebar.** A Registrar's sidebar is `Registration` and
`Enrollment`, the six steps' first two in their order, and nothing else. The Admin has one
`Equipping` item whose tabs are the same two. A phone shows them in the bottom tab bar, as
every account's items are (owner, 2026-11-18, choosing from screenshots of both; a switch at
the top of the page was the first plan, and would not hold the four steps still to come).

**5. A registration is a person, a level and a term.** The person is chosen from the system,
never typed. A term is "Term 1, 2 or 3" of a year, three a year, with no dates yet. One
registration per person, level and term; a second is refused. Nothing records money: "fees
are paid by bank transfer outside the app".

**6. Life Class has six requirements.** Four are read from the records when the person is
picked, and two are ticked by the Registrar after asking the person's leader. The owner first
chose three ticks ("i will stick to three tickbox") and withdrew *consistent in devotion* on
2026-11-18 ("remove the tick of consistent in devotion"):

| Requirement | Read from |
| --- | --- |
| Has a leader | an open pastoral assignment (Section 5) |
| Regular in a Cell Group | Cell classification, `Regular` being five or more meetings attended (Section 12) |
| Regular in DCC | DCC classification, five or more Sundays (Section 9) |
| SUYNL: lessons 1 to 4 | a current SUYNL row for each of lessons 1, 2, 3 and 4, whatever else is recorded ("must have SUYNL lesson 1 - 4 ticked regardless he or she is ticked 5 7 8 9", 2026-11-18, replacing "at least 5 lessons ... regardless of lesson") |
| Has a physical Bible | ticked by the Registrar |
| Has the Life Class Manual | ticked by the Registrar |

Each tick is saved with who ticked it and when. The two ticks are always required.

**7. A record that is not met warns; it does not block** ("ok just warn"). When any of the four
is not met, registering asks "Why register them anyway?", which is required, and the
registration is saved as *Registered with exception* with the reason and the requirements
not met. The reason is audit logged, and the Admin reviews them (owner, 2026-11-19). The owner
chose this knowing that DREAMS holds only the attendance recorded since it started, so a
long-faithful member can read as a 3rd Timer. Revisit blocking once a year of attendance is
recorded.

**8. This amends Section 28's "the order is displayed and never enforced."** That sentence
stands for Training's graduations. It no longer stands for registering for Life Class, where
SUYNL lessons are a requirement, and so is the gate Section 28 records as withdrawn, in a
different shape: lessons 1 to 4 by number, at Life Class rather than at the Encounter, and a
warning rather than a refusal.

**9. A registration is never deleted.** Its status is *Registered*, *Registered with
exception*, *Enrolled* while it is in a class, or *Cancelled*, with a reason, by a Registrar.

**10. A class belongs to a level and a term, and somebody runs it.** It carries a name, a day
and time, a place, the day of its first lesson, its Teacher (a Person), and its Encounter
season. Any number of classes in a term ("you can have more class per term"). Every class
records who runs it, and for now that is always the church: "all primaries will set their
class respectively" is the plan for later, and each class carrying its runner is what lets
that be turned on without rebuilding. The Teacher is recorded now and gains their own access
to the class's weekly grades with that step. **The Teacher must be a current Cell Leader in the
tree** (owner, 2026-11-18: "yes a teacher must be a cell leader in the tree structure", settling
the Stop Condition `architecture-guardian`'s fifth review raised, that opening a class accepted
by its identifier a Teacher the picker never offered): an open leadership of an `ACTIVE` Cell
(Section 11) and an open pastoral assignment, a Network root's included (Section 5). Opening a
class refuses anybody else as `INVARIANT_VIOLATION`, and the Teacher search lists only them. A
Network Admin and the Registrar record lead no Cell, and an administrator outside the tree holds
no assignment, so none of them may teach; the Registrar record answers `NOT_FOUND`, as below.
**The rule binds when a class is opened, not after** (owner, 2026-11-18, "Proceed A", settling
the Stop Condition `architecture-guardian`'s seventh review raised): a Teacher who stops leading
a Cell, or whose assignment ends, keeps teaching the class they were named to until it ends,
and is not offered for the next one. **The Teacher search showing only Cell Leaders is
accepted** (owner, 2026-11-18, "yes"), though it lets the Registrar tell from it whether a named
person leads a Cell, which Section 8's church-wide fields do not publish.

**11. Enrolling takes several registered people into one class at once**, and checks two
things that are never overridden:

- **A birthday is recorded** ("birthday is required to enrol", 2026-09-29).
- **The person is 14 on the first day of the Encounter weekend of their own Network** in the
  class's season (owner, 2026-11-19: "when the student is 14 during the encounter he can
  attend", then "yes 14 by the first day"). This replaces 15, the owner's answer of 2026-09-29
  ("must be 15 on the day the Encounter weekend starts; 14 is refused"), which the owner
  reversed knowing it. The Encounter is Life Class lesson 5 (decision 0295), so Life Class is
  where the age is checked.

One class per person per level per term. A person is moved to another class of the same
level and term, or withdrawn with a reason; an enrollment that ends is kept, with when and
why it ended. A move keeps the registration, so what later steps record carries with it
("Move (keeps grades)", 2026-11-17).

The people ready to enroll are a table on a wider screen and, on a phone, a card each (owner,
2026-11-18, choosing from screenshots of both; the table's four columns did not fit a phone's
width): the name beside its tick box, the reason a person cannot be enrolled under it instead,
then their leader, their age at the Encounter and how they registered. Each of the term's classes
is a button of two lines, its name and then its day, its time as said aloud and how many are
enrolled ("Tue 7:00 pm · 1 enrolled"), because a bare count beside a 24-hour time did not say
what it counted (owner, 2026-11-18, from screenshots of both); the form opening a class stays as
it was built.

Those who can be enrolled are listed first, with the Enroll button under them, and those who
cannot after, under *Can't enroll yet*, whose reason says what is missing ("No birthday
recorded."; "13 on 2026-12-04, the Encounter weekend. Must be 14.") and names nobody to ask:
the screen shown to the owner said "Ask their leader to add it." and its heading that the
leader fixes what is missing, and `architecture-guardian`'s fifth and sixth reviews found
both untrue, a leader being unable to mend an age, and a direct leader who is a Senior Pastor
or has no account being unable to add a birthday. Where more than one can be enrolled, one control ticks them all, and a saved Enroll
says back whom it placed ("Enrolled in Life Class A: …"). The owner chose this on 2026-11-18
from screenshots of the screen as built beside the proposal; the two checks are unchanged.

In the class's list, Move and Withdraw are outlined buttons, under the person's name on a phone
and beside it on a wider screen. Each dialog says what it does before it is used: a move keeps
the registration and anything recorded and makes the two checks again for the new class, whose
choices name their day, time and count; a withdrawal sends the person back to those ready to
enroll, is kept with its reason and cannot be undone, and taking them off Life Class for the
term is cancelling the registration. The withdraw button names the person (owner, 2026-11-18,
from screenshots of both). Nothing in what either does changed.

**12. Archiving and merging** (2026-11-18). The owner was told that, unless they said
otherwise, these would follow the recommendation shown, and answered the session question
alone; they are recorded here as that recommendation, and the owner may still change them.
Archiving a Person ends their open class place (`ARCHIVED`) and cancels their registration
with the reason "Archived", keeping both. Archiving the Registrar record disables its account and
does not offer keeping it; archiving the person's own record does not touch it. Enrolling and moving refuse an archived or merged
Person. A merge is refused while the duplicate holds an open registration. Each person the
Registrar opens on the registration form is recorded for the Admin as a full-record read is
(decision 0414).

**13. The Registrar record is the one exception to one record per person** (owner, 2026-11-18,
"ok" to the proposal shown from screenshots of two records of one person). Section 1's first
principle names it. A merge is refused while either record holds a Registrar account, in
either direction. Only the Admin finds it: "only the accounts of equipping is visible in super
admin search". Every people search and picker leaves it out for anybody not holding `ADMIN`, a
Network Admin included, and its page and pastoral path answer `NOT_FOUND` to them where their
scope would otherwise admit it (a reader outside it is refused as for anybody else); the Admin's
search marks it *Registrar account*. To the school it does not exist for the Admin either, being
an account's record and never somebody signed up for a class: the Equipping picker leaves it
out, and the registration form, registering and naming it a class's Teacher answer `NOT_FOUND` (owner, 2026-11-18, taking the
recommendation shown, "ok go with your recommendation", on the Stop Condition the fourth review
raised after the third review's fix had set the rule without a ruling). **The duplicate check leaves it out the same way** (owner, 2026-11-18, "ok
leave it out", settling the Stop Condition the third review raised): for anybody not holding
`ADMIN` it is neither listed nor shown as a line naming nobody, and adding or editing a Person
is never asked about it. It is a second record of one person on purpose, so the person's own
record beside it is no duplicate, and that own record still catches a real one. The Admin's
check lists it and asks about it as about anybody else.

## Why

The owner is building a school in the church, and its records have to sit beside the people,
leaders, attendance and SUYNL they are checked against. A separate application was considered
and refused: it would need a copy of those records kept in step, and two copies of a person
drift apart.

## What it does not settle

- Faculty, make-up lessons, final grades and posting them, which the owner decided on 2026-11-19 and
  a later ruling records; weekly grades were dropped the same day.
- What "Regular" means beyond Sections 9 and 12, and whether to add "attended recently".
- The Encounter as its own registration after Life Class, which would replace decision 0295.
- Whether a student may join a class a Primary runs for other people, and whether a Primary
  acts as their own class's Registrar.

Previous: [2026-11-17 — *# of People* counts Cell Members, Cell Leaders and those Not in a Cell](0498-number-of-people-counts-cell-members-cell-leaders-and-those-not-in-a-cell.md)
