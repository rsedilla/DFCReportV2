# 2026-09-08 — A yearly report returns the months that have begun and omits the rest

Section 18: "Senior Pastors can view January through December for a selected year." Section 22
lists `GET /api/v1/reports/dcc/yearly` and `GET /api/v1/reports/cells/yearly`.

Decision 0216 makes a month that has not begun unaskable, refused as `VALIDATION_FAILED`
against the period's start instant read from the database — and states its rule about "a
report" without saying which unit that rule binds. A yearly view of the current year is a
report whose period has plainly begun and most of whose months have not.

**A yearly report returns the months of the selected year that have begun, and omits the
rest.** The response names the months it covers.

## Why not refuse the whole year

Section 18 offers the yearly view to the two Senior Pastors, and the year they most want is
the one running. Refusing it until 31 December makes the view unavailable for eleven months of
every twelve and available for the twelfth, which is not what that section describes.

Nor does 0216 require it. That ruling refuses **a period that has not begun**, and a year in
progress has begun. Reading it as binding the year because it binds each month inside the year
is the inference this ruling exists to settle rather than a rule already made.

## Why not a not-yet-begun state

Decision 0216 considered and declined to invent a third period state for a month — there is
*open*, and there is *closed*, and Section 17's flag distinguishes them. Inventing that state
one unit up, in the ruling that sits beside it, would make 0216's own reasoning wrong about
the case it was written for.

## What omission has to carry, or it becomes the failure 0216 refused

0216's argument is that a future month answers "complete, well-formed, and saying that nobody
in the church attended anything" — the DCC calendar runs thirteen months ahead, so `n` and the
coverage denominator are real and the emptiness looks like data. **A yearly report that
silently returned eleven months and a gap would reproduce exactly that**, one unit up: a reader
would see a year that looks whole and is not.

So the response **names the months it covers**. That is not a new mechanism: Section 17 already
requires a report to say its period is open, "because an open month's coverage figure is still
changing", and this is the same obligation over a longer period.

## What this does not settle

**Which months a *closed* year contains** is not in question and is unchanged: all twelve.

**Whether a yearly figure is a sum of monthly ones** is a separate question this ruling does
not reach. One half of it is settled by Section 12 alone and is stated here because it needs no
ruling: classification cannot be obtained by **adding** the months, the ladder being a lifetime
count truncated at the **month's** end, so somebody who was a VIP in March and a Regular by
December belongs in one bucket for the year and summing would place them in two. *That
double-counting is Principle 10's rule against counting one person twice, reaching a unit
Section 20's own wording — "across multiple weeks or multiple Cells" — does not name, rather
than a classification effect.*

**Which month's classification a year carries is not settled here**, and is recorded as open in
`CLAUDE.md`. *An earlier version of this ruling answered "December's value", and the fix batch
of 2026-09-08 wrote the same answer into Section 20. It contradicts the rule this ruling exists
to state: a year in progress omits the months that have not begun, and December is among them,
so the answer names a month the report does not cover. It is withdrawn rather than reformulated,
and the question is escalated.*

**A yearly figure also has nowhere to be stored.** `report_snapshots` carries a `period`
documented as "the reporting month" and no yearly one (Section 20), and this ruling makes a
yearly classification uncomposable from stored monthly ones. The yearly slice meets that at the
same moment it meets the reconciliation question above; both are named here rather than settled,
so neither is invented at a keyboard.

**Nothing can reach any of it today.** Neither yearly route exists, and
`assertReportingPeriodHasBegun` takes a month rather than a year.

---

Decision 0222, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-08 — A Cell figure's responsible leader is placed by Section 20's placement graph](0221-a-cell-figures-responsible-leader-is-placed-by-the-placement-graph.md)
