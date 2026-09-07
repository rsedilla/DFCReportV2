# 2026-09-07 — A Network's reporting population is its membership, not its root's subtree

`report_snapshots.scope_type` enumerates `NETWORK` (Section 20) and Section 17 puts a Network
between Whole Church and a leader in the drill-down. `ReportScope` carries `WHOLE_CHURCH` and
`LEADER`; this adds the third, and there are two things it could mean.

- **The root's placement subtree** — a Network is whatever the walk from its root reaches,
  reusing the machinery a leader-scoped report already has.
- **The Network's membership** — a person is in the Network their `network_assignments` row
  names, resolved as of the period.

**A Network's population is its membership**, read from `network_assignments` as of the
instant the period resolves at (decision 0218, the period's final millisecond).

## Section 4 decides it in one sentence

> Network is assigned automatically from sex, according to the homogeneous-network rule…
> **Store the resulting relationship explicitly rather than deriving it on every query.**

The subtree reading *is* deriving it on every query, out of the pastoral tree rather than out
of the column Section 4 requires be stored. That the two usually agree is not a reason to
derive one from the other; Section 4 says so about a `network` column on the Person and the
same argument reaches a walk of the tree.

Section 4 also effective-dates the relationship, and gives its reason in terms: "A `network`
column on the Person cannot answer which Network someone belonged to during a past month, and
every Network-scoped report for a closed period depends on that answer." That sentence is
about this report. The dated read it asks for is `network_as_of`, which already exists and
which decision 0217 just adopted for the same instant on the authorization side — so both
axes of a Network-scoped request now resolve the same way, which was the argument that
settled 0217.

## Why the subtree reading is wrong rather than merely different

**A subtree is never a Network, and Section 20 already says so.** Its residual: "Where a
person held no open assignment at **any** instant of the period, and none before it either,
they appear in the Whole Church total alone." Such a person holds a `network_assignments` row
— every encoded Person does, from their encoding date — so they are in a Network and in no
leader's subtree.

Under the subtree reading they would be in **neither** Network while sitting in the Whole
Church total, so Men's + Women's would not equal Whole Church. Section 17's drill-down runs
Whole Church → Network → Leader, and that is the level at which it would stop adding up.

**Section 20 tolerates a residual between a Network and a leader, and this ruling leaves it
exactly there.** It says a drill-down "adds up to the level above except for the residual",
and that exception is about people no leader discipled. Under the membership reading the
residual appears once, between Network and Leader, where Section 20 puts it. Under the
subtree reading it would appear twice — once above the Networks and again below them — and
the second occurrence is invented rather than stated.

## What this does not change

**It adds no attribution key.** Section 20 names three — the person, the meeting's
responsible leader, and the obligation for coverage. A Network scope narrows *which people*
the person key runs over; it does not attribute a figure differently. The DCC figures service
already takes a population and asks nothing about how it was chosen.

**The owning module computes it.** `networks` owns `network_assignments` (Section 2, decision
0206), so it answers who is in a Network at an instant, and `reporting` composes. This is the
same seam `hierarchy` already fills for a leader-scoped population.

**It moves no write and no other read.** Nothing outside reporting asks this question, and a
person's Network is unchanged by it.

## Which grants cover a `NETWORK` selector

Section 7 makes the scope selector the target, so this follows from the population rather
than being decided separately: a **Whole Church** grant covers it, a **`NETWORK`** grant
covers the Network it names, and **no subtree grant covers one at all**.

The last is the same fact as above, read from the authorization side. A subtree is not a
Network — Section 20's residual is the proof — so a holder of `OWN_SUBTREE` or
`SUBTREE_EXCL_SELF` never holds a whole Network, including at a Network root, whose subtree
still excludes the residual. Nobody is affected in practice: both Senior Pastors hold Whole
Church (Section 4), which is what makes the two Network selectors Section 17 offers them
work.

## What was rejected, and what it would have cost

Reusing `reportingSubtree` from a Network root is the cheaper implementation and the reason
to want it. It would have produced two Network totals that do not sum to the Whole Church
total beside them, on a screen Section 17 designs as a drill-down — the failure decision 0206
exists to prevent, arriving one level higher than that ruling addressed.

---

Decision 0219, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-07 — A report resolves at the period's final millisecond, open or closed](0218-a-report-resolves-at-the-periods-final-millisecond-open-or-closed.md)
