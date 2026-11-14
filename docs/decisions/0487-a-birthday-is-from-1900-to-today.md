# 2026-11-13 — A birthday is a day from 1900 to today

Owner ruling, 2026-11-13, after the owner found that the Birthday box on *Add a person* let a
six-digit year be typed (`25/07/555555`).

## The ruling

**A birthday is a day from 1 January 1900 to today in Manila.** The server refuses a later or an
earlier day as `VALIDATION_FAILED` on `birth_date` when a person is added, when a person is edited,
and on the Network Admin's form, saying *A birthday cannot be in the future* or *A birthday cannot
be before 1900*. The leadership-tree import refused a future birthday already and warned on one
before 1900; it now refuses both.

**The screens' date boxes have limits**, so a year takes four digits: the two Birthday boxes run
from 1 January 1900 to today, and the Encounter season boxes stop at 9999. The graduation date and
the sex correction's date already stopped at today. The server stays the check (Section 7); the box
only stops the mistake before Save.

A future birthday recorded before this ruling stays until an edit sends a corrected one. Edit
details sends the recorded birthday with every save, so the server refuses the save and asks for it.

**A merge does not copy a birthday outside the range.** Person Merge copies a birthday the kept
record lacks from the duplicate; where the duplicate's is outside 1 January 1900 to today, it is
not copied and the kept record stays without one, so somebody adds the right one later by an edit.
The merge goes through, and the merge screen says before it that the birthday is not copied. Owner ruling, 2026-11-14, on a Stop Condition `architecture-guardian`
raised: Section 3 never fills a birthday in for the sake of having one, and refusing the merge
would hold a duplicate in every count over a detail.

## Why

Section 22 says a date's range is each field's own rule, and Section 3, the birthday's, set none,
so the server accepted a birthday in 2099 or in the year 1000. The six-digit year was already
refused, by the `YYYY-MM-DD` check, but only after Save. A birthday in the future is never true, and
one before 1900 is almost always a two-digit year expanded wrongly, which is what the import already
warned of.

## The database constraint

**The 1900 floor is a database constraint**, `persons_birth_date_not_before_1900`, added by
migration `0047_birth_date_floor.sql`, which the Definition of Done asks of an invariant a constraint
can express. The Migration policy requires the live data to be checked first: on 2026-11-14 the
server answered 0 to `SELECT count(*) FROM persons WHERE birth_date < '1900-01-01'`, so the
constraint is validated rather than added `NOT VALID`. The future half cannot be a constraint,
because today moves.

---

Decision 0487, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 3.

Previous: [2026-11-13 — The Senior Pastors' *Figures for* is All, Men's and Women's](0486-the-senior-pastors-figures-for-is-three-buttons.md)
