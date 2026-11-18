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

**3. The Equipper.** A new role, `EQUIPPER`, given by the Admin (point 3a says how),
holds `equipping.manage` at Whole Church (the owner chose "Equipper Admin" and "Equipper";
this ruling builds the Equipper, and the Equipper Admin follows with posting grades). The
Admin holds it too, by default ("the admin sees everything"). It is held alone, as
`NETWORK_ADMIN` is. The account shows the person's real name with "Equipping account" under
it, never a second name. It signs in with the second step ("the Equipping account gets the
second sign-in step", 2026-11-17) and its session ends seven days after sign-in, as an
Admin's does ("7 days", 2026-11-18).

**3a. The Equipping account is a Person record of its own, in no count of people** (owner,
2026-11-18: "can we decide two different person instead so it will not be confusing?" and
"the equipping account is not count of people"). This replaces the choice of 2026-11-17, two
emails tied to the same Person, which Section 6's one account per Person forbade. The Admin
creates the record and the account together, by its own form, as a Network Admin's are
(decision 0469). Like a Network Admin's record it is outside the pastoral tree and the Cells,
has no disciples and no DCC line, and is in no count of people (decision 0339); a Network Admin
reads it and never changes it. A leader who also runs the school therefore has two records;
the duplicate check names one to the other when the Equipping record is made. What archiving
does to the Equipping account is in point 12, not in the owner's words.

**4. Its screens are the steps, in the sidebar.** An Equipper's sidebar is `Registration` and
`Enrollment`, the six steps' first two in their order, and nothing else. The Admin has one
`Equipping` item whose tabs are the same two. A phone shows them in the bottom tab bar, as
every account's items are (owner, 2026-11-18, choosing from screenshots of both; a switch at
the top of the page was the first plan, and would not hold the four steps still to come).

**5. A registration is a person, a level and a term.** The person is chosen from the system,
never typed. A term is "Term 1, 2 or 3" of a year, three a year, with no dates yet. One
registration per person, level and term; a second is refused. Nothing records money: "fees
are paid by bank transfer outside the app".

**6. Life Class has six requirements.** Four are read from the records when the person is
picked, and two are ticked by the Equipper after asking the person's leader. The owner first
chose three ticks ("i will stick to three tickbox") and withdrew *consistent in devotion* on
2026-11-18 ("remove the tick of consistent in devotion"):

| Requirement | Read from |
| --- | --- |
| Has a leader | an open pastoral assignment (Section 5) |
| Regular in a Cell Group | Cell classification, `Regular` being five or more meetings attended (Section 12) |
| Regular in DCC | DCC classification, five or more Sundays (Section 9) |
| SUYNL: lessons 1 to 4 | a current SUYNL row for each of lessons 1, 2, 3 and 4, whatever else is recorded ("must have SUYNL lesson 1 - 4 ticked regardless he or she is ticked 5 7 8 9", 2026-11-18, replacing "at least 5 lessons ... regardless of lesson") |
| Has a physical Bible | ticked by the Equipper |
| Has the Life Class Manual | ticked by the Equipper |

Each tick is saved with who ticked it and when. The two ticks are always required.

**7. A record that is not met warns; it does not block** ("ok just warn"). When any of the four
is not met, registering asks "Why register them anyway?", which is required, and the
registration is saved as *Registered with exception* with the reason and the requirements
not met. The reason is audit logged, and the Equipper Admin will review them. The owner
chose this knowing that DREAMS holds only the attendance recorded since it started, so a
long-faithful member can read as a 3rd Timer. Revisit blocking once a year of attendance is
recorded.

**8. This amends Section 28's "the order is displayed and never enforced."** That sentence
stands for Training's graduations. It no longer stands for registering for Life Class, where
SUYNL lessons are a requirement, and so is the gate Section 28 records as withdrawn, in a
different shape: lessons 1 to 4 by number, at Life Class rather than at the Encounter, and a
warning rather than a refusal.

**9. A registration is never deleted.** Its status is *Registered*, *Registered with
exception*, *Enrolled* while it is in a class, or *Cancelled*, with a reason, by an Equipper.

**10. A class belongs to a level and a term, and somebody runs it.** It carries a name, a day
and time, a place, the day of its first lesson, its Teacher (a Person), and its Encounter
season. Any number of classes in a term ("you can have more class per term"). Every class
records who runs it, and for now that is always the church: "all primaries will set their
class respectively" is the plan for later, and each class carrying its runner is what lets
that be turned on without rebuilding. The Teacher is recorded now and gains their own access
to the class's weekly grades with that step.

**11. Enrolling takes several registered people into one class at once**, and checks two
things that are never overridden:

- **A birthday is recorded** ("birthday is required to enrol", 2026-09-29).
- **The person is 15 on the first day of the Encounter weekend of their own Network** in the
  class's season (2026-09-29: "must be 15 on the day the Encounter weekend starts; 14 is
  refused"). The Encounter is Life Class lesson 5 (decision 0295), so Life Class is where the
  age is checked.

One class per person per level per term. A person is moved to another class of the same
level and term, or withdrawn with a reason; an enrollment that ends is kept, with when and
why it ended. A move keeps the registration, so what later steps record carries with it
("Move (keeps grades)", 2026-11-17).

**12. Archiving and merging** (2026-11-18). The owner was told that, unless they said
otherwise, these would follow the recommendation shown, and answered the session question
alone; they are recorded here as that recommendation, and the owner may still change them.
Archiving a Person ends their open class place (`ARCHIVED`) and cancels their registration
with the reason "Archived", keeping both. Archiving the Equipping record disables its account and
does not offer keeping it; archiving the person's own record does not touch it. Enrolling and moving refuse an archived or merged
Person. A merge is refused while the duplicate holds an open registration. Each person the
Equipper opens on the registration form is recorded for the Admin as a full-record read is
(decision 0414).

**13. The Equipping record is the one exception to one record per person** (owner, 2026-11-18,
"ok" to the proposal shown from screenshots of two records of one person). Section 1's first
principle names it. A merge is refused while either record holds an Equipping account, in
either direction. Only the Admin finds it: "only the accounts of equipping is visible in super
admin search". Every people search and picker leaves it out for anybody not holding `ADMIN`, a
Network Admin included, and its page answers `NOT_FOUND` to them; the Admin's search marks it
*Equipping account*.

## Why

The owner is building a school in the church, and its records have to sit beside the people,
leaders, attendance and SUYNL they are checked against. A separate application was considered
and refused: it would need a copy of those records kept in step, and two copies of a person
drift apart.

## What it does not settle

- The Equipper Admin, Faculty, make-up lessons, weekly grades, final grades and posting them.
- What "Regular" means beyond Sections 9 and 12, and whether to add "attended recently".
- The Encounter as its own registration after Life Class, which would replace decision 0295.
- Whether a student may join a class a Primary runs for other people, and whether a Primary
  acts as their own class's Equipper.

Previous: [2026-11-17 — *# of People* counts Cell Members, Cell Leaders and those Not in a Cell](0498-number-of-people-counts-cell-members-cell-leaders-and-those-not-in-a-cell.md)
