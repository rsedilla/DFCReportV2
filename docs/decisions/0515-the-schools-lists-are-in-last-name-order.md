# 2026-11-25 — The school's lists are in last-name order, each name shown last name first

Owner rulings of 2026-11-25, made from real screenshots of the Registrar's *Final Grades* and the
Teacher's register, each shown as it is today and sorted by last name, after a comparison the
owner asked for: Canvas sorts its gradebook by last name by default, Google Classroom lets the
teacher choose, and Philippine class records and Mapúa-style class lists set students out
alphabetically as *Family Name, First*. The owner's words: "make sure when we create a list in
the future it should be sorted out in the equipping".

Decision 0359 orders every list of people by first name, because a list shown first name first
and sorted by surname reads as no order at all. The school is the one place that ruling now
gives way, and it gives way on both halves together: the order and the name shown.

## The ruling

1. **Every list of people in `Equipping` is ordered by last name, then first name, then Member
   ID**, and any list the school adds later is too (owner, 2026-11-25). It covers the
   Registrar's *Registration* list, *Enrollment*'s students in a class and *Ready to enroll*,
   the students and the Guides of a class on the Coordinator's *Classes*, the Teacher's register with its
   *Attendance so far* and *Make-ups still owed*, the *Encounter* lists, and *Final Grades*.

2. **The name in a list's name column is shown last name first**: *Aquino, Tomas R.*, the
   middle name as its initial (decision 0375), and a title, where somebody has one, before the
   given name, *Reyes, Ptr. Ana*, where decision 0271 puts it, and never compared. Elsewhere on
   the same page, in a sentence, a dialog's title, a Cell leader's or a Guide's column, a name
   reads as it does everywhere else. The shown name is composed in `people`, which owns a
   name's shape (Section 3); the order reads the same last name, first name and Member ID, in
   one comparator every school list uses and, for *Registration*, in SQL. The title is in the
   name and never in the key.

3. **Final Grades goes straight from A to Z** (owner, 2026-11-25). The grade no longer groups
   the table, *Not passed* first; the *Not passed*, *Not yet* and *Passed* pills above it still
   show who needs a look. A grade sheet is checked against paper, which runs in alphabetical
   order.

4. **The *Registration* list, paged by the database, orders by the same key**, newest first
   before this ruling. Its cursor carries last name, first name, Member ID and the registration's
   identifier, in that order (Section 22). Its query joins `persons` onto
   `equipping_registrations`, a read joined onto a query rooted in a table `equipping` owns,
   the one shape Section 2 admits, named in `api/module-boundaries.json`. A page open across
   the deploy may skip or repeat rows once, as decision 0359 accepted for the change it made.

5. **What stays as it is.** A leader's own cards of their people in the school (decision 0504)
   keep decision 0359's order, being a leader's list of their people rather than a school list;
   the search boxes that find a person to register, or to name a Teacher or a Guide, keep the
   directory's order (Section 8); and the order in which students are shared out among Guides
   (decision 0502), which nobody reads as a list, is unchanged. Nothing is ordered by a figure
   (Section 13).

Previous: [2026-11-24 — SOL 1 joins the school, with a Coordinator for each level](0514-sol-1-joins-the-school-with-a-coordinator-for-each-level.md)
