# 2026-11-27 — SOL 2 joins the school as SOL 1 did, with one book and only the Admin ticking a pass from before it

Owner rulings of 2026-11-27. Decision 0501 ruled SOL 1 to 3 (points 17 to 19), and decision 0514
built SOL 1. What 0501 ruled for SOL 2 stands unchanged and is not restated here: ten weekly
lessons and the same checklist grade as SOL 1, SOL 1 passed and the leadership of an `ACTIVE`
Cell now to enroll, a Guide who has passed SOL 3, and a SOL 2 Coordinator ticked on a Full view
account. This settles the three questions building it raised. **It is built in two steps**, each
its own pull request: signing up first (Registration, the SOL 2 pill on Enrollment and Classes,
the Coordinator tick, and the Guide search reading the Guide's condition), then the school itself
(opening classes, the register, the quiz and book, final grades, Training and the leader's *SOL 2*
tab). No SOL 2 class opens until the second step (point 4).

**1. Only the Admin ticks SOL 2 once its first class opens** (owner, "A, Admin only"). This is
the SOL 1 ruling of 0514 applied to SOL 2. Leaders tick SOL 2 on the Training tab as now until the
first SOL 2 class opens. From then on, only the Admin ticks or corrects a *Before the school*
SOL 2, with a reason, and a posted *Passed* files SOL 2 *From the school*. Two records of one pass
could otherwise disagree, which is 0501's reason for stopping leaders once the school runs a level.

**2. The SOL 2 book is one book** (owner, "A, one book"). The *Has the SOL 2 book* the Registrar ticks
at sign-up, with the date, is the book the student must read to pass. The sign-up form says the
SOL 2 book is the tuition, paid outside DREAMS, as SOL 1's says of its manual. The grade's *Book
read* means reading that same book.

**3. SOL 2 comes first, and SOL 3 after it** (owner, "A, SOL 2 only now"). SOL 3 is not built with
it. SOL 3's enrollment needs twelve direct disciples now, and its Guide needs at least three
direct disciples each leading an `ACTIVE` Cell (0501), and both wait for their own step. The code
for SOL 2 is written so that SOL 3 is a small step after it.

**4. No SOL 2 class opens before step 2** (owner, 2026-11-27, "B, refuse opening", raised by
`architecture-guardian` as a Stop Condition on step 1). Step 1 lets people sign up for SOL 2 while
SOL 2's register, final grades and Training are still SOL 1's alone, so a SOL 2 class opened in
between would save no attendance and show the wrong register. *Classes* at SOL 2 therefore offers
no *Open a class* and says instead that a SOL 2 class can be opened once DREAMS has SOL 2's
register and final grades, and that signing up is open now; the server refuses one too, the Admin
included, and so does the database, migration 0064 leaving `equipping_classes_level` at Life Class
and SOL 1. *Enrollment* at SOL 2 says the same, and *Final Grades* offers no SOL 2 yet. Step 2
removes all of these. So "its first class opens" in point 1 can only happen once the whole
of SOL 2 exists. Chosen from screenshots after a comparison with Moodle's notice for a course not
yet open, PeopleSoft's *Tentative* section, Canvas's refusal and Google Classroom's hidden option:
an action open to nobody is hidden and the reason shown, rather than greyed out.

**The first step is built** (migration `0064_equipping_sol_2.sql`). *Registration*, *Enrollment*
and *Classes* carry a *SOL 2* pill on the Level picker, from screenshots the owner approved on
2026-11-27 after a comparison with Google Classroom, Canvas, Moodle, PeopleSoft and UP's CRS. The
Register form reads *SOL 1 passed* and *Leads a Cell now* from the records and has the Registrar
tick *Has the SOL 2 book*, with the date, saying the book is the tuition, paid outside DREAMS. A
requirement not met warns and asks why, as SOL 1's do. The Admin ticks *SOL 2 Coordinator* on the
Account view, offered and kept only with Full view, which the database holds too, and the
*Coordinators* list carries a SOL 2 row. No SOL 2 class opens yet (point 4); when one does, it
names no Encounter weekend and its Guide has passed SOL 3.

**The second step is built** (migration `0065_equipping_sol_2_school.sql`), from screenshots the
owner approved on 2026-11-27: *Classes* at SOL 2 offers *Open a class* again, and the database
admits a SOL 2 class, the refusals of point 4 removed. A SOL 2 class's register, quiz and book,
final grades, checked and posted, and the Admin's change after posting are SOL 1's, a SOL 2 lesson
ticking the memory verse and devotional as a SOL 1 lesson does; a posted *Passed* files SOL 2 in
Training *From the school*, and a change after posting files or withdraws it. Once a SOL 2 class has
opened, a cancelled one not counting, leaders no longer tick SOL 2 (point 1): the Training tab tells
a leader "You tick SOL 3. The Encounter, Life Class, SOL 1 and SOL 2 now come from the school.", and
the Admin "You can tick the Encounter, Life Class, SOL 1 and SOL 2 only for someone who finished
before the school." One advisory lock serves every SOL level, so a leader's tick never lands after a
SOL 1 or SOL 2 class opened. A leader's *SOL 2* tab carries the SOL 1 card.

Previous: [2026-11-25 — The school's lists are in last-name order, each name shown last name first](0515-the-schools-lists-are-in-last-name-order.md)
