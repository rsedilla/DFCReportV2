# 2026-11-22 — Training's graduations come from the school, and only the Admin ticks the Encounter and Life Class

Owner rulings of 2026-11-22, made from drawings of the Training tab (a leader's view and the
Admin's), building decision 0501, point 19: a posted *Passed* files Life Class's graduation and the
Encounter attended files the Encounter's, each marked as the school's, and leaders stop ticking
those two.

**1. Only the Admin ticks the Encounter and Life Class** (owner): a tick is for somebody who
finished before the school, which is most of the church, and the school files everybody after it.
Leaders lose those two ticks now. **They keep SOL 1, SOL 2 and SOL 3** until the school runs each
level; then the school files it as it files Life Class (owner: "the equippers team or whoever is
allowed records it"). A leader's attempt to tick either is refused `SCOPE_DENIED`, saying the
school records it and only the Admin ticks it for somebody who finished before the school.

**2. A posted *Passed* files Life Class from the school, dated the day it was posted** (owner, who
saw the date and did not object). One who already holds Life Class, ticked before the school,
keeps what they hold and nothing is added.

**3. The Encounter attended files the Encounter from the school, dated the weekend** (owner).
Correcting *came* to *not attended* withdraws it, kept with the reason. A tick from before the
school is never withdrawn by the school.

**4. A student posted *Not yet* passes at a later Encounter** (owner, who saw it and did not
object), which builds decision 0508's *passes after a later one*. When the Registrar records them
as having come: their enrollment ends `COMPLETED`, Life Class is filed from the school, and their
posted grade records when and by whom they passed, in `passed_later_at` and `passed_later_by`,
the grade itself still reading *Not yet* as posted. **Correcting them back to not attended is not
offered**: passing ends their enrollment, which takes them off every weekend's list, as a posted
*Passed* is taken off, so the save cannot reach them.

**5. Older ticks read *Before the school*, and the school's *From the school*** (owner), under the
date in the Encounter and Life Class columns. A note above the table says what the reader may do:
the Admin's *You can tick all five for people who finished before the school*, a leader's
*Encounter and Life Class now come from the school*. **"Joins a later class at lesson 6" stays
deferred** (owner).

What the owner ruled is points 1 to 5. These are this step's readings:

- **The Life Class date for a student who passes later is the weekend they attended**, not the day
  it was recorded, the Encounter being the step they were waiting on. **"A later Encounter"
  includes their own class's weekend recorded after the class was posted**, whose date then falls
  before the posting day; it is the same *Not yet* passing on the same evidence.
- **The posted grade is found through the student's open Life Class enrollment**, not the one their
  weekend row was made from, which a move between classes has since ended.
- **Only a correction from came withdraws, and only the Encounter this weekend filed.** A first
  record of not attended files and withdraws nothing, so a weekend can never take back the
  Encounter another weekend filed.
- **A stale Admin tick is answered with decision 0282's conflict** before the school's refusal, so
  a line made against an older page is told what changed, and a correction is refused while any
  record of the person, a merged one included, holds the school's row of that program.
- **Nobody changes a graduation the school filed on the Training tab**, the Admin included,
  refused `INVARIANT_VIOLATION`; it is changed where the school recorded it. **The Admin may still
  correct or withdraw a tick from before the school**, with a reason as before. This replaces
  Section 29's earlier sentence that such a tick is "no longer editable", which predates point 1.
- **"The Admin" is read as `training.confirm` at Whole Church**, which only the Admin holds by
  default (a Senior Pastor holds no Training capability, decision 0326, and a Network Admin holds
  it at `NETWORK`). An explicit Whole Church grant would count too, the open question of whether
  "Admin" is a role or a capability.
- **A school row carries no confirming leader**: `confirmed_by` is null, as for a Network root,
  and `recorded_by` is the Registrar's account. Section 28's "null for a Network root and for
  nobody else" gains this case.
- **The school files only for a current person** (decision 0279): an archived or merged record is
  given nothing. A graduation held on a record merged into the person counts as held (decision
  0408). A tick landing at the same moment as the school's filing keeps the one current row, and
  the school's then files nothing rather than failing the posting or the Encounter save.
- **The two records coexist and the school's is authoritative for what it filed**, which settles
  what `CLAUDE.md` recorded as open about `training_graduations` once the enrolment application
  exists: the table stays Training's, the school writes into it through `TrainingService` alone,
  each row saying whether it came from the school.

Built in migration `0056_training_from_school.sql` (`training_graduations.from_school`, default
false so every existing row reads as before the school; `equipping_final_grades.passed_later_at`
and `passed_later_by`, the trigger keeping a posted grade as written but for setting those two
once on a *Not yet*; a school row confirms as nobody, and whether a row is the school's never
changes, both held by the database), `TrainingService.fileFromSchoolWithin` and `withdrawFromSchoolWithin`,
called inside the posting's and the Encounter save's own transactions, in person order as a
Training save locks its rows (Section 24), the list's
`school_may_tick` and each graduation's `from_school`, and the Training tab. Audited as
`training_graduation.confirmed` or `.corrected` with `from_school`, and
`equipping_final_grade.passed_later` on the student's **Person**.

Previous: [2026-11-22 — Final grades are checked by the Coordinator and posted by the Registrar](0508-final-grades-are-checked-by-the-coordinator-and-posted-by-the-registrar.md)
