# 2026-09-08 — A Cell figure's responsible leader is placed by Section 20's placement graph

Section 20 names **three** attribution keys and states a placement rule for two of them.

> "a monthly report resolves the tree at **more than one instant**: the period's end for the
> person key, and each event or meeting date for coverage."

The second key is not in that sentence. Section 20 gives it a frozen *value* — Cell unique
people and classification "attribute by the meeting's responsible leader, **frozen as of the
meeting date**" — and then says nothing about how that leader is placed in a subtree, or at
what instant. Placing them is a separate question from choosing them, and the first Cell
report had to answer it.

**A Cell figure's responsible leader is placed by Section 20's placement graph, over the
period being reported** — the same graph, with the same fallbacks, that the person key uses.

## Why this rather than the two alternatives

**One of Section 20's two fallbacks is already generic, and this ruling makes the other one
so.** "Where the chain reaches a leader who held no assignment within the period, it continues
from that leader's last assignment" is written about *a leader being placed* and never about
who is being counted — so it applies to this key as it stands. The other begins "Where **the
person key** finds no open assignment at the period's end", which is specific by its own
words. Section 20 is amended in this change to state that one about a person being placed
rather than about the person key, because that is what makes "the same fallbacks" true of the
text rather than only of the intention.

*An earlier version of this ruling claimed **neither** fallback was specific, and quoted the
one containing the words "the person key" as its evidence. Reading the quotation refutes the
sentence it was quoted in.*

**Placement once per period is what the rest of Section 20 already assumes.** The
departed-leader fallback reaches back before the period, and the additivity claim is stated
over a period rather than over an instant. A key placed per meeting date would sit outside
both.

## What was rejected

**The tree in force at the period's end** — the dated walk decision 0214 uses to *authorize* a
report. It is the wrong instrument here for the reason 0214 gives for using it there: the
narrow graph authorizes and the wide graph computes. Using the narrow one to compute would
drop the attendees of a departed leader's meetings out of every subtree **above** that leader
while the Whole Church total keeps them, which is the additivity failure decision 0206 exists
to prevent. *It said "every leader's figure", which is false of the leader themselves: both
walks seed at the leader named, so that leader's own figure keeps them at depth zero.*

**The tree in force at each meeting's date**, which is what coverage does and is the reading
with the strongest internal symmetry — Section 20 already resolves the third key that way, and
Section 13 already freezes the responsible leader per meeting. It is rejected because it would
place a leader at instants before their own assignment began: a meeting in the first week of a
month run by somebody assigned in the third week has no placement at its own date, and the
per-meeting reading supplies no fallback for that, where the period reading places them from
the assignment they hold within it.

**No exhaustive statement of what separates the two answers is made here.** Two have been
written and both were refuted: a Cell changing hands mid-period, and then a mid-period
*reassignment* of the responsible leader "and nothing else" — the second falsified by a
mid-period **closure with no replacement**, which Section 5 permits and which is not a
reassignment, and by a leader whose last assignment ended before the period, who separates them
through the departed tier. The readings diverge wherever the responsible leader's **own**
placement moves within the period; that is recorded as a direction rather than as a closed list,
because a third formulation of a sentence two reviews have refuted is what this project's own
rule against rewriting twice-refuted prose exists to prevent.

*An earlier version of this ruling said the discriminator was a Cell changing
hands mid-period, and offered the resulting split month as the chosen answer's accepted cost.
Both were wrong: the responsible leader is frozen **per meeting** (Section 13, decision 0163)
and the figures query selects meetings by that frozen column, so a Cell handed over mid-period
puts its meetings under two leaders under **either** reading. The split is a property of the
value key, which this ruling does not touch, and the scenario named as the discriminator was
the one scenario both answers treat identically.*

## The second residual, which Section 20 names nowhere

Section 20 names one residual — somebody who held no open assignment at any instant of the
period appears "in no leader's figures", in the Whole Church total and their Network's. That
sentence is about the **counted person**.

Applying the placement graph to the responsible-leader key creates a second one, about a
different party: **a responsible leader who held no assignment at any instant of the period
takes the attendees of their meetings out of every subtree above them**, while the Whole
Church total keeps them — their own `LEADER`-scoped figure still contains them, because the
walk seeds at the leader named and they are in their own subtree at depth zero. The attendees
themselves may be perfectly well placed; what is unplaceable is the leader their meetings are
attributed through.

*This said "every leader's Cell figure" in both places above. The fix batch of 2026-09-08
listed the correction as made and applied it to Section 20 alone, leaving the ruling asserting
the thing the specification had just stopped asserting — one rule, two homes, corrected in one,
which is the shape this project records against itself more than any other.*

It is named here and amended into Section 20 because the residual sentence there reads as
exhaustive and is not. Both residuals have the same remedy and neither is reachable by
accident.

## What this does not change

**No figure moves.** `ReportingService.cellMonthly` already hands `hierarchy.reportingSubtree`
into its `RESPONSIBLE_LEADERS` population; this ruling states the rule that code was already
following, which is the whole reason it was raised as a Stop Condition rather than as a
defect.

**Coverage is not settled by it.** Section 20 states coverage's instant already — each event or
meeting date — and this ruling deliberately leaves that alone. What it removes is the risk of
the coverage slice deriving a *third* answer from a second key that had none.

---

Decision 0221, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A `CELL` report scope selector resolves through the Cell's leader](0220-a-cell-report-selector-resolves-through-the-cells-leader.md)
