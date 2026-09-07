# 2026-09-07 — A report may not name a period that has not begun

`assertReportingMonth` bounds a reporting month twice: it must be the first of a month, and
it must precede December 9999. Neither bound looks at when the month *is*. So
`GET /api/v1/reports/dcc/monthly?period=2027-06-01` was answered, and answered with a
well-formed report.

**A report whose period has not begun is refused**, as `VALIDATION_FAILED` naming `period`.

## Why a refusal rather than a report of zeroes

**Section 9 already refuses the write, in the words this ruling takes its shape from**: "an
event whose Manila day has not begun takes no attendance record". A period that cannot
contain a record is a period there is nothing to report on, and answering the read while
refusing every write that could populate it is one rule stated twice with opposite answers.

**The zeroes are not empty, which is the part that makes this worth a ruling.** The DCC
calendar runs thirteen months ahead (Section 9), so a future month has `n` greater than
zero and a populated coverage denominator. The report is therefore not blank — it is
complete, well-formed, and says that nobody in the church attended anything. That is the
shape `assertReportingMonth`'s own docblock already refuses for a malformed month: "an
understated report is worse than a refused one because nobody can see it is wrong."

**Section 17 has two period states and there is no third.** A report "must indicate whether
the period shown is open or closed, because an open month's coverage figure is still
changing". A future month would be labelled open, which is true of its submission window
and false of what Section 17 means by it — the figure is not still changing, it has not
started. Section 17's sentence is about a month in progress.

*A fourth argument stood here and is **cut** rather than qualified: that Section 20 would
resolve the tree at an instant no assignment has reached, since decision 0208 makes it the
last millisecond of the period's final day. That is true of the code and takes one side of a
labelled Stop Condition — Section 20 also says an open period "resolves as of now", and this
ruling itself says four lines above that a future month would be labelled open, which under
that reading gives an instant every assignment has reached and the argument evaporates. It is
cut rather than made conditional because a conditional version has to be re-derived the day
that question settles, and the three arguments above do not depend on the answer.
`architecture-guardian` found it as the fourth instance on this branch of that same
assertion, after a sweep that had cleared this one as sound.*

## The boundary is "has not begun", not "is later than this month"

The comparison is against the period's **start**: a period is refused where
`startOfManilaDay(period)` is later than the database's clock. The current month's start is
in the past, so the open month reports; next month's start is in the future, so it does not.

`submission-window.ts` already exports `currentReportingMonth`, so `period > currentMonth`
was available and is exactly equivalent — a period has begun if and only if it is not later
than the current month. The instant comparison is preferred only because it is the rule
written out: "has not begun" is a statement about an instant, and the month form has to be
read back into one. Nothing turns on the choice, and it is recorded so the next reader does
not take the alternative for an oversight.

## Where the clock is read, and why not in the validator

**From the database, not from this process.** `submission-window.ts` fixes this for exactly
this kind of comparison, on decision 0160's terms: "a month boundary is a comparison of the
same kind… That is why the predicates take an executor rather than a `now`. A caller that
could pass its own instant is a caller that will, and the host clock is exactly the wrong
one." A period's beginning is a month boundary, so it is read the way every other one is.

It reads that clock through `databaseNow`, whose own docblock states the convention it
belongs to: "The instant the database is at. Every window decision is made against this."
A period's beginning is one, so it is made against it too.

*`databaseNow` is `clock_timestamp()`, not `now()`. A first version of this ruling claimed
the refusal and the report's `open` flag therefore read one instant, since `monthFigures`
computes `open` as `now() < windowClosesAt(…)` inside its own statement. They do not, and
nothing needs them to — the two compare different boundaries of different months, and the
sentence was a symmetry nobody had asked for.*

**`assertReportingMonth` stays pure**, and the refusal is not added to it. That function is
the guard's predicate through `isReportingMonth`, which runs synchronously in
`resolveReportScope` with no executor in reach; giving it a clock would mean either the host
clock in the guard or an async validator in a synchronous path. It bounds the *shape* and
the two bounds that need no clock, which is what its callers need of it.

**So the refusal is in `reporting`, inside the report's transaction**, and first within it,
so that no tree walk is performed for a period that will be refused.

It sits in `ReportingService.overPeriod`, the private seam that opens that transaction, and
not in the one report method. `architecture-guardian` found it shipped with a single call
site: Section 22 names five report routes, one is built, and nothing would have reddened for
the second omitting this rule — or the shape validation, or the isolation level, which were
three statements at the top of one method.

**The seam alone was not enough, and the second review said so.** A private method leaves
`this.db` in scope for every other method of the class and is unreachable from a second
provider in the same module, so "a report cannot open its own transaction" was a conformance
claim with nothing able to fail — written into the fix for a rule that had shipped with
nothing able to fail. `test/unit/reporting-transaction-seam.spec.ts` now parses the module
and asserts it. It parses rather than greps, because a regular expression cannot distinguish
a call from the same text in a comment, and a check that skips what it cannot read claims a
completeness it never had.

**Its first version checked the wrong property, and the third review caught that too.** It
asserted one transaction opening and one pool reference — which only ever sees a report that
*opens a transaction*. The idiomatic second report opens none: this module composes what the
owning modules compute (decision 0206), so it calls a figures service whose executor is
optional, applies none of the three rules, and left every case green when
`architecture-guardian` ran them against exactly such a method. What binds is therefore a
claim about the module's **public surface** — every public method of every provider routes
through the seam — and the transaction assertions are kept beside it rather than relied on.

It still does not compel a callback to *use* the transaction it is handed, and that is stated
in the seam's docblock rather than left for a reader to discover.

## Authorization is answered first, and that is not incidental

The refusal is in the service, and the capability guard runs before it. So a Leader naming
next month for a leader outside their subtree is answered `SCOPE_DENIED`, not
`VALIDATION_FAILED` — which is Section 7's contents-ordering rule (decision 0193) getting
the right answer for free rather than by a second mechanism. What a request may be told
about its own content is answered after whether the actor may ask it at all.

The guard still resolves scope at a future instant for every such request, including the one
it goes on to admit — and for that one the work is thrown away when the service refuses. That
is accepted: refusing in the guard instead would put a host-clock month comparison in the one
place this ruling has just moved it out of. *A first version said the answer is discarded, in
a paragraph whose example is a request whose guard answer is the response.*

## What this costs

`reporting-dcc-monthly.e2e.spec.ts` reported on `2026-10-01`, written on 2026-09-07 — so
the suite exercised a future period throughout, and decision 0215's first refusal message
said "past period" about a request that was neither. Its fixture months move into the past,
and are renamed for the role they play rather than for a month, so the same drift cannot
recur silently as the calendar advances.

**That is the finding rather than a side effect.** A suite of sixteen cases ran for four
review passes against a period the specification does not define, and nothing could see it,
because no rule existed for anything to fail on.

---

Decision 0216, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A Network grant of a dated capability covers no record](0215-a-network-grant-of-a-dated-capability-covers-no-record.md)
