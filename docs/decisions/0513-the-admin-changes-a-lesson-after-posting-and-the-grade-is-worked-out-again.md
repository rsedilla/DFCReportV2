# 2026-11-23 — The Admin changes a lesson after posting, and the grade is worked out again

Owner rulings of 2026-11-23, made from screenshots of *Final Grades* today and proposed side by
side, after a look at how universities and record systems change a posted grade: the posted grade
is locked, a change is a request of its own with a reason, the original stays, and the history is
shown with the record. Decisions 0501 (points 12 and 16) and 0508 said a change after posting is
the Admin's, with a reason, and named it not built. This settles how.

**1. The Admin changes a lesson, never the grade** (owner, 2026-11-23, "A. change the lesson",
chosen against typing a new grade, which point 15 of 0501 forbids: the grade is worked out by
DREAMS, never typed). On a posted class each student's row carries *Change…*. The Admin picks one
of lessons 1 to 4 and 6 to 9, and sets it to *Came*, *Absent* or *Made up* with the day it was
made up; a lesson held before the student joined is only made up. The Encounter is not changed
here: it keeps its own page (decision 0507).

**2. Why, in two choices and in words.** *Made up after posting* or *Recorded wrongly*, and
details of up to 500 characters, both required, as a registrar's grade-change form asks for a
reason and a short category of it.

**3. The new grade is shown before anything is saved, then confirmed.** The dialog says *Grade
becomes …* beside the grade now, and what Training will do; *Review change* opens a summary of the
lesson and the grade before and after with the reason, saying it cannot be undone, only changed
again with another reason; *Save change* saves it.

**4. The posted grade is kept, and every change is kept beside it** (principle 12). A change is a
row of its own (`equipping_grade_changes`), holding the lesson and the grade as they were and as
they are, the reason, who and when; the grade a student holds is the posted one or its latest
change (`equipping_current_grades`). Nothing is rewritten or deleted, the database refusing
either. The row reads *Changed after posting · history*, opening the grade as posted and each
change with who made it, when, the lesson, the grade before and after, and the reason. The
Registrar and the Admin read it, the Coordinator's read of the class carrying none, the ruling
naming only those two; only the Admin changes.

**5. The register changes with it, as any correction does.** The mark or make-up is written in
the posted class under the graded enrollment, the earlier one closed and kept (decision 0503), a
mark carrying the details as its reason as a closed week's does. **The database now holds a posted
class's register final for the students it graded**: a mark or make-up of a posted class's lesson
under an enrollment that posting graded is written or closed only in a transaction recording a
change of that student's grade. A student who left the class before it was posted has no grade
there, and a lesson they missed in it is still made up from their new class (decision 0512).

**6. Training follows the grade** (owner, 2026-11-23, as recommended). A grade that becomes
*Passed* files Life Class from the school, dated the day of the change, one already holding Life
Class keeping what they hold (decision 0509); a *Passed* changed away withdraws the Life Class the
school filed for it, as an Encounter correction withdraws one. The school's evidence for a tick the
Admin withdraws (decision 0509, point 8) reads a grade standing *Passed* now, dated the day it
became so.

**7. A try and Lesson 6 follow the grade** (owner, 2026-11-23, as recommended). Both are worked
out from the grade as it stands each time they are read: a *Not passed* changed to *Passed* is no
longer a try (decision 0511), and *Joins a later class at Lesson 6* (decision 0512) is the current
grade's, the database's check on joining reading it too.

**8. The Coordinator does not check again** (owner, 2026-11-23, as recommended): the Admin making
the change covers every student, as the Admin's check does (decision 0508).

**9. A change made since the dialog opened is refused** `VERSION_CONFLICT`, the dialog sending how
many changes it saw; one that changes nothing is refused `INVARIANT_VIOLATION`.

## This step's readings, put to the owner

These are refused, not decided. **The routes take the church as their target** for the Admin,
where every other `equipping.class` route takes the actor (Section 7). Each is recorded as open in `CLAUDE.md`, and the refusal is the
conservative arm, removable by a ruling without undoing anything written.

- **A student posted *Not yet* stays *Not yet*, and nobody becomes it.** The owner's point 4
  answer was that a *Not yet* may be changed on lessons 1 to 4 and 6 to 9. What it did not say is
  what happens when such a change would make them *Not passed* (their enrollment is still open,
  and they are on a later Encounter's list), or when a change would make a finished student *Not
  yet* (whose enrollment has ended, which is never reopened). Both are refused, saying why, and a
  *Not yet* who passed at a later Encounter keeps the grade they passed on.
- **A lesson recorded in a class the student was in before, or kept from an earlier term, is not
  changed here.** It stands as that class recorded it.
- **A student who has joined a later class at Lesson 6 keeps the grade that let them**: a change
  that would take *Joins a later class at Lesson 6* away is refused once a later enrollment carries
  from it.
- **A grade the register no longer gives is not changed.** The grade is worked out against the
  Encounter as it stands now, and an Encounter recorded or corrected after posting, at any weekend
  or through a merged record, would be folded into a lesson change unseen; whether a change works from the Encounter at posting or now is for the
  owner, and until then any change of such a grade is refused, saying why.
- **Nothing is changed once the person has registered for the level in a later term**: that term
  rests on this grade, as a try (decision 0511), a fresh start or a carry at Lesson 6, and a
  *Not passed* made *Passed* would leave them passed and sitting a repeat.

The last two were raised by `architecture-guardian`'s review of this step.

**Who is the Admin** is read as decision 0508 reads it, `equipping.class` at Whole Church, which
only the Admin holds by default and the Registrar does not; whether "Admin" is a role or a
capability stays the open question it is.

## What was built

Migration `0059_equipping_grade_changes.sql` (the table, the view, a trigger keeping a change as
written and starting it from the grade as it stands, a trigger holding a posted register final,
and the Lesson 6 check reading the view), `GET /equipping/final-grades/grades/{id}/change-preview`
and `POST /equipping/final-grades/grades/{id}/changes`, the class read's history and the lessons
each student's change may reach, the readers of tries, Lesson 6 and Training's evidence moved to
the grade as it stands, the audit entry `equipping_final_grade.changed`, and the dialog and history
on *Final Grades*. `SKILL.md` Section 29 carries it.

Previous: [2026-11-23 — A student who kept lessons 1 to 4 and the Encounter joins a later class at Lesson 6](0512-a-student-who-kept-lessons-1-to-4-and-the-encounter-joins-a-later-class-at-lesson-6.md)
