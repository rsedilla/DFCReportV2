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

## Settled by the owner, 2026-11-24

The first build refused six cases rather than deciding them, each recorded as an open Stop
Condition in `CLAUDE.md`, four raised while building and two by `architecture-guardian`'s review.
The owner ruled on each on 2026-11-24, from worked examples with the conservative arm and the
alternatives side by side. **The routes take the church as their target** for the Admin, where
every other `equipping.class` route takes the actor (Section 7).

**10. A change moves a student into or out of *Not yet* as posting would have** (owner,
2026-11-24, "A, A, A"). The grade is what posting would have given with the corrected lesson:

- a *Not yet* whose change makes them *Not passed* becomes so, their enrollment ending
  `COMPLETED` as posting ends every other *Not passed*, and they leave every later Encounter's
  list;
- a finished student whose change makes them *Not yet* becomes so, **their ended enrollment
  reopened**, listed for the next Encounter and passing there as any *Not yet* does (decision
  0509), a posted *Not passed* changed so no longer being a try (decision 0511); this is the one
  place an ended enrollment is reopened;
- one posted *Not yet* who passed at a later Encounter may be changed like anyone else, a change
  making them *Not passed* withdrawing the Life Class that Encounter filed, as point 6 withdraws a
  *Passed* changed away.

**11. A lesson recorded in a class the student left this term is changed from the posted class**
(owner, 2026-11-24, "2a A"). The mark is written in the earlier class's register under the earlier
enrollment, the earlier one closed and kept, since only this grade rests on it, whether or not that
class has been posted.

**12. A lesson kept from an earlier term is changed only where lessons 1 to 4 stay done** (owner,
2026-11-24, "2b C"). It counts toward two posted grades, the earlier term's that let the student
join at Lesson 6 and this one. *Came* and *Made up* may be exchanged, and a make-up's day
corrected, the mark written in the earlier term's register; a change leaving any of lessons 1 to 4
not done is refused, saying that a join at Lesson 6 is not undone once the later class has graded
it. **Building it showed the example put to the owner was wrong**: a made-up lesson still counts
as missed, and joining at Lesson 6 allows two missed of lessons 1 to 4 (decision 0508), so a
*Came* made *Made up* can undo the join as surely as *Absent* does, and can move this grade too.
Such a change is refused as well, the conservative arm, and is open in `CLAUDE.md` for the owner.

**13. A change never takes *Joins a later class at Lesson 6* from one a later enrollment carries**
(owner, 2026-11-24, "2c A"). It is refused while such an enrollment exists, the Registrar
withdrawing them there first, the database refusing it besides.

**14. A change works from the Encounter as it stands now, and shows it** (owner, 2026-11-24, "A, as
it stands now"). An Encounter recorded or corrected since posting, at any weekend or through a
merged record, is part of the grade a change works out, as it is of a *Not yet* who passed later.
The dialog, the summary and the history each say *Encounter changed since posting*, with what it
read at posting and what it reads now, so nothing is folded into a lesson change unseen.

**15. Nothing is changed once the person has registered for the level in a later term** (owner,
2026-11-24, "A"), until that registration is cancelled, the refusal saying so. A registration on a
record merged into theirs is theirs (decision 0408), as tries are (decision 0511), and a change and
a later registration saved at the same moment are taken one after the other, whichever lands second
being refused, saying why (owner, 2026-11-24, "A").

**Two refusals the build makes that no point settles**, each open in `CLAUDE.md`: a student made
*Not yet* whose registration has since been cancelled, or who is enrolled again on it, is not
reopened; and a grade whose register no longer gives it under either reading of the Encounter,
which only a lesson written after posting outside a change could cause, is not changed.

**16. A registration graded *Passed* or *Not passed* is not enrolled again** (owner, 2026-11-24,
"A"). It is finished with its grade, in its term or any other; a person trying again registers
again. A *Not yet* stays enrolled, as posting leaves them, and one reopened by point 10 is enrolled
under the registration it always had.

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

Points 10 to 16 added to it: the change row's `encounter_before`, `encounter_after` and
`enrollment_effect`; the graded enrollment ended or reopened beside the change, the database
admitting a reopening only so; a kept or left-behind lesson written where it was recorded, the
database admitting a kept one only beside a change of the grade carrying it; passing at a later
Encounter read from the grade as it stands, in the Encounter page and in the database, which
replaces the check 0056 wrote on the posted grade; the later-term check resolving merged records,
behind the person's lock registering takes; enrolling refusing a graded registration, which
*Ready to enroll* no longer lists, the database refusing it too; the audit entry
`equipping_enrollment.reopened`; and the dialog's Encounter note, reopening or ending sentence,
and summary lines, as the owner approved them from screenshots on 2026-11-24.

Previous: [2026-11-23 — A student who kept lessons 1 to 4 and the Encounter joins a later class at Lesson 6](0512-a-student-who-kept-lessons-1-to-4-and-the-encounter-joins-a-later-class-at-lesson-6.md)
