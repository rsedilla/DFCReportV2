# 2026-09-08 — A Cell figure's responsible leader is placed by Section 20's placement graph

Section 20 names **three** attribution keys and, **before this ruling**, stated a placement rule
for two of them. It read:

> "a monthly report resolves the tree at **more than one instant**: the period's end for the
> person key, and each event or meeting date for coverage."

*That sentence no longer exists in `SKILL.md`: this ruling amended it, and it now names the
responsible-leader key between the two. The quotation is the superseded text, kept because it
is the evidence the ruling argues from, and marked because a reader grepping the specification
for it would otherwise find nothing and doubt the quotation rather than the tense.*

The second key was not in that sentence. Section 20 gives it a frozen *value* — Cell unique
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

**No characterisation of what separates the two answers is made here.** Three have been written
and each was refuted: a Cell changing hands mid-period; a mid-period *reassignment* of the
responsible leader "and nothing else" — falsified by a mid-period **closure with no
replacement**, which Section 5 permits and which is not a reassignment, and by a leader whose
last assignment ended before the period, who separates them through the departed tier; and,
offered as a weaker "direction" rather than a closed list, that the readings diverge wherever
that leader's **own** placement moves within the period. The third is no safer than the two it
replaced: it is **not sufficient** — a leader reassigned mid-period whose meetings all fall
after the move is placed identically by both readings — and **not necessary**, the departed
case two sentences above being a counter-example this ruling had already written down.

*Three formulations, each refuted, is the point at which this project's rule is to state
nothing rather than to write a fourth. The ruling does not rest on such a characterisation:
what decides it is the argument above — a per-meeting reading places a leader at instants
before her own assignment began and supplies no fallback for that.*

*An earlier version of this ruling said the discriminator was a Cell changing
hands mid-period, and offered the resulting split month as the chosen answer's accepted cost.
Both were wrong: the responsible leader is frozen **per meeting** (Section 13, decision 0163)
and the figures query selects meetings by that frozen column, so a Cell handed over mid-period
puts its meetings under two leaders under **either** reading. The split is a property of the
value key, which this ruling does not touch, and the scenario named as the discriminator was
the one scenario both answers treat identically.*

## The second residual, which Section 20 names nowhere

Section 20 names one residual — somebody who held no open assignment at any instant of the
period, **and none before it either**, appears "in no leader's figures", in the Whole Church
total and their Network's. That sentence is about the **counted person**.

*The qualifying clause is load-bearing and was dropped from both paraphrases in this file
until 2026-09-08. Without it the class is wider than the one Section 20 names, and the
sentence below became false of part of it.*

Applying the placement graph to the responsible-leader key creates a second one, about a
different party: **a responsible leader in that same state — no assignment at any instant of
the period, and none before it either — takes the attendees of their meetings out of every
subtree above them**, while the Whole
Church total keeps them — their own `LEADER`-scoped figure still contains them, because the
walk seeds at the leader named and they are in their own subtree at depth zero. The attendees
themselves may be perfectly well placed; what is unplaceable is the leader their meetings are
attributed through.

**This residual is not exhaustive, and what it leaves out is recorded as open in `CLAUDE.md`
rather than settled here.** A responsible leader who held an assignment **before** the period,
none within it, and **whom no edge of the placement graph names as leader**, is also dropped
from every subtree above, and she is outside the class above because she held an assignment
before the period.

*The condition is stated as the graph's own because three English paraphrases each failed
differently. "Leads nobody" missed that the `departed` tier is recursive — it admits a leader
who leads somebody already placed, then a leader who leads one of those — so leading somebody
is not sufficient. "None of whose disciples is itself placed" then failed in **both**
directions: a leader whose former disciple has since moved to another leader is dropped while
that disciple is placed, and a leader whose disciple's own disciple holds an open row is placed
while nobody sits under her within the period; it is also circular for a mutual pre-period
pair. The tier admits exactly a leader whom some edge names as leader, so the class is that
condition's complement, and saying so is both shorter and checkable against the query.* Stating the residual over the wider class
would have covered her by wording alone, which is how a question comes to be recorded as open
while a shipped ruling answers it; it would also have been **false** of the neighbouring
sub-class, a leader in the same position who *does* lead somebody, whom the `departed` tier
places exactly as Section 20 requires.

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
