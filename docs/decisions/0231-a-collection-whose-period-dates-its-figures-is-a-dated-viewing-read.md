# 2026-09-10 — A collection whose period dates its figures is a dated viewing read

Section 7 fixes when a viewing capability owes a dated resolution, and it fixes it on what
the request names:

> "**A viewing request that names no period is asking about now**, and resolves through the
> Cell's current leader on the base bullet's terms, falling back to its last leader where
> the Cell is closed. It is a *dated* viewing read — one asking about a past month — that
> owes a resolution as of that period."

It also warns, in the same paragraph, against the opposite error: the distinction exists
because datedness "was previously enforced as though declaring a viewing capability were
itself the trigger", which would have made `GET /api/v1/cells/{id}/members` owe a resolution
for a period it never names.

`GET /api/v1/cells` carries `cell.view_subtree` and takes a **required** `month`. On the
sentence above it is a dated viewing read. It was built resolving its membership at `now`.

**A collection under a viewing capability that names a period resolves its membership as of
that period, at the period's final millisecond.** That is the instant decision 0218 already
fixes for a report scope selector, adopted here rather than a second one being derived.
**The same instant governs a `CELL` report scope selector**, which this ruling confirms as
deliberate rather than incidental — see *The sibling question* below.

## What the route did, and what it does now

The membership rule lived in `cellsInScope`, which joins leaderships on `ended_at IS NULL`.
The two coverage figures beside it were derived from the month. So one row carried a
current-state membership decision and a period-dated pair of figures, and nothing said why.

Reproduced against the database, asking about **August** with three candidate rules:

| Question asked about August | Current leader | Period's final instant | Union over the period |
| --- | --- | --- | --- |
| Handover on 1 September | Mark, who held none of August | Oriel, who held all of it | Oriel |
| Handover on 15 August | Mark | Mark | Oriel and Mark |

The first row is the defect. A Cell handed over after the period ends lists for the incoming
leader, carrying a coverage line for a month they had nothing to do with, while the leader
who oversaw every week of it cannot reach the Cell at all.

**The second row is why the union was not chosen, and it is the part that is easy to get
wrong.** Resolving at the period's final millisecond does *not* give a mid-month handover to
both leaders. It gives that month to whoever held the Cell when the month ended, exactly as
the current-state rule does. What this ruling fixes is the first row only.

## Why the period's final instant rather than the union

**Because Section 7's rule is containment at an instant, and never an allocation between
parties.** Every other target in this section resolves to one leader at one moment and asks
whether the actor's subtree contains them. A union would be a third rule, belonging to
neither of the two Section 7 defines, and it would widen visibility past what either instant
authorises. Decision 0220 refused a comparable widening for a report, on the ground that a
Cell's report would become partly readable; the same argument reaches a list.

**Because the instant already exists and is already load-bearing.** Decision 0218 settled
that a report resolves at the period's final millisecond whether the period is open or
closed, after that claim had been asserted four times by people settling nothing. Choosing a
different instant for a collection would put two answers in the section that spent a ruling
getting to one.

**What it costs is stated rather than argued away.** A leader who hands a Cell over keeps
the months they oversaw and loses the month of the handover itself, because that month
resolves through the incoming leader. That is not a rounding of the rule — it is the rule,
and it is the same answer Section 7 already gives a `CELL` report selector.

## The reachability cost, which is real and is not settled here

The route was left undated on the argument that an index must list exactly the Cells whose
detail routes the actor can reach: `GET /api/v1/cells/{id}/meetings` takes the same `month`
and resolves undated, so a dated index lists a row whose detail route then refuses.

That argument is answered by Section 7 rather than accepted. The neighbour carries
`cell.take_attendance`, a **recording** capability, which the ruling of 2026-09-02 puts in
the undated class deliberately and "whether the route it guards reads or writes". The two
routes are meant to resolve differently, so a divergence between them is not evidence that
either is wrong.

**The gap it leaves is genuine and belongs to a question already open.** Whether Section 7's
closed-Cell fallback survives for a capability that resolves as a write is recorded in
`CLAUDE.md`, and `GET /api/v1/cells/{id}/meetings` is named there as the one live route the
tension still reaches. This ruling does not settle it and does not lean on it. Whoever
settles it should know that the index now hands that route a Cell the actor held in a past
period, which is the case that makes the two rules visibly disagree on one screen.

## What is not changed

**Closed Cells.** The index lists `ACTIVE` Cells only, and a Cell closed inside the period
returns no row under any of the three rules above — reproduced, and 0 rows either way.
Section 19 requires a closed Cell's meetings to stay reachable while their month is open,
and the screen ledger already records that this route does not discharge it. Dating the
membership neither fixes that nor worsens it, and folding it in would have been a second
ruling wearing the first one's name.

**Every write.** Section 7's closing clause under this heading is untouched: authority
resolves through the current leader, and a write carrying an effective date other than now
is still authorized now. A viewing capability confers no write.

## The sibling question, settled with it

`CLAUDE.md` carried a second Stop Condition asking which leader a period that two leaders
each held part of resolves through, for a `CELL` report scope selector — with the same three
candidate answers. It is the same shape as this one, one route over, and settling one while
leaving the other would have put one shape under two rules.

Section 7 already states the answer for that target: the closed-Cell fallback "fires only
where the instant finds nobody… so a **handover** never invokes it: each past period
resolves to whoever held the Cell at that period's end." What was open was whether that
stated rule was *right*, given that Section 13 and decision 0187 settle the structurally
identical question one unit down — which leader a meeting on the handover day belongs to —
as the **outgoing** one.

**It is right, and the two are not in tension, because they are asked at different
granularities.** Decision 0187 decides a single meeting, which has a date of its own, and
its reason is that attribution must not depend on when the record was entered. A period has
no date of its own; it has two ends. Resolving it at its final instant is a choice of end
rather than a choice of clerk, so 0187's reason does not reach it. Carrying 0187 upward
would mean resolving a period through whoever held the Cell when it *began*, which is the
mirror-image loss and not an improvement.

So the report selector keeps the rule it has, and this ruling records that it was kept
deliberately. No code changes for that target; the collection is the half that moves.

---

Decision 0231, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — A `NETWORK`-scoped DCC coverage figure narrows by membership at the event date](0230-a-network-scoped-dcc-coverage-figure-narrows-at-the-event-date.md)
