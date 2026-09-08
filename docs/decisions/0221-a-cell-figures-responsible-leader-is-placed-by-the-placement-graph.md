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

**Section 20's placement rules are stated about placing a person, and a responsible leader is
one.** The section's fallbacks are written as "where the person key finds no open assignment
at the period's end" and "where the chain reaches a leader who held no assignment within the
period" — both are rules about resolving *somebody* into a subtree, and neither is specific to
who is being counted. Reading them as available only to the counted person leaves the second
key with no rule at all, which is the state this ruling ends.

**It keeps a Cell's month whole.** Section 12 says a Cell report "belongs to the Cell's
leader", and a Cell handed over mid-period has one month of meetings. Placing the responsible
leader once for the period puts that month in one subtree.

## What was rejected

**The tree in force at the period's end** — the dated walk decision 0214 uses to *authorize* a
report. It is the wrong instrument here for the reason 0214 gives for using it there: the
narrow graph authorizes and the wide graph computes. Using the narrow one to compute would
drop the attendees of a departed leader's meetings out of every leader's figure while the
Whole Church total keeps them, which is the additivity failure decision 0206 exists to
prevent.

**The tree in force at each meeting's date**, which is what coverage does and is the reading
with the strongest internal symmetry — Section 20 already resolves the third key that way, and
Section 13 already freezes the responsible leader per meeting. It is rejected because it
splits one Cell's month between two leaders' subtrees when the Cell changes hands mid-period,
and Section 12 puts a Cell report under the Cell's leader rather than under whoever ran each
week. *That is a real cost of the ruling and not an argument against the alternative: a
handover genuinely does mean two people ran the month, and this places it under one of them.*

## The second residual, which Section 20 names nowhere

Section 20 names one residual — somebody who held no open assignment at any instant of the
period appears "in no leader's figures", in the Whole Church total and their Network's. That
sentence is about the **counted person**.

Applying the placement graph to the responsible-leader key creates a second one, about a
different party: **a responsible leader who held no assignment at any instant of the period
takes the attendees of their meetings out of every leader's Cell figure**, while the Whole
Church total keeps them. The attendees themselves may be perfectly well placed; what is
unplaceable is the leader their meetings are attributed through.

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
