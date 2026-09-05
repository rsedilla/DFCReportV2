# 2026-09-05 — A report is computed in one read-only transaction at `REPEATABLE READ`

Section 20 asserts its two reconciliation identities as properties of *the report* and calls a
failure a data-integrity defect. Neither Section 20 nor Section 24 says at what isolation a live
report is computed, so "both views cover the same population" was not derivable from anything
written down. This settles it before the first report that composes more than one read.

Recorded as a Stop Condition on 2026-09-05, raised by `architecture-guardian` on the first
reporting slice — which had taken two figures with `Promise.all` on a pooled connection while two
docblocks claimed the identity held "by construction".

## Why the existing answer cannot survive leader scope

The DCC slice closed its own instance by taking **every figure in one statement**, which holds at
any isolation level, and pinned the shape rather than the outcome:
`reporting-reconciliation.spec.ts` asserts that one owning module's read issues exactly one query.

That property is not extendable **to a report**, and the distinction matters because the test is
narrower than it reads. It counts the queries `DccFiguresService.monthFigures` issues — one owning
module's read — not the composition. Section 2 and decision 0206 require each owning module to
compute: `hierarchy` walks the placement graph, `attendance` aggregates DCC and Cell attendance,
`cells` derives the Cell coverage denominator, `people` supplies identity and lifecycle.
`attendance` may not root a query in `pastoral_assignments`, so a *report* at leader scope is two
statements by construction and coverage makes it three, while each module's own read stays one.

So the choice is not between one statement and two. It is between a stated snapshot and an identity
that holds only on a quiescent database — which is exactly the condition under which the first
defect shipped and every test still passed.

## The ruling

**A report is computed inside one transaction, opened `READ ONLY` and at `REPEATABLE READ`.**
`reporting` opens it and passes that executor to every module it composes; no part of a report is
read outside it.

**`REPEATABLE READ` rather than a transaction alone.** Under `READ COMMITTED` each statement takes a
fresh snapshot *even inside one transaction* (Section 24), so a transaction by itself buys nothing
here. The snapshot is the whole point: it is what makes "both views cover the same population" a
fact about the read rather than a hope about timing.

**`READ ONLY` because a report writes nothing**, so the database can refuse a write that should not
be there, and because it is what lets a future reader see that this transaction is not a write path
that happens to read.

## This is a per-transaction override, and never a change to the default

**`default_transaction_isolation` stays `READ COMMITTED`.** This is stated as loudly as the ruling
itself, because "use `REPEATABLE READ` for reports" read as a global change would silently remove
three authorization guarantees Section 24 names in terms:

- Section 5's person lock, which locks and *then* decides scope, invariant 4, invariant 1 and the
  backdate floor;
- Section 7's grant-limit constraint triggers, which take `FOR NO KEY UPDATE` and then read the
  other table;
- Section 6's first-Admin bootstrap, which takes an advisory lock and then reads whether any account
  exists.

All three are lock-then-decide. Under `REPEATABLE READ` the snapshot is taken by the transaction's
*first* statement, which runs before the lock is held, so each would serialize correctly and then
decide on the state the request arrived with. Section 24 records that two of the three raise nothing
to warn anybody.

None of that is touched here. A reporting transaction takes **no row or advisory lock** — the kind
all three of those use, and the narrower claim is the one that carries this argument, for the reason
given under the costs below — writes nothing, and authorizes nothing; it reads. The two isolation
levels coexist because the level is a property of a transaction and only the *default* is global.

**The second clause is a fact about the system as it stands, not a property of reporting.** No
reporting route exists, so nothing authorizes inside one of these transactions. A change measuring
an actor's reach against the same snapshot a report is computed from would falsify it, and that
question is open rather than answered here — Section 24 carries the same caveat, and this ruling
should not be read as asserting more than it does.

*This ruling's first draft recommended pinning `REPEATABLE READ` more broadly, on the ground that
one-statement was unsustainable. Section 24 refutes that in terms, three times over. The
recommendation survived only because it was written as a ruling and checked against the
specification before it was written as code.*

## What it costs, named rather than discovered

**A reporting read holds one connection from the bounded pool for its whole duration** (Section 24),
and a whole-church monthly aggregate is the longest read this system performs. A bound on concurrent
report computation is the thing to reach for if the pool is ever pressed, rather than shortening the
snapshot.

**It takes no row or advisory lock, which is the claim the compatibility argument above needs — and
it is not lock-free.** A first version of this ruling said "it takes no locks", which
`architecture-guardian` refuted by running it: a `READ ONLY REPEATABLE READ` transaction holds an
`AccessShareLock` on every relation it reads, for its whole duration. That conflicts with none of
Section 24's three mechanisms, which take row and advisory locks, so the conclusion stands and only
the reason changes. Two costs follow from it that the paragraph above missed:

- **A long report blocks DDL**, and a migration's `ACCESS EXCLUSIVE` request then queues ahead of
  every later reader of that table. So a report *can* wait unboundedly after all, on a lock it did
  not ask for — which is Section 24's liveness hazard, reached from the other side. Migrations and
  long reports should not be run against each other.
- **A `REPEATABLE READ` snapshot held for the longest read in the system pins dead tuples against
  vacuum** for its duration. Harmless at this scale (Section 2) and named because it is the cost
  that grows with the data rather than with the request.

**A closed month's stored figure removes most of this cost** (Section 20), because only the open
month is computed live.

## What replaces the one-statement test

`reporting-reconciliation.spec.ts` asserts that one owning module's read is a single statement, and
that assertion stays exactly as it is. The composition has no such test at all, and it is
specified **here rather than left to the slice that needs it**, because a test written alongside the
code it blesses tends to bless what the code does.

**That per-module assertion is not what changes.** A first version of this ruling said the existing
test "becomes false the moment leader scope lands", which does not follow: leader scope adds reads
in `hierarchy`, and nothing in it makes the whole-church DCC figures read issue two statements. The
one-statement property of each module's own read is worth keeping and stays pinned. What is missing
is an assertion at the level the identity is actually claimed at — the report — and that is what is
added:

- every read of a report is issued on the transaction's executor, not on the pool;
- that transaction is observably `REPEATABLE READ` and `READ ONLY`, read back from the database
  rather than asserted from the code that set it;
- the identity still holds across a concurrent write committed between two of the report's reads —
  which is the case one statement made unreachable and a transaction has to earn.

## Alternatives refused

- **Keep one statement.** Impossible once two modules compute, and reachable only by breaking
  Section 2's ownership rule — which is the rule decision 0206 declined to widen for exactly this
  module.
- **Read a `source_version` before and after and retry on a change.** Optimistic concurrency in
  place of a snapshot: it turns a wrong answer into a retry loop, needs the counter Section 20
  defines for *stored* figures to be maintained for live ones too, and still answers from two
  snapshots in between.
- **Accept it and state the identity as approximate.** Section 20 calls a reconciliation failure a
  data-integrity defect rather than a rounding issue. An identity that holds when nobody is writing
  is the one that already shipped.

---

Decision 0210, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report walks up past a leader who left the period, and the gap is surfaced rather than hidden](0209-a-report-walks-up-past-a-leader-who-left-the-period.md)
