# 2026-09-06 — A report's guard walks the as-of tree, outside the report's snapshot

The first reporting route needs an authorization walk that does not exist. Four bullets in
`CLAUDE.md` have been waiting for it, and they are three questions: whether the walk runs
inside the report's own snapshot, which graph it walks, and the dated upward walk itself.

**One ruling, because one change owes all three and they meet at one seam.** That is the
opposite of the mistake decision 0211 made and is worth stating as such: 0211 was withdrawn
because it was drafted **early and separately**, which coupled it to 0210 at a seam neither
ruling owned. These three are owed by a single route, and answering any one alone leaves
the other two undecidable.

**No route exists yet, and this ruling does not pretend otherwise.** What is in hand is the
service the route will call, the guard it will pass through, and the walk it will need —
`ReportingService.dccMonthly`, `AuthorizationService.covers`, `HierarchyService.ancestorsOf`
— all of which were read before this was written. That is a weaker claim than settling a
ruling against a built route and a stronger one than 0211's, which was drafted with none of
it. *A first version of this paragraph said the three were "settled with that route's code
in hand", which was false in the plainest way: the route is what this ruling exists to make
buildable.*

## The route this is about

`GET /api/v1/reports/dcc/monthly`, guarded by `reports.view_subtree`, taking the scope
selector `ReportScope` already in the service — `WHOLE_CHURCH` or `LEADER`. Section 7 makes
a report scope selector **itself the target**, and decision 0207 gives it an instant: it
resolves as of the period being reported.

## The walk runs outside the report's snapshot

**Outside**, in its own read, on the pooled connection — which is where every guard in this
application already runs.

`AuthorizationService.covers` **deliberately takes no executor** — a signature accepting one
"would invite exactly the call this method exists to make possible, and would silently fail
to deliver it" — and its sibling `coversWith` takes one so that a caller already inside a
transaction can decide there.

**Other callers do re-decide inside a transaction, for several different reasons** — a lock
that changed what the decision rests on, an instant only the transaction has, Section 24's
rule against reaching the pool from inside a transaction, and in two places the reverse: a
pooled read after a rollback, which Section 22 requires to see committed state.

**None of those reaches a report, and the reason is one fact rather than a survey: its guard
runs before the transaction exists.** No connection is held, so no liveness question arises;
there is no lock, so no post-lock state; there is no transaction-derived instant, because the
period's bounds come from the request's own argument; and nothing is rolled back, because
nothing is written.

*Three earlier versions of this paragraph each named a single reason the other callers take
an executor — liveness, then a lock, then a three-form generalisation — and
`architecture-guardian` refuted each of the three against the call sites. The survey was
never load-bearing: the answer rests on Section 24's third clause and on where the guard
already runs. It is **cut rather than corrected a fourth time**, and that is the part worth
keeping. The tidy generalisation was the defect, not the answer it was decorating, and three
review passes were spent on commentary nothing required.*

`ReportingService.dccMonthly` opens its `READ ONLY` `REPEATABLE READ` transaction *inside
itself*, after the guard has already decided. So "outside" is the architecture as it stands,
and "inside" would be a deliberate restructure undertaken to obtain a property nothing has
asked for.

**Section 24's third clause is preserved rather than spent.** Section 24 rests the
isolation exception on three clauses — no row or advisory lock, writes nothing, decides no
authorization — and says the third is "a fact about the system as it stands rather than a
property of reporting", adding that "a change that measures an actor's reach against the
same snapshot a report is computed from would falsify it". This ruling is the change that
arrives at that sentence, and it declines to falsify it. Section 24's observation that "no
reporting route exists" is **replaced by a rule rather than by a fact**: the clause holds
because a report's authorization is decided before its transaction opens, which this ruling
fixes, and not because a route has appeared. None has.

**Inside would be Section 24's own hazard with the lock removed.** All three mechanisms
Section 24 protects are *lock, then decide*, and the failure it names three times is
deciding on a pre-lock snapshot. Authorizing from a tree fixed before the decision is that
shape exactly, minus the lock that would at least have serialized it.

**What outside costs, stated in both directions.** The guard and the figures read at two
instants, and three cases follow.

For a **closed** month both resolve against fixed history, so both read the same rows
whenever each of them reads. The exception is a **concurrent backdate**, which can move a
closed period's tree between the two reads. *This ruling first said Section 20's
invalidation list "already covers" that; it does not. That list governs when a stored figure
must be recomputed rather than served, and recomputing a snapshot does not make two reads on
two connections agree.* The residual is an actor authorized against a tree a backdate has
just moved, for the duration of one request. It is left as a residual rather than described
as covered.

For an **open** period the two can differ by a reassignment committing between them, and the
direction matters. A person moving **under** `L` after the guard ran is someone the actor was
already authorized to see by virtue of being authorized over `L`, so that direction widens
nothing. **`L` moving out of the actor's subtree between the guard and the snapshot is the
other direction, and it is decide-then-read staleness**: the guard passed, and the figures
are returned to an actor no longer authorized over `L`. It is bounded by one request and is
the same property any in-flight request has when authority changes underneath it — but it is
the mirror of the shape this ruling invokes against "inside", and saying so is the point of
stating a cost.

*And the instant is not "now", whatever Section 20's first sentence says.*
`reportingPeriodBounds` returns the last millisecond of the month's final day, which for an
**open** month is a **future** instant, behaving as "now" only because no write path produces
a future `started_at`. That is an accident of the data rather than a construction. It does
not disturb anything here, because the guard inherits whichever instant the figures use —
which is the property that matters, and is the half this ruling fixes.

## The guard walks the as-of tree, not the placement graph

**The tree in force at the period's end**, resolved upward — the graph `subtreeAsOf` reads,
not the placement graph of Section 20.

Two graphs, deliberately, and the division is the point: **the wider graph computes, the
narrower graph authorizes.**

Section 20's placement graph is an arithmetic device. It exists so that totals sum — a
person with no open assignment at the period's end is placed by the last one they held
within it, and decision 0209 continues the chain past a leader who held none within the
period, from their last assignment **whenever it was**. Every tier of it was derived from
an additivity requirement, and none of it from a question about who may see whom.

**Decision 0209 treats the very condition that widens the graph as a defect to be
surfaced**, not as a relationship. Where a person's pastoral leader is archived, Section 20
requires them on an attention list shown to the upline who can act, on Section 15's terms,
because "a report that quietly reconstructs the chain removes the pressure to reassign
anybody, so the transient state it accommodates would stop being transient". *Quoted as "so
the fix does not hide the gap" in a first version, which is `CLAUDE.md`'s paraphrase of
decision 0209 and appears nowhere in `SKILL.md`.* A visibility grant measured on that same graph would
read the identical fact as a licence: the arrangement the specification calls a gap
requiring repair would become the arrangement that grants access.

The concrete case, which is why this is a ruling rather than a preference. `X` holds an open
assignment under `D`; `D` left in 2020, and `D`'s last row, from 2019, named `U`. On the
placement graph `X` is inside `U`'s subtree. Measured there, `U` may read and drill into
`X`'s attendance six years after any pastoral relationship between them ended — which
Principle 5 refuses and the tree in force at the period's end refuses.

Decision 0207 also reasons about "the October tree" throughout, which is decision 0205's
`subtreeAsOf` and not the placement graph. This ruling makes explicit what that reasoning
assumed.

**What the division costs, and it costs in both directions.**

**The aggregate is wider than the reach.** A leader-scoped total is computed over the
placement graph, so it can cover people the actor could not reach one at a time. Accepted
**on this route and on this route only**, because the payload names nobody: `DccMonthlyReport`
carries the scope, the period, whether the month is open, `n`, the removed events, a count of
unique people, the classification and the buckets. *Its `scope` does carry a person
identifier for a `LEADER` report — the caller's own input echoed back, so no new disclosure,
but "no person identifier anywhere" was wrong as written.*

**Naming nobody is not the same property as publishing no per-person figure**, and the
difference is worth stating rather than resting on. An actor holding `OWN_SUBTREE` may
request a report for any selector inside their as-of subtree, so they may request their own
and each child's and subtract; where the residual is one person, that person's counts and
buckets are isolated, unnamed but structurally located. Every hierarchy aggregate is
differenceable in that way and this ruling does not treat it as disqualifying — it is
recorded because the acceptance above would otherwise read as resting on a stronger property
than the payload actually has.

**The reach is narrower than the aggregate, and that is the cost this ruling nearly failed to
state.** Take a leader `L` archived on 15 October whose last in-period leader was `A`.
`reportingSubtree`'s within-period tier selects `L`'s row, so `L` and everyone beneath them
sit inside `A`'s October total; the dated upward walk runs at the period's end, where `L`
holds no row, so `A` is refused `L` as a selector. `A` therefore sees a total containing
`L`'s subtree and cannot ask for the breakdown that explains it — which is, on the graph
axis, the defect decision 0207 removed on the date axis, and in that ruling's own words:
"authorizing undated would show a figure while refusing the breakdown that explains it,
against Section 20's additivity — on the actor's own screen rather than in the arithmetic".

It is accepted here because the alternative is worse and is the case this section is about:
measuring reach on the placement graph lets a leader read the figures of somebody whose only
connection is a chain through a person who left years ago. But it is not free, it reaches
every leader archived or unassigned mid-period — the population Section 3 forbids filtering
out of a period-based report — and **whether that refusal should stand is recorded as open in
`CLAUDE.md`** rather than settled by the fact that the alternative is worse.

Section 20's two reconciliation identities are untouched either way: the population the
figures are computed over is unchanged, and what this ruling fixes is who may ask for them.
What the paragraph above concerns is Section 20's cross-level drill-down additivity, which is
a different claim and is the one at risk.

## The dated upward walk

`ancestorsOf` filters `ended_at IS NULL`, so `isWithinSubtree` — and therefore every scope
decision in the application — answers about **now**. A leader asking for October's figures
for somebody who left their subtree in November is refused by the guard today, which is
exactly what decision 0207 says must not happen.

The walk `hierarchy` owes is `ancestorsOf`'s dated counterpart, taking the same instant
`subtreeAsOf` takes and applying the same predicate — `started_at <= at AND (ended_at IS
NULL OR ended_at > at)` — with the same `CYCLE` clause and the same refusal, because
Section 5 requires cycle detection of every walk of the tree and this one is no exception.
It belongs in `hierarchy`, which owns `pastoral_assignments` (Section 2).

**The rule this ruling fixes is that the guard uses the same instant the figures use** — not
which instant that is. That much is required for the guard and the population to describe one
tree, and it is settled here. **Which instant Section 20 means for an *open* period is not**,
and is escalated: Section 20 says "an open period therefore resolves as of now" and, three
lines later, that "the instant is the last millisecond of the period's final day". Both are
Section 20's, they differ for every open month, and they agree today only because no writer
produces a future `started_at`. `reportingPeriodBounds` implements the second. The guard
inherits whichever the report uses, so this ruling stays correct under either answer and
invents neither. *A first version of this sentence fixed the instant at `endOfManilaDay` of
the period's final day, settling in a ruling the thing the open list beside it escalates.*

**Datedness is keyed to the capability, not to the route or the method.** Section 7 names a
closed list of three capabilities that resolve as of the period being viewed —
`cell.view_subtree`, `reports.view_subtree` and `audit.view` — and decision 0186 settled
that the capability decides and the HTTP method does not. `reports.view_subtree` is on that
list, so the target it resolves against must carry the period; the undated walk stays what
every other capability uses.

**A `WHOLE_CHURCH` selector needs no walk at all.** Section 7 states the rule directly of a
report scope selector: a request for a scope the actor does not hold is `SCOPE_DENIED`,
"never silently narrowed to what they do hold". So a Whole Church selector is covered by a
Whole Church grant and refused otherwise, and no tree is walked in either case. *Section 7's
neighbouring sentence — that a target "is never in scope at any narrower value" — is said of
a **setting**, and is not the authority for this; the selector's own bullet is.*

## What is not settled here

**Which graph authorizes a per-person drill-down.** This route has none, and the drill-down
is the surface where the difference between the two graphs becomes a disclosure of an
identity rather than a difference in an aggregate. It stays open in `CLAUDE.md`, with the
third answer recorded there — authorize the aggregate on the wider graph and the drill-down
on the narrower — now half-taken rather than untested: this ruling takes the aggregate half
and leaves the other for the route that owes it.

**Whether two `pastoral_assignments` rows for one Person may overlap historically.** The
dated upward walk inherits that question exactly as `subtreeAsOf` did — an overlap would put
a person on two chains — and it stays open with the same remedy, a database constraint.

---

Decision 0214, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-06 — Interface debt is recorded, and a check derives what owes a screen](0213-interface-debt-is-recorded-and-a-check-derives-what-owes-a-screen.md)
