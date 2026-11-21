# 2026-11-20 — A lesson is dated weekly from the first, and the Teacher may change the date

Owner choices of 2026-11-20, made from screenshots while the attendance step of decision 0501
(points 10 to 12 and 21) was being built, and owner answers of the same day to three
questions `architecture-guardian` raised in its review of that build ("yes all three"). Points
1, 5 and 6 are rules; point 2 is a layout carrying three rules the owner confirmed; point 3 is
presentation. Point 4 records what carries the step: a capability and three audit actions,
none of which 0501 named.

**1. A lesson's date is weekly from the class's first lesson, and the Teacher may change it
when saving** (owner, 2026-11-20). Lesson *n* is expected *n* − 1 weeks after the first
lesson, **the Encounter taking lesson 5's week**, so lesson 6 falls five weeks after the
first. A lesson not yet recorded is placed by its expected date: *Not yet*, *Today*, *To
record*, *Late*, or *Not recorded* once its week has closed, on Cell attendance's timing (0501
point 11; decisions 0387 and 0434). Saving it, the Teacher may give the day the class actually
met; that day must fall on or after the first lesson and on or before today, and from then on
the lesson's week is the week of that day. **Both weeks must be open**, the one the lesson
stood in and the one it moves to, or the save is the Admin's, with a reason, as any change to
a closed week is; a lesson never recorded stands in its expected date's week, so dating it
today does not reopen a week that has closed. A changed date is kept with the date it changed
from (principle 12), and written to the audit log with its before and after. The
other answer was a date the Teacher typed for every lesson, which would leave nothing to say a
lesson was late until somebody typed one.

**2. Make-ups are recorded from a *Make-ups still owed* list** (owner, 2026-11-20, option M2
of three screenshots): one row an absence not yet made up, with the student's Cell leader, the
lesson and its date, and *Record make-up*, which asks the date. The date falls between the
missed lesson's and today; a later date given for the same make-up corrects it, the earlier
kept. **A student later marked as having come after all no longer owes the lesson**, and a
make-up recorded for it is closed with that save. The layout was chosen from screenshots; the
owner confirmed these three rules separately, on review (2026-11-20).

**3. A leader's *Equipping* is grouped *Classes you teach*, then *Classes you guide***
(owner, 2026-11-20, after Google Classroom and Canvas), each group saying what its reader
does: records each lesson and its make-ups, or sees their own students and records nothing.
On the recording screens it is an item of its own; for a Full view leader it is the
*Equipping* tab of `Growth` (0501 point 21). It is drawn while the leader teaches or guides a
class. Their people in the school, the rest of point 21, are a later step.

**4. `equipping.class`, and three audit actions.** Every route of the step takes the actor as
its target under a new capability, `equipping.class`: every Leader holds it at
`OWN_SUBTREE`, with or without Full view, and so does a Senior Pastor (point 6), and the school
narrows it to the class they teach or guide; the Admin holds it at Whole Church, which reaches any class and alone changes a closed
week. A Coordinator reads a class's register by `equipping.coordinate` at Whole Church and
records nothing; a Guide reads their own students alone. **Section 21 gains
`equipping_lesson.recorded` and `.corrected`, targeting the class**, with who came and who was
absent, or the marks changed and the date before and after and the reason, **and
`equipping_make_up.recorded`, targeting the student's Person**, with the make-up date before
and after.

**5. A student who joined after a lesson is not saved Absent for it, and makes it up; a moved
student keeps their marks** (owner, 2026-11-20, from screenshots). A lesson the class held
before the student joined, with no mark for it in an earlier class, is shown ○ *before they
joined*, listed under *Make-ups still owed* as held before they joined, and **not counted as an
absence**; the student is not ticked for it, and ticking them is refused. A student moved from
another class of the same level and term keeps the marks that class saved, lesson by lesson,
shown with the class's name, since a move keeps what was recorded (Section 29); a lesson missed
there is made up from the new class and recorded against the lesson where it was missed. The
other answer was to save such a student Absent like anybody else, which would count against
them lessons they could not have attended. Raised by `architecture-guardian` as a Stop
Condition, the Cell counterpart being decision 0391.

**6. A Senior Pastor who teaches records their class, and naming a Teacher who cannot record
warns** (owner, 2026-11-20). A Network root may be named a Teacher, being a current Cell Leader
in the tree, and the Senior Pastor role now holds `equipping.class` over themselves, as a
Leader does. Naming a Teacher who has no account, or one not yet activated or disabled, says
so in the Coordinator's *Edit* and *Open a class* boxes; it warns and never refuses, the
Admin giving or restoring the account as now. Raised by `architecture-guardian` as a Stop
Condition.

## What holds it

Migration 0053 adds `equipping_lessons`, `equipping_marks`, `equipping_make_ups` and
`equipping_lesson_date_changes`. A lesson is one per class and number, lesson 5 never; a mark
or make-up is corrected by closing it and opening another, and a closed one stays closed; a
current one names a student of the lesson's class; a make-up is of a lesson the student is
currently marked absent from, or of one held before they joined that carries no mark, and a
mark saying they came is refused while one is current; a
date change is kept as written; nothing is deleted from any of the four. The Admin's reason
for a closed week is kept on every mark the save writes, a first one included, and in the
audit entry. A lesson's date may not move past a make-up already recorded for it. A save carries the lesson's version, and a stale one is refused
`VERSION_CONFLICT`. The dates in point 1 and the open weeks are the service's, read against the
database's clock.

Previous: [2026-11-20 — A Guide pairing ends with the enrollment, and an archived Guide takes no new students](0502-a-guide-pairing-ends-with-the-enrollment-and-an-archived-guide-takes-no-new-students.md)
