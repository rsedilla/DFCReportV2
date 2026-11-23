# 2026-11-23 — A student who kept lessons 1 to 4 and the Encounter joins a later class at Lesson 6

Owner rulings of 2026-11-23, made from screenshots of the *Register* form, *Enrollment* and the
Teacher's register, today's and proposed side by side ("Yes, as recommended"), after a look at
how universities treat work already done: advanced standing keeps it and does not have it taken
again, and an incomplete is finished by doing only what is left. Section 29 already said that a
student over three absences after the Encounter keeps lessons 1 to 4 and the Encounter and joins a
later class at Lesson 6 (decision 0508), and named it not built. This settles how.

**1. DREAMS works out who joins at Lesson 6.** A posted grade of *Not passed* for more than three
absences, with at most two of lessons 1 to 4 missed, **every one of lessons 1 to 4 attended or made
up** (owner, 2026-11-23, on a Stop Condition `architecture-guardian` raised), and the Encounter
attended, is the grade that reads *Joins a later class at lesson 6* (decision 0508); one with a
lesson of 1 to 4 neither attended nor made up repeats Life Class, so nothing is owed from the
earlier class. It is now also recorded on the
grade as `joins_at_lesson_6`, so nothing reads it from the words. A person whose latest posted
grade at the level carries it joins at Lesson 6 when next enrolled. Nobody ticks it.

**2. Only a class whose Lesson 6 has not been reached.** Lesson 6 is expected five weeks after
the first lesson (decision 0503). Such a student is enrolled at Lesson 6 only in a class whose
Lesson 6 date is today or later and which has saved no lesson from 6 on; *Enrollment* shows each
class's Lesson 6 date and, on the student's row, *Joins at Lesson 6* with that date. Enrolling
them into a class past its Lesson 6 is refused, saying to choose another class or start them from
Lesson 1. The database refuses it once a lesson from 6 on is saved.

**3. Starting over is allowed.** The Registrar may enroll the student from Lesson 1 instead,
with *Start from Lesson 1* on their row, when the student or their leader prefers; they then
take the class as anybody does.

**4. No time limit.** The kept lessons count in any later term, as tries have no limit (decision
0511).

**5. What carries, and how it reads.** Lessons 1 to 4 are read from the term where they were
kept, marks and make-ups as its classes recorded them, a class they left in that term by a move
included, and the Encounter from the person's attendance, a record merged into theirs included
(decision 0408). On the Teacher's register the student's row reads
*Joins at Lesson 6 · L1 to L4 and ENC kept from* that class and term, the kept lessons counted;
the student is not on the tick list for lessons 1 to 4, and an unticked lesson writes nothing for
them, as for a moved student (decision 0503). They owe no make-up for lessons 1 to 4, and none is
recorded for one, here or in the earlier class that kept it. They are not
listed for an Encounter weekend, having attended one. Their final grade counts the kept lessons.
A move to another class of the term keeps it, the same Lesson 6 rule applying there.

**6. The *Register* form says so** under *Took Life Class before*: *Joins a later class at Lesson
6*, and that lessons 1 to 4 and the Encounter are kept from that term, so only lessons 6 to 9 are
left.

**7. Who**: the Registrar and the Admin, under `equipping.manage`, as every enrollment.

**8. Kept absences count toward the three** (owner, 2026-11-23, on a Stop Condition the same
review raised): Section 29's *at most three absences in all* runs across both classes, so a
student with two absences in lessons 1 to 4, made up, may miss one of lessons 6 to 9.

**9. A grade posted before this was built carries too** (owner, 2026-11-23, on Stop Conditions the
two reviews raised): a grade already posted whose reason reads *Joins a later class at lesson 6.*
is given the flag by the migration, the grade itself unchanged, **only where its lessons 1 to 4
were each attended or made up**, as point 1 asks of every grade; one posted under the earlier rule
with such a lesson still owed repeats Life Class.

Built in migration `0058_equipping_join_lesson_6.sql` (`equipping_final_grades.joins_at_lesson_6`;
`equipping_enrollments.carried_from_enrollment_id`, naming the enrollment whose lessons 1 to 4 are
kept, with a trigger holding point 2's saved-lesson half and that the kept enrollment is the
same person's, at the same level, in an earlier term, posted as joining at Lesson 6, and that it
never changes; a trigger on `equipping_marks` and `equipping_make_ups` refusing one of lessons 1
to 4 for such an enrollment; and point 9's flag set on grades already posted), the enrollment and
move routes, the class and person reads, the register, and
the three screens. `SKILL.md` Section 29 carries it.

Previous: [2026-11-23 — A student taking Life Class again is shown as a 2nd try, with no limit](0511-a-student-taking-life-class-again-is-shown-as-a-2nd-try-with-no-limit.md)
