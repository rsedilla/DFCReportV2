# 2026-11-23 — A class is corrected until its first lesson is saved, and cancelled while it has no students

Owner rulings of 2026-11-23, made from screenshots of the Coordinator's *Edit* dialog on
*Classes*, today's and proposed side by side, and from a look at how universities handle a
class that is not needed (the owner asked for it). Registrars in the United States cancel a
section rather than delete it, keep it with the status *Cancelled*, and let a department cancel
one with nobody enrolled; one with students goes to the registrar, who drops them first. Design
guidance puts such an action at the bottom, apart, with a confirm step that names the object and
says what happens. The owner asked for both requests, then accepted the screenshots as shown.

**1. The Coordinator corrects a class's day, time, place and first lesson until a lesson is
saved** (owner: "correcting a class's day, time, place and first lesson until the first lesson
is saved"). They sit in a *When and where* box at the top of *Edit*, with *Save when and where*.
Once any lesson of the class is saved, the box says so in words (*Lesson 1 is saved, so the day,
time, place and first lesson can no longer change.*) and the API refuses a correction as
`INVARIANT_VIOLATION`. Lessons are dated from the first lesson (decision 0503), so a correction
after one is saved would move the expected dates under a register already kept. The name, level,
term and Encounter season are not in the box; nothing asked for them.

**2. A correction keeps what it replaced** (Section 1, Principle 12). Each one is a row of
`equipping_class_corrections` with the four values before and after, who made it and when, and an
audit entry, `equipping_class.corrected`; the database refuses changing the four on a class
without that row, or after a lesson is saved. A save that changes nothing writes nothing (decision
0442). The Teacher's week is checked again and a clash with their own Cell warns, never refusing,
as naming a Teacher does (decision 0501). Students already enrolled stay where they are.

**3. *Cancel class* is offered only while nobody is enrolled and no lesson is saved** (owner:
"only while the class has no students and no lesson saved; no delete"). *Nobody is enrolled* is
an enrollment that has not ended: a student who moved to another class or was withdrawn left the
class, and their history keeps its name. Otherwise the box at the bottom of *Edit* says why it is
not offered, and the API refuses as `INVARIANT_VIOLATION`.

**4. Cancelling asks first, names the class, and takes a reason** (owner, accepting the
screenshot). The confirm step reads *Cancel Life Class C?*, gives the class's day, time, place and
first lesson, says it leaves the list of classes, is kept under *Status: Cancelled* and cannot be
reopened, and asks for a reason, required, up to 500 characters. Its buttons are *Cancel the class*
and *Keep the class*, neither chosen first. The buttons keep the application's own styles, which
have no destructive variant (the UI ruling of 2026-08-21, `web/components/ui/button.tsx`).

**5. A cancelled class is never deleted, and is final.** It keeps its row with when, by whom and
why, audited as `equipping_class.cancelled`. Nothing is added or changed on it afterwards: no
Teacher, Guide, student, lesson or correction, and no second cancellation, each refused by the
database as well as the API. A class wanted after all is opened again as a new class.

**6. Cancelling closes the Guides still named on it** (owner, 2026-11-23, "Close them", on a Stop
Condition `architecture-guardian` raised: a class with no students may still have Guides named,
and once cancelled nobody could remove them). They are removed at the cancellation's instant,
recorded as removed by whoever cancelled, never deleted, and the audit entry names them; the
database refuses a cancellation while one is still named. The Teacher stays named, as the class's
history.

**7. A cancelled class shows only under *Status: Cancelled*** (owner, accepting the screenshot):
the date it was cancelled and the reason, dashes for Teacher, Guides and Attendance, and no
action. *All* lists the classes not started and running, and nowhere else lists a cancelled one:
not the Registrar's *Enrollment* or *Final Grades*, and not a Teacher's or Guide's classes.

**8. Its name may be used again in its term.** A name is unique among a term's classes that are
not cancelled, so the class opened in its place may carry the same name.

**9. Who: `equipping.coordinate`**, the Coordinator and the Admin, as every other change to a
class on *Classes* (Section 7).

Built in migration `0057_equipping_class_cancel.sql` (`equipping_classes.cancelled_at`,
`cancelled_by` and `cancel_reason`; `equipping_class_corrections`; one trigger on
`equipping_classes` for points 1, 2, 3, 5 and 6, and one on `equipping_enrollments`,
`equipping_lessons` and `equipping_class_guides` refusing a cancelled class, each reading the class
`FOR SHARE` so a cancellation and an insert wait for each other; and the name index made partial),
`POST /api/v1/equipping/classes/{id}/correction` and `POST /api/v1/equipping/classes/{id}/cancel`,
and the *Edit* dialog and *Status* filter on *Classes*. `SKILL.md` Section 29 carries it.

Previous: [2026-11-22 — Training's graduations come from the school, and only the Admin ticks the Encounter and Life Class](0509-training-graduations-come-from-the-school-and-only-the-admin-ticks-the-encounter-and-life-class.md)
