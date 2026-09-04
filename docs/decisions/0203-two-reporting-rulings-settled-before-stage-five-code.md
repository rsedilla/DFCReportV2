# 2026-09-04 — Two reporting rulings settled before Stage 5 code, and a third whose premise was wrong

Both of these name Stage 5's reporting as their own trigger, and both would otherwise be
settled at a keyboard mid-slice — which is how the transitions slice went wrong.

## A closed Cell carries the category it held when it closed

Section 10 requires a historical report to use "the category valid at the time being
reported". A closure ends the open `cell_categories` row on its effective date, and Section
12 evaluates a month's figures as of the end of the reporting month. So a Cell closed on 10
March has **no** category row valid at 31 March.

Two answers were available, not three: read the last category the Cell held, or exclude the
Cell from the month. *The third option recorded in `CLAUDE.md` — evaluate the category as of
the closure date — is the same answer as the first, because a closure is what ends the row.
They were listed as distinct and are one.*

**The ruling: the category valid at the time being reported is read at the last instant the
Cell existed.**

Excluding it is refused on Section 10's own words: a Cell closed part-way through a month
"simply has fewer recorded meetings" — fewer, not none — so dropping it from the month would
discard meetings it actually held and attendance actually recorded. And the idiom is already
in this specification at the same boundary: Section 13 reads the closure instant as the end
of that day for a meeting's own lookups, so that a meeting on the closure date finds a leader
and a roster rather than falling outside both.

Contained in practice: Section 10 says a count of Cells or Cell categories means active Cells
unless a report says otherwise, so most reports never reach the question.

The schedule row is deliberately not treated the same way, and that is not an inconsistency:
a closed Cell must stop deriving scheduled meetings, which is the point of ending that row.

## An Admin amendment may create a record where there was none

Section 13: "Once closed, unreported meetings remain permanently unreported and outside the
denominator, and coverage for that month is frozen. Only Admin may amend a closed month …
invalidating that month's stored figures."

The objection recorded against creating a record was that it moves the month's numerator
while the coverage denominator is frozen, so the two halves of the coverage line stop coming
from the same population.

**The ruling: it may, and the objection rests on a misreading of what is frozen.**

That clause freezes the month against *ordinary submission*. An amendment is the stated
exception, and by the same sentence it **invalidates the stored figures** — so a month moving
is what an amendment is for, not an anomaly it causes. Section 20 keys a stored figure to a
version of the source records it derives from, so numerator and denominator are recomputed
together from the amended records and are never drawn from different populations. There is no
separately frozen denominator to fall out of step.

What stays permanently outside the denominator is a meeting **nobody ever reported**. A
meeting reported late, by an amendment carrying a reason and an audit entry, has been
reported.

The practical argument runs the same way: a missing record is the commonest form a wrong
month takes, so an amendment that could only correct records that already exist would not
reach the case it exists for.

## The third had its premise refuted rather than settled

`CLAUDE.md` records the question of whether reading a Cell's roster deserves a read capability
of its own, and states that inventing one is not available because Section 7 declares its
capability list closed.

**`cell.view_subtree` already exists.** It is in Section 7's list, it is named among the
Read capabilities, and it is one of the three capabilities that resolve as of the period
being viewed (decision 0186). It guards no route: it appears in the `Capability` enum and in
the role defaults and nowhere else.

So the question is not whether to add a capability. It is that `GET /api/v1/cells/{id}/members`
is guarded by `cell.manage_membership` while the capability written for exactly this read sits
unused — which is why nobody can be given roster visibility without the power to change the
roster, since Section 7 makes `read_only` valid only on a read capability.

**Not settled here, deliberately.** Changing which capability guards a live route changes
authorization, which `CLAUDE.md` makes a Mandatory Review condition, and it belongs in a
change that can be reviewed as one rather than inside a specification ruling. The bullet is
narrowed to what was actually found.

---

Decision 0203, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — What an aggregate Cell attendance view offers instead of buckets: nothing further](0202-what-an-aggregate-cell-attendance-view-offers-instead-of-buckets.md)
