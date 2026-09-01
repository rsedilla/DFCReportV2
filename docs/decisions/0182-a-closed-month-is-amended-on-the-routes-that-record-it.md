# 2026-09-01 — A closed month is amended on the routes that record it, and §20 already said who invalidates

§§9, 13 and 20 all require it: after a month closes, **only Admin may amend it**, using
`records.backdate_effective_date` (§7), with a reason, audit logged (§21), and
invalidating that month's stored figures (§20). No route does. `refusalFor` answers
`PERIOD_CLOSED` to every actor including Admin, and `records.backdate_effective_date` is
used today only by pastoral reassignment, sex correction and Cell closure.

`docs/ROADMAP.md` puts "the monthly submission window **and its close**" in Stage 4, so
this is owed now rather than with reporting. Two things were unsettled.

## Is it a third endpoint, or a flag on the two that exist?

**A flag on the two submit routes.** `POST /dcc/events/{id}/submit` and
`POST /cells/{id}/meetings/{meeting_id}/submit` each take an optional amendment object
carrying the reason; absent, the route behaves exactly as it does today.

A third endpoint would duplicate the whole contract of the route it shadows — the
roster, the per-line rules of §9, the version check, the all-or-nothing rule, the
idempotency obligations of §22 — for one changed precondition. Everything an amendment
does is what a submission does; the only difference is *when* it is allowed and *who*
may do it. Two routes that must stay behaviourally identical forever, differing in one
guard, is the shape §22 warns about when it says one concept carries one name across
every endpoint.

It also keeps the closed-month path on the code that already discharges §22's four
idempotency obligations, rather than requiring a second, less-exercised copy of them.

**What changes when the flag is present**, and nothing else does:

- The window check is skipped, and **only then**. `isMonthOpen` still decides; the flag
  changes what its `false` means for this actor.
- `records.backdate_effective_date` is required **in addition to** the capability the
  route already demands. It does not replace it: an Admin amending a Cell meeting still
  needs `cell.take_attendance` resolved against that Cell, so the amendment is a
  widening of *when*, never of *what* or *whose*.
- A reason is required. §5 requires one for every backdated effective date, and this is
  one.
- An audit entry is written naming the reason, the reporting month, and the records
  changed (§21).

**Absent the flag, a closed month refuses as it does today** — including for an Admin.
An amendment is a deliberate act, so it is never a side effect of a retry that happened
to arrive late, and an Admin who submits normally after the 7th is told the month is
shut rather than silently rewriting a closed period.

## What "invalidating that month's stored figures" obliges this route to do

**Nothing, and §20 says so already.** This was recorded in `CLAUDE.md` as the half that
could not be settled until Stage 5 created figures to invalidate, on the reading that an
amendment built now "would satisfy the clause vacuously and the clause would need
re-reading when snapshots exist". That reading missed §20's own instruction, four lines
below the clause it was reading:

> Prefer not to enumerate these in code at all. Key each stored figure to a version of
> the source records it derives from, and treat any change to those records as
> invalidating.

So §20 does not ask the amendment to invalidate anything. It asks the **snapshot** to
know what it derives from. The list §20 gives — an Admin amendment, a Person Merge, a
backdated effective date — is offered as examples of changes that must invalidate, and
then immediately disclaimed as a list to implement.

That resolves the question rather than deferring it, and in the direction that costs
least: an amendment built now satisfies the clause **permanently**, not vacuously,
because there is nothing for it to do and there never will be. The obligation transfers
to Stage 5, where §20 already put it, and is recorded here as a Stage 5 debt:
`report_snapshots` must key each row to a version of its source records rather than to a
list of events that dirty it. A snapshot that enumerated its invalidators would have to
be found and edited every time a new write path touched attendance — which is the
maintenance failure §20's sentence exists to prevent.

*The bullet in `CLAUDE.md` said the clause "would need re-reading when snapshots exist".
It needed reading once, four lines further down, and this is the second time on this
project that a clause was called undefined while its own section defined it — the audit
log's "period being viewed" was the first.*

## What this does not settle

Whether an Admin amendment may create a record for a person who had none in that month,
as against correcting one that exists. Both are amendments of the month; §13's coverage
figure is frozen at close, so a created record raises a closed month's numerator without
its denominator moving. Not blocking: it is a question about a figure, the figures are
Stage 5, and the reconciliation test §20 requires is what would show it. Recorded in
`CLAUDE.md`.

---

Decision 0182, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-01 — A port is optional and refuses, and the graph test asserts it is bound](0181-a-port-is-optional-and-refuses-and-the-graph-test-asserts-it.md) | Next: [2026-09-01 — A record closed with nothing replacing it names itself](0183-a-record-closed-with-nothing-replacing-it-names-itself.md)
