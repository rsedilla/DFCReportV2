# 2026-09-05 — A placement graph that is not functional refuses the figures it corrupts

`reportingSubtree`'s whole-graph cycle check rests on a premise nothing enforces: that the placement
graph is **functional**, one out-edge per person. Two `pastoral_assignments` rows in force at one
instant break it. This settles what the report does when the premise fails.

It does **not** settle whether non-overlap is a rule of Section 5 or an accident of the backdate
floor. That is a separate Stop Condition, it stays open, and its remedy is at the write.

## What the premise buys, and the two ways it fails

`grounded` is reachability from a terminal: a person is grounded where **any** of their out-edges
leads to a root or to somebody holding no edge. `has_cycle` is then "some person holding an edge has
no terminating chain". Where the graph is functional that is exactly "is in or beneath a cycle",
which is what makes whole-graph detection sound — and whole-graph detection is required, because a
cycle in a functional graph is a *closed component* no walk from above can enter.

Both failures were reproduced against the database and are pinned in `reporting-subtree.spec.ts` as
the behaviour the method currently has:

- **A cycle grounded by a second edge is invisible.** A cycle member holding another, grounded edge
  grounds itself and so grounds the whole cycle, and `has_cycle` is false. A leader beside the cycle
  is then answered cleanly over a graph that holds one.
- **A person reached by two distinct paths is returned twice.** Neither flag fires: every chain
  reaches a root, and PostgreSQL's `CYCLE` clause marks a key repeated on a row's **own path**, not
  a person visited twice. Principle 10 makes a total of people distinct, so a caller counting that
  list counts them twice.

*The commit that added the walk's `CYCLE` flag justified it by the second case. It closes the
narrower one where the second edge points inside the first's subtree, and not this.*

## The ruling: detection is over the whole edge set, exactly as it is for a cycle

**Where any person holds more than one edge in the placement graph, every figure computed from it
refuses**, on the terms Section 20 already gives a detected cycle: a data-integrity defect, reported
rather than retried. Detection is a property of the edge set, not of a walk.

**This ruling's first draft scoped the refusal to the walk whose own result held a duplicate**, on
the argument that a duplicate corrupts only a total that contains it, so refusing more would punish
a leader for another branch's state — decision 0209's own ground, borrowed. `architecture-guardian`
falsified it by running the query, and it is recorded here because the conclusion was wrong rather
than merely the support:

- **A duplicate's damage is not confined to one walk.** `P` holds two in-force rows, under sibling
  leaders `L1` and `L2`. Each sibling's walk contains `P` exactly once and neither refuses; the root
  contains `P` twice. So the scoped rule publishes two totals that look correct and cannot both be,
  and Principle 11 — "never count duplicate people twice when aggregating multiple Cells or
  branches" — is broken across precisely the aggregation Section 20's drill-down performs. A
  `DISTINCT ON` tiebreak, which this ruling refuses below, would at least have kept `P` in one
  subtree; the scoped refusal did not.
- **The sentence offered as proof was false in the regime it governs.** It said any walk reaching a
  person beneath a cycle must pass through the cycle to get there. That is true of a *functional*
  graph, and the whole subject of this ruling is the graph that is not one: with `X` under both `B`
  inside a cycle and `M` outside it, the walk from `M` returns `X` and touches nothing.

**So the two refusals are the same refusal, and there is one rule rather than two.** A cycle is a
closed component invisible from above; a duplicate is a corruption visible from above and invisible
from below. Neither is contained by the walk that meets it, and whole-graph detection is what both
require.

**It also closes both failures enumerated above rather than one**, which the scoped version did not.
A cycle grounded by a second edge is grounded *by an overlap*, so a rule that refuses on any overlap
refuses that case too, and `has_cycle`'s blind spot stops being reachable without a second
mechanism.

**The blast radius is accepted, and it is the one Section 20 already has.** A cycle anywhere refuses
every figure for the period; an overlap now does the same. Whether that radius is right is an open
question in `CLAUDE.md` for the cycle, and this ruling deliberately puts the overlap under the same
question rather than inventing a second answer for it — a narrower answer for one and not the other
was what produced the defect above.

## Why refuse rather than pick a row

The obvious repair is a `DISTINCT ON (person_id)` over the in-force set, which makes the graph
functional and every argument above sound. It is refused.

Choosing between two in-force rows is choosing **which of two leaders the person belongs to**, for
the period, permanently, in a report. Nothing in Section 5 or Section 20 decides that, so a tiebreak
written into a query would be a placement rule invented at a keyboard — and it would be invisible,
because the figure it produced would look right. Section 20's standard for a data-integrity defect is
that the figure refuses rather than silently truncating; silently *choosing* is the same failure with
a better disguise.

## The real remedy is at the write, and is not this ruling

**Both pinned cases flip.** `reporting-subtree.spec.ts` currently pins the non-refusing behaviour of
each failure — a leader beside a grounded cycle answering cleanly, and a walk returning a person
twice — as the behaviour the method has rather than the behaviour it should have. Implementing this
turns both into rejections. That is stated here rather than left to the slice, because a test
rewritten beside the code it blesses tends to bless what the code does.

`CLAUDE.md`'s overlap Stop Condition already proposes the real remedy: an exclusion constraint,

```sql
EXCLUDE USING gist (person_id WITH =, tstzrange(started_at, ended_at) WITH &&)
```

which makes the premise a property of the data rather than an assumption of one query, and closes
all three consequences that bullet now records. That is a Section 5 amendment with a migration
attached — a code-owner change, and a decision about whether historical overlap is legal at all —
so it belongs to whoever settles the Stop Condition. **This ruling makes the report honest until it
exists**, and it stops being reachable when it does.

## Alternatives refused

- **Leave it.** A report that returns a person twice is a wrong unique-people total with nothing
  failing, which Principle 10 and Section 20 both forbid.
- **De-duplicate the result.** Hides the defect one layer later and still has to choose a leader for
  the drill-down.
- **Refuse only the walk that sees the duplicate.** This ruling's first answer, and wrong: the damage
  leaves the total that contains it, so the rule publishes corrupt figures while appearing to be the
  proportionate choice. Refused on a reproduction rather than on an argument.

---

Decision 0212, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report is computed in one read-only transaction at `REPEATABLE READ`](0210-a-report-is-one-read-only-transaction-at-repeatable-read.md)

*Number 0211 is not skipped by accident. It was drafted in this batch, settling which graph authorizes a leader-scoped report, and was withdrawn before review: `CLAUDE.md` says that walk is built with the route it authorizes rather than in advance, and drafting it early coupled it to 0210 in a way that produced most of the findings against both. The number is left unused rather than reassigned, because these files are referred to positionally.*
