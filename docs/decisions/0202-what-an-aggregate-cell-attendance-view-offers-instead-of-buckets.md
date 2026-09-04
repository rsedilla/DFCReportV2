# 2026-09-04 — What an aggregate Cell attendance view offers instead of buckets: nothing further

This is the item that has blocked Stage 5 since Stage 0, and the last Stop Condition standing
in front of the reporting work.

## What was already settled, and what was not

Section 12 already ruled that **bucket views exist at Cell scope only**, and already gave the
reason: `N` belongs to a Cell, two Cells in one month can hold `N = 5` and `N = 2`, and
placing both in one column makes aggregate `Completed` mean "attended everything their own
Cell happened to record". A leader recording one meeting a month would contribute the most
`Completed` people in the Network.

So the open question was never whether to aggregate the buckets. It was the sentence after:
what an aggregate view should offer **in place of** them, beyond unique people and coverage —
which Section 12 called "genuinely undefined".

*A draft of this ruling was framed as deciding the first question. It was not open, and saying
so is worth more than the ruling reading tidier: what follows decides a narrower thing.*

## The ruling

**Nothing further. Unique people, classification and coverage are the whole of it**, and
coverage is the figure to lead with.

## Why nothing, rather than something normalised

The obvious repair is to normalise before aggregating: bucket each person against their *own*
Cell's `N`, then combine. It is a real fix for the arithmetic — the cross-Cell inflation
disappears, because nobody is compared against a denominator that was not theirs.

**It leaves the incentive exactly where it was.** A person at one of one is still `Completed`
and a person at three of four is still short, so a Cell that records one meeting still
produces more `Completed` people per member than a Cell that records four. The denominator is
self-reported, and every figure expressed as a share of it inherits that, however it is
grouped.

Section 12's own closing constraint is the test, and it is stated about the incentive rather
than about the arithmetic: *no bucket rewards a Cell for recording fewer meetings*. The
normalised version fails it. So does every other candidate built on `N`, which is why the
answer is that there is no replacement rather than that we have not found one yet.

## Why coverage is the headline

Coverage is `recorded out of scheduled`, and **its denominator is derived from the Cell's
configured schedule against the calendar** (Section 10) rather than from anything a leader
submitted. Recording less makes coverage worse, never better.

It is the one figure on the screen that cannot be improved by doing less of the work it
measures, which is exactly the property the buckets lack. Section 12 already asks it to be
shown beside the buckets at Cell scope, "factually and without judgement", so leading with it
above Cell scope is the same figure doing the same job with nothing beside it to be confused
for.

Classification aggregates because it carries no denominator — Section 12 says so — and unique
people is a count. **The three that aggregate are precisely the three with no self-reported
denominator between them**, which is what makes the list closed rather than merely short.

## What a pastor does with it

The gap this leaves is real: a Network-scope reader sees how much was recorded and by whom,
and no per-person shape. What they actually need there is not a metric but a list of who to
help, and that idiom already exists — an attention list, filtered and never ranked, of the
Cells whose coverage is low. Section 13 names the same shape for meetings awaiting a record
and Section 15 permits it.

That is deliberately a list of Cells rather than of leaders, and it is not a score. Section
13's ranking prohibition is the reason: `NOT_HELD` exists to obtain honest reporting from
Cells that are not meeting, and any surface that makes declaring it costly destroys the
signal it was created to capture.

## What this does not settle

The two fairness questions beside it in Section 12 — whether a leader should see someone who
attended and has since left, and whether a mid-month joiner measured against the whole month
is acceptable — keep their defined behaviour and stay open as questions about whether that
behaviour is right. Both are Cell-scope questions and neither is reached by this ruling.

---

Decision 0202, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — The amendment gate binds a lost race, and it binds both domains](0201-the-amendment-gate-binds-a-lost-race-in-both-domains.md)
