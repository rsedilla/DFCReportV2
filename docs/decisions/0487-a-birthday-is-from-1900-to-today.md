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

A birthday already recorded outside the range stays until an edit sends a corrected one. Edit
details sends the recorded birthday with every save, so the server refuses the save and asks for it.

## Why

Section 22 says a date's range is each field's own rule, and Section 3, the birthday's, set none,
so the server accepted a birthday in 2099 or in the year 1000. The six-digit year was already
refused, by the `YYYY-MM-DD` check, but only after Save. A birthday in the future is never true, and
one before 1900 is almost always a two-digit year expanded wrongly, which is what the import already
warned of.

## What is owed

**The 1900 floor as a database constraint**, which the Definition of Done asks of an invariant a
constraint can express. The Migration policy requires the live data to be checked first, so it is
owed until somebody confirms on the server that `SELECT count(*) FROM persons WHERE birth_date <
'1900-01-01'` answers 0. The future half cannot be a constraint, because today moves.

---

Decision 0487, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 3.

Previous: [2026-11-13 — The Senior Pastors' *Figures for* is All, Men's and Women's](0486-the-senior-pastors-figures-for-is-three-buttons.md)
