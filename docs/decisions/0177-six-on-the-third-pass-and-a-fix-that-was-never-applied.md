# 2026-08-31 — Six on the third pass, and a fix that was never applied

The third `architecture-guardian` pass reviewed the response to the second. Four of
its six findings are behavioural or claim-falsifying, and **two of those are fixes the
previous batch reported making and did not make**. Its answers on the three questions
that pass was asked to check — whether `RESOURCE_BUSY` can lose a conflict, whether
the responsible leader is right on every path, whether the capability reorder changed
who may write — all came back clean.

Nothing new was escalated. What follows is the part that changes a rule or a claim.

## 1. A fix reported in the past tense that was never applied

Decision 0176 §1, its commit message, and the function's own docblock all said the
version check had become "one function both callers use". It had one caller. The
in-transaction check in `writeWithin` was still a hand-written second copy.

The edit that would have replaced it was in a script that aborted on a later assertion
before writing anything. The function was added and `conflictAfterLostRace` was moved
to it; the other half silently did not happen, and three separate places then asserted
that it had.

**This is the third false "this was done" claim on this project**, and the second
found by a reviewer counting call sites rather than reading prose. The consolidation
is now performed. Nothing had diverged yet — which is exactly why nothing caught it.

## 2. Returning the instant through this process does not carry it

Decision 0176 §4 fixed a chain that overlapped itself, by returning `superseded_at`
from the `UPDATE` and writing the successor's `recorded_at` from it. Measured against
this project's own database, that leaves the overlap in place:

```text
predecessor ends  (superseded_at): 2026-08-31 21:11:21.883142+08
successor begins  (recorded_at)  : 2026-08-31 21:11:21.883+08
```

`clock_timestamp()` has microsecond precision; node-postgres renders `timestamptz` as
a JavaScript `Date`, which holds milliseconds. So the value was truncated on the way
out and the successor began 142µs before its predecessor ended, in almost every case.
The overlap shrank from the transaction's duration to under a millisecond and was
reported as removed.

**And the case written to enforce it could not fail on it**, for the same reason: both
sides came back through the same driver, truncated to the same millisecond, so the
assertion read `883 >= 883` while the stored rows were 142µs apart.

**The instant now never leaves the database.** The successor's `recorded_at` is a
scalar subquery over the predecessor's row, and the case asserts the comparison **in
SQL**, where the microseconds are. Run against the previous implementation, that
assertion fails.

This is the identical mechanism this branch documented two files over and that
migration 0012 caught in two fixtures — committed in the service in the same change
that fixed it in the fixtures. A host-truncated millisecond against a database
microsecond is now the third defect of that shape on this branch.

## 3. "A correction race cannot produce a `VERSION_CONFLICT`" is false

Decision 0176 §2 argued that `present` is a boolean, so a loser that disagrees with
the pre-race value must agree with what the winner wrote.

That bounds the number of **values**. It does not bound the number of **commits**.
`conflictAfterLostRace` re-reads after the rollback, on the pool, holding no lock, at
an unbounded later moment — so an even number of further writes returns the stored
value to the one the loser disagrees with, and the conflict is ordinary. Two writes by
one account are enough.

**A lost race therefore has two outcomes and they are decided by what the loser finds,
not by what the winner wrote.** Section 22 now states them over the race itself rather
than inside the list of two null-version cases, because the rule governs a correction
race too, and a correction carries a version.

*This said "three" when it was written, counting the handler's narrowing on the index
name as an outcome of the race. It is a guard against an error that is not a lost race
at all. Corrected by the fourth pass, and noted here rather than silently, because §22
states counts precisely so they can be checked.*

## 4. The test deleted on that argument had not been passing for the wrong reason

Decision 0176 §2 also said the deleted case "submitted the pre-race value, which is
unchanged, so the line wrote nothing, never took the lock, and never raced". It
submitted the **post**-race value. It was a correction, it took the predecessor's row
lock, it asserted a waiter, and it raced.

What had changed was its *answer*: 409 became 503 when an unchanged line stopped
taking part in the version check. Re-pinning it at 503 was the fix. Deleting it removed
the only coverage of the zero-row supersede — the branch the same batch had just
rewritten — and left both surviving race cases exercising creates.

The case is restored at 503, and the conflict §3 above says is reachable is added
beside it. Both force their interleaving with a held transaction rather than hoping
for one.

*The general lesson, since this is the second time on this branch that a red test was
answered by deleting it: a case that changes its answer after a rule changes is
evidence the rule reached it, which is what a case is for. The bar for deleting one
should be higher than the bar for writing it, and here it was lower.*

## 5. A retry that did not test what placed it there

The `RESOURCE_BUSY` case asserted that the advised retry succeeds — with a fresh
idempotency key and a changed body. Decision 0158's question is whether **this same
body, resubmitted unchanged**, could succeed, and the refusal says "retry with the
same key". Neither was exercised. Both are now.

The underlying behaviour was correct: `RESOURCE_BUSY` is a 5xx, the interceptor
releases the claim rather than storing it, and a same-key retry re-executes.

## What this pass confirmed

Worth recording because three passes have now looked and these have held: the
`RESOURCE_BUSY` path cannot lose one person's conflict behind another's unchanged
line; `responsibleLeaderId` is correct on a create, a correction and an unchanged
line; the capability reorder changed only which refusal is seen and never who may
write; the `violatedConstraint` narrowing is sound, since nothing else this path
writes carries a unique index; and migration 0012 really did catch two fixtures —
reproduced at 26 violations in 30 runs.

---

Decision 0177, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Eight on the fix batch, and the outcome that was a 500](0176-eight-on-the-fix-batch-and-the-outcome-that-was-a-500.md) | Next: [2026-08-31 — The fourth pass found nothing behavioural, and one thing with teeth](0178-the-fourth-pass-found-nothing-behavioural-and-one-thing-with-teeth.md)
