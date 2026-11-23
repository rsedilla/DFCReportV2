# 2026-11-22 — Final grades are checked by the Coordinator and posted by the Registrar

Owner rulings of 2026-11-22, made from real-app screenshots, building decision 0501, points 15
and 16: the final grade is Passed or Not passed with its reason, worked out by DREAMS and never
typed; the Coordinator checks each class, the Admin checking the Coordinator's own disciples; the
Registrar posts a checked class; and a change after posting needs the Admin and a reason.

**1. The screen is version B** (owner, "version B, your pick"), chosen beside a first drawing
after comparing how universities send grades to the Registrar (Canvas into a student-information
system, Mapúa's MyMapúa) and how Google Classroom shows them. The Registrar's sidebar gains
*Final Grades* after *Encounter*, and the Admin's *Equipping* the same tab, as 0501 point 20 names
it. A term, and a button for each class saying where it stands: *Lessons to record: L8, L9*,
*Waiting for the Coordinator*, *Waiting for the Admin (1 disciple)*, *Ready to post* or *Posted 22
Mar*. The chosen class shows three steps, *Lessons recorded*, *Checked* and *Posted*, each with
who and when; filters *All*, *Not passed*, *Not yet* and *Passed*, with their counts; and each
student with their grade as a labelled badge and its reason beside the name, the register (L1 to
L4, ENC, L6 to L9) and *9 of 9 · 1 made up* after it, what needs a look first. A table on a
laptop, the name held in place as it scrolls; a card each on a phone, the grade on its first
line. *Post Life Class A…* opens a confirmation giving the counts and saying posting is final.
The Coordinator reaches the same grades from *Grades* on each class of their *Classes*, read only,
their own disciples marked *Your disciple: the Admin checks*, with *Mark as checked*.

**2. A student who has not attended the Encounter reads *Not yet*** (owner, with version B):
*Encounter not attended. Passes after a later one.* They are not failed, since 0501 point 14
says they graduate once they attend a later one; posting records *Not yet* and leaves them
enrolled, so a later Encounter weekend still lists them (decision 0507).

**3. A lesson still not made up when the class is posted is *Not passed*** (owner, with version
B), *L7 not made up.* The Teacher records a make-up until the class is posted, which changes the
grade.

**4. More than three absences, made up or not, is *Not passed*** (owner, with version B), as
0501 point 13 has it: *4 absences, over the 3 allowed.* With lessons 1 to 4 within their two and
the Encounter attended, the student *joins a later class at lesson 6*; otherwise they *repeat
Life Class*. Three or more of lessons 1 to 4 missed, made up or not, is *Not passed* on its own,
*3 absences in lessons 1 to 4. Repeats Life Class.*, since 0501 point 13 says such a student
cannot go to the Encounter. A lesson held before a student joined is no absence, being owed as a make-up
(decisions 0503 and 0507).

**5. How a check works.** *Mark as checked* is offered once every lesson is recorded and every
student has a mark for it: a student enrolled the day a lesson was saved, after the save, has none
until the Teacher saves the lesson again, and until then that lesson reads as still to record.
A check certifies the grades as the checker read them: every student's grade,
reason, lessons and marks, and the lessons still to record, kept as a digest. The check sends
that digest back and is refused `VERSION_CONFLICT` if the grades have changed since, and it stands
only while they are exactly what was checked: any change to a
student's grade, reason, lessons or marks, or to who is in the class, and it needs checking again, which is how *a wrong
mark goes back to the Teacher or the Admin* (0501, point 16). A Coordinator's check covers every
student but their own direct disciples; a check by the Admin covers all of them. The Registrar
posts only a class so covered, once.

**6. Posting** records each student's grade, reason and lessons as they stood, and ends the
enrollments of those *Passed* and *Not passed*, which is what takes a finished term off a
leader's cards and their *Equipping* item (decision 0504). An Encounter weekend a finishing
student is enrolled in and whose attendance is not yet recorded is left as it is: they are
graded on what is recorded. Nothing posted is rewritten or deleted, and **a posted class is
final**: no lesson is saved, no make-up recorded, and nobody joins it or moves into or out of it.
**A student posted *Not yet* may still be withdrawn**, being the one still enrolled there. Saving
a lesson, recording a make-up, enrolling, moving, withdrawing, checking and posting each take the
class's lock before they touch an enrollment, and a move takes its two classes in order; a
change caught waiting is answered `RESOURCE_BUSY`.

What the owner ruled is the screen and points 2 to 4. Point 5's reading of a stale check and of
an unmarked student, point 6's refusals, its withdrawal of a *Not yet* and its grading on what is recorded (a student over three absences whose Encounter weekend is unrecorded at posting reads *Repeats Life Class*, not *Joins a later class at lesson 6*), and the Coordinator's own disciples being their direct
disciples (as Section 10's own-disciple rule reads, decision 0352) are this step's readings.
**Who counts as the Admin for a check is read as a capability**, `equipping.class` at Whole
Church, which only the Admin holds by default; an explicit grant would count too, which is the
open question of whether "Admin" is a role or a capability, and the Admin's own direct disciples
are covered by the Admin's own check, which nothing yet says otherwise. **The words *passes after
a later one* and *joins a later class at lesson 6* name what 0501 says happens next, and neither
is built**: a later pass cannot yet be recorded against a posted *Not yet*, and a later class does
not yet carry lessons 1 to 4 across a new term's registration. Both are owed by the step that
brings Training's graduations from the school, with a ruling on how. **A change after posting is not built**: 0501 gives it to the Admin
with a reason, and the posted grade stands until that step. The window on correcting who came to the Encounter, which
decision 0507 left to this step, is not a cut-off: a change to who came after a check makes the
check stale, and after posting the grade stands as posted. Filing Training's graduations from a
posted grade, and from the Encounter attended, is the next step (0501, point 19).

Previous: [2026-11-22 — The Registrar's Encounter page enrolls the cleared and records who came](0507-the-registrars-encounter-page-enrolls-the-cleared-and-records-who-came.md)
