# 2026-09-06 — A report's guard walks the as-of tree, outside the report's snapshot

The first reporting route needs an authorization walk that does not exist. Four bullets in
`CLAUDE.md` have been waiting for it, and they are three questions: whether the walk runs
inside the report's own snapshot, which graph it walks, and the dated upward walk itself.

**One ruling, because one change owes all three and they meet at one seam.** That is the
opposite of the mistake decision 0211 made and is worth stating as such: 0211 was withdrawn
because it was drafted **early and separately**, which coupled it to 0210 at a seam neither
ruling owned. These three are owed by a single route, they are being settled with that
route's code in hand rather than predicted, and answering any one of them alone leaves the
other two undecidable.

## The route this is about

`GET /api/v1/reports/dcc/monthly`, guarded by `reports.view_subtree`, taking the scope
selector `ReportScope` already in the service — `WHOLE_CHURCH` or `LEADER`. Section 7 makes
a report scope selector **itself the target**, and decision 0207 gives it an instant: it
resolves as of the period being reported.

## The walk runs outside the report's snapshot

**Outside**, in its own read, on the pooled connection — which is where every guard in this
application already runs.

This is the answer that changes nothing rather than the answer that is merely safer, and
that is the argument for it. `AuthorizationService.covers` **deliberately takes no
executor** — a signature accepting one "would invite exactly the call this method exists to
make possible, and would silently fail to deliver it" — and the docblock on it states the
seam this question is asking about:

> The split is along the right seam rather than a convenient one. An account's grants are a
> fact about the account and cannot change under a tree write, so reading them before the
> transaction costs nothing in correctness; *scope* is a fact about the tree, and that is
> the half that has to see the transaction.

**And `coversWith` exists for liveness, not for snapshot consistency**, which is worth
checking rather than assuming — its own docblock says it "exists so that a caller inside a
transaction touches the pool exactly never", because a pooled read taken while holding a
transaction asks a bounded pool for a second connection, which Section 24 names as a
liveness hazard. Its callers are the two attendance write paths, and both take it for that
reason. So **no caller in this application re-decides authorization inside a transaction in
order to see a consistent snapshot**; they do it to avoid a second connection. A report that
authorizes before it opens its transaction has neither problem.

`ReportingService.dccMonthly` opens its `READ ONLY` `REPEATABLE READ` transaction *inside
itself*, after the guard has already decided. So "outside" is the architecture as it stands,
and "inside" would be a deliberate restructure undertaken to obtain a property nothing has
asked for.

**Section 24's third clause is preserved rather than spent.** Section 24 rests the
isolation exception on three clauses — no row or advisory lock, writes nothing, decides no
authorization — and says the third is "a fact about the system as it stands rather than a
property of reporting", adding that "a change that measures an actor's reach against the
same snapshot a report is computed from would falsify it". This ruling is the change that
arrives at that sentence, and it declines to falsify it. Section 24 needs no amendment
beyond deleting its own "no reporting route exists" observation, which this slice makes
untrue.

**Inside would be Section 24's own hazard with the lock removed.** All three mechanisms
Section 24 protects are *lock, then decide*, and the failure it names three times is
deciding on a pre-lock snapshot. Authorizing from a tree fixed before the decision is that
shape exactly, minus the lock that would at least have serialized it.

**What outside costs, and why the cost is bounded rather than argued away.** The guard and
the figures then read at two instants. For a **closed** month that difference cannot matter:
both resolve as of the period's end, which is fixed history, so both read the same rows
whenever each of them reads — the one exception being a concurrent backdate, which Section
20's invalidation list already names as invalidating every period the date reaches into. For
an **open** period, "as of the period's end" is now (decision 0205), so a reassignment
committing between the guard and the snapshot gives two answers. That does not widen what
the actor may see: the guard's question is whether the **selector** is within reach, and a
subtree scope covers whoever is beneath that selector at the instant the figure is computed.
A person moving under `L` after the guard ran is a person the actor was already authorized
to see by virtue of being authorized over `L`.

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
"so the fix does not hide the gap". A visibility grant measured on that same graph would
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

**What the division costs.** A leader-scoped aggregate is computed over the placement graph,
so it can contain people the actor could not reach one at a time. That is accepted **on this
route and on this route only**, because this route discloses no identity: `DccMonthlyReport`
carries the scope, the period, whether the month is open, `n`, the removed events, a count of
unique people, the classification and the buckets — and no person identifier anywhere.
Section 20's
identities still hold, because the population the figures are computed over is unchanged —
what this ruling fixes is who may ask for them.

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

**The instant is `endOfManilaDay` of the period's final day**, which decision 0208 already
fixes for every reporting tree walk. The guard does not derive a second answer to that
question.

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
