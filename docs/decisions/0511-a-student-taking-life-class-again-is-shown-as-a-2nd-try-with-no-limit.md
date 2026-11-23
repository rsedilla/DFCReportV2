# 2026-11-23 — A student taking Life Class again is shown as a 2nd try, with no limit

Owner rulings of 2026-11-23, made from screenshots of the Registrar's *Registration* list, the
*Register* form and *Enrollment*'s *Ready to enroll*, today's and proposed side by side. The owner
asked what happens when a student fails Life Class and whether their tries should be recorded,
and asked for a look at how universities handle it. Universities keep every attempt on the
record and most cap the number of tries; a withdrawal usually does not count as one. DREAMS
already keeps every attempt, a registration a term and each posted grade kept as posted
(decision 0508), so nothing new is recorded; what was missing is saying so.

**1. A try is a posted *Not passed* at the level.** A student's earlier tries are the grades
the Registrar posted as *Not passed* (decision 0508) for that person at that level. *Not yet*,
a student still to attend the Encounter, is not a failed try. A withdrawal, a move to another
class, and a cancelled registration are not tries. A pass or failure from before the school is
not known to DREAMS and is not counted.

**2. It is worked out, never typed** (owner, accepting the screenshots). Nobody records a try
number, and nothing new is stored: it is counted from the posted grades each time it is shown,
so it stays right by itself.

**3. Where it shows.** *2nd try*, *3rd try* and so on, beside the name on the *Registration*
list and on *Enrollment*'s *Ready to enroll*, counting the tries in terms before the
registration's own. On the *Register* form, once a person is chosen, a box *Took Life Class
before* lists each earlier try, its term, class, *Not passed* and the posted reason, and says
which try this would be. A first try shows nothing.

**4. There is no limit on tries** (owner: "no limit on tries"). Nobody is refused or warned for
having tried before. A school caps tries to protect its places; the church's class exists to
bring people through.

**5. A merged record's tries are the person's** (decision 0408): the record kept carries the
tries of every record merged into it.

**6. Who sees it**: the Registrar and the Admin, under `equipping.manage`, on screens that are
already theirs (Section 7). It discloses nothing they could not read from *Final Grades*.

Built without a migration: the registrations list, the *Register* form's person read and a
class's *Ready to enroll* gain the count or the list, read from `equipping_final_grades`,
`equipping_class_postings`, `equipping_enrollments`, `equipping_registrations` and
`equipping_classes`, all `equipping`'s own. `SKILL.md` Section 29 carries it.

Previous: [2026-11-23 — A class is corrected until its first lesson is saved, and cancelled while it has no students](0510-a-class-is-corrected-until-its-first-lesson-is-saved-and-cancelled-while-it-has-no-students.md)
