# 2026-09-07 — A report resolves at the period's final millisecond, open or closed

Section 20 states two instants for an open period, three lines apart:

> An open period therefore resolves as of now, and Section 17 already requires a report to
> say that the period is open.

> **The instant is the last millisecond of the period's final day** (ruling of 2026-09-05)

For a closed month those agree. For an open one they do not: the final millisecond of the
current month has not arrived. `reportingPeriodBounds` implements the second, and Section 7
repeated only the first.

**A report resolves the pastoral tree at the last millisecond of its period's final day,
whether the period is open or closed.** Section 20's "an open period therefore resolves as
of now" is deleted.

## Where the second instant came from, which is the whole of the answer

Section 20 did not invent "as of now". It quotes Section 16, which defines
`Cell Leaders with 12+ Members` "**as of the end of the period being reported** — which for
the current period means now", and gives its reason in the next sentence: "Section 3 already
classes this as a current-state metric reflecting state as of the period reported".

**That gloss is a property of a current-state metric, not of an instant.** A current-state
figure asked about a period still running can only mean now, because current state has no
future; there is nothing at the end of an unfinished month to report. Section 16's
participation window is itself rolling and ends at the report's date, so for that metric the
period's end genuinely *is* now.

**Section 20 carried the instant across Section 3's line on purpose, and carried the gloss
across by accident.** Decision 0205 says so in terms, in the aside that is still in Section
20: *"Section 16 grounds its instant on that metric being a current-state one, and Section 3
puts current-state metrics on one side of a line and period-based classification and monthly
attendance on the other. Carrying the instant across that line is what this ruling does,
rather than something Section 16 already said."* The instant survives the crossing. The
gloss does not, because a calendar month's end is a fixed instant whether or not it has
arrived, and classification and monthly attendance are period-based on Section 3's own terms.

So this is not a choice between two rules. It is one rule with a clause attached that
belonged to the metric it was borrowed from.

## Why not "as of now"

It is the more conservative-sounding answer and it costs more than it looks.

**It would divide one instant in two.** Decision 0214 requires a report's guard and its
figures to resolve at **the same** instant, and makes that a property of sharing one
derivation rather than of two agreeing. `min(period end, now)` has to be applied in the
guard and in `reportingSubtree` together, and the day one of them is changed alone the
divergence is silent and decides who may read a report.

**It introduces a period whose end is not its end**, which is a second concept for every
later reader of `reportingPeriodBounds`, in a helper Section 13 and Section 20 already share.

**The case it protects against is a write-side defect.** The two readings differ only where
a `pastoral_assignments` row carries a future `started_at`. No writer produces one — the
reassignment and sex-correction paths refuse a future effective date, and every other writer
stamps `new Date()`. If one ever appeared, resolving reports "as of now" would hide it while
every other dated read in the system still saw it. Refusing the write is the fix; bending
the reporting instant is not.

*That third answer — state that no effective-dated row may carry a future `started_at`, and
enforce it — was offered and declined for now. It is a larger change touching six write
paths, and it settles this question by removing the case rather than by answering it. It
stays available and nothing here forecloses it.*

## What this changes

Nothing executable. `reportingPeriodBounds(period).end` is already what the guard and the
figures both use, so this ratifies the code and removes the sentence that disagreed with it.
Section 7's repetition of "as of now" goes with it, and two docblocks that named the question
as open now name it as settled.

**That is the point rather than a disappointment.** The contradiction was internal to the
specification, so `SKILL.md` winning could not resolve it, and a builder implementing Section
7 literally would have written `new Date()` and diverged from `reportingSubtree` with nothing
to say so.

## Why it was worth a ruling rather than an edit

The claim was asserted four times on one branch — in Section 7, in decision 0217, in decision
0216's fourth supporting argument, and in a `hierarchy` docblock that pointed at a question
decision 0208 had already closed. Three were caught by `architecture-guardian` and one by
re-reading; a sweep reported as clean had missed one of them. A sentence that keeps being
written by people who are not deciding anything is a sentence whose question is overdue.

---

Decision 0218, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A Network grant resolves at the instant its target carries](0217-a-network-grant-resolves-at-the-instant-its-target-carries.md)
