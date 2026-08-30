# 2026-08-29 — A second schedule change corrects the pending one


Stage 3's configuration slice refused a second schedule change made before the first
took effect, and the reason it gave was wrong. It claimed the Cell's current schedule
would vanish. Traced properly it does not: both changes resolve to the same instant, so
the second closes the **pending** row at its own `started_at` — the zero-length row
Section 5 makes inert — and the row actually governing today is untouched.

What it is instead is exactly the correction Section 5 prescribes, "a row entered in
error is corrected by closing it and opening the right one", and the reason
`cell_schedules_period_ordered` is `>=`. The 2026-08-22 ruling settled that shape for
effective-dated tables generally; migration 0009 created this constraint on 2026-08-28
already carrying it, so nothing was relaxed here — an earlier version of this sentence
said it was.

**The refusal stranded the leader it was meant to protect.** Queue the wrong day on 5
August and it cannot be fixed until 1 September; a change made then lands on 1 October.
One mistake costs a whole month meeting on a day nobody agreed to, with Section 12
computing that month's coverage against it, and nobody can shorten it — Admin included
— because a forward-dated correction is not an operation this specification defines.
The refusal's own message told the leader to "correct it", and no correction path
existed.

Equality was the only case the check could ever have caught. `effectiveFrom` is always
the next Manila month boundary and an open row's `started_at` is either in the past or
that same boundary, so there was no third case it was protecting.

**The cost is accepted in writing rather than discovered.** A leader who queues Sunday
and then reverts to Saturday leaves three rows — Saturday, an inert Sunday, Saturday —
so the history carries a boundary across which the schedule did not change. Every as-of
query still answers correctly at every instant; what reads oddly is "how long has this
Cell met on Saturday".

**Section 5 permits no other shape, which is what makes the cost forced rather than
chosen.** Withdrawing the pending change means reopening the row it closed, which is the
in-place rewrite Principle 12 forbids. Closing it without a replacement leaves an
`ACTIVE` Cell with no open schedule row, which `cell_schedules_keep_cell_configured`
refuses — not `cells_are_configured`, which fires on writes to `cells`. Both call the
same function, so the argument held and the mechanism named was wrong. Comparing
the no-op refusal against the row *in force* rather than the open one refuses the revert
altogether, which is the stranding this ruling exists to end.

It follows — and Section 10 now says — that the no-op refusal is a check against the row
currently open, which after a first change is the pending one. It is not a guarantee
that the history holds no boundary without a change across it, and an earlier comment
claimed it was.

**Recorded because it was very nearly not.** The reversal shipped in code with its
reasoning in a comment, and the test asserting it said "Ruled on 2026-08-29" when no
ruling existed. `architecture-guardian` raised it as a Stop Condition and was right to:
this log's preamble says a decision that lives only in a chat session does not exist, and
this file already counts at least six false "written to section x" claims, each found by
grepping for the rule rather than reading the sentence asserting it was there. This would
have been the seventh, made knowingly.

---

Decision 0138, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Six rulings the closure endpoint needed, and two the review raised](0137-six-rulings-the-closure-endpoint-needed-and-two-the-review.md) | Next: [2026-08-29 — The closure ordering and the closure floor, settled by running the database](0139-the-closure-ordering-and-the-closure-floor-settled-by.md)
