# 2026-09-05 — The placement graph authorizes a leader-scoped report, and one edge definition serves both directions

Decision 0207 settled that a report's scope selector resolves **as of the period being reported**,
and reasons throughout about "the October tree". Two graphs answer to that description and they are
not the same size. This settles which one a leader's `reports.view_subtree` reach is measured
against, and what the guard has to be able to walk.

Recorded as open on 2026-09-05, raised by `architecture-guardian` on the placement graph.

## The two graphs, and what separates them

- **`subtreeAsOf`** (decision 0205) reads the assignments in force at **one instant** and collapses
  nothing.
- **`reportingSubtree`** (decisions 0206 and 0209) walks Section 20's **placement graph**: a person
  with no open assignment at the period's end is placed by the last one they held *within* the
  period, and where the chain reaches a leader with no in-period assignment it continues from that
  leader's last one, whenever it was.

The placement graph is strictly **wider**. It reaches a person who ended the period unassigned —
archived, or encoded and not yet assigned — and who appears in no as-of tree at any instant. That
population is not an edge case: it is the population decision 0206 exists to add, and Section 3
forbids filtering it out of a period-based report.

## The ruling: the placement graph authorizes

**A leader-scoped report is authorized against the same graph the figure is computed from.**

Section 7 already supplies the argument, in the bullet that settled 0207: authorizing undated

> would show a figure while refusing the breakdown that explains it, against Section 20's
> additivity — on the actor's own screen rather than in the arithmetic.

That failure is not particular to dates. Authorizing against the *narrower* graph reproduces it
exactly: the total is computed from the placement graph and already contains the people 0206 and
0209 place, so a guard measuring reach against the as-of tree would show a leader a total containing
a person and refuse the drill-down that explains them. Section 7's own reason for the dated selector
decides the graph question too; it was simply never asked of it.

**It is correct rather than merely permissive, which is the part worth checking.** A wider
authorizing graph grants more, so it deserves the harder question: does the leader it grants to
actually deserve the person? They do, on Section 7's own criterion that historical visibility
follows historical responsibility. A person unassigned at the period's end was discipled within that
period by the leader the fallback names — that is what the fallback *is*. Under decision 0209 the
chain reaches further, to the upline of a leader who had already left, and the same argument carries:
during the gap those disciples are informally that upline's, which is where 0209 places them and
usually where they are formally reassigned.

## The guard's walk is upward, and it must be the same graph

The guard resolves reach through `isWithinSubtree`, which goes through `ancestorsOf`, which filters
`ended_at IS NULL`. It is undated, so today it refuses precisely what 0207 says must be permitted.
Making it dated is not enough: it must be dated **over the placement graph's edge set**, which has
three tiers rather than one.

**One edge definition, two directions, and this is the load-bearing half of this ruling.** The
downward walk and the upward walk must be built from the same edges, factored out rather than
re-derived. Two independent implementations of one graph disagree eventually, and the disagreement
is asymmetric in the worst way: where the upward walk is wider than the downward one a leader is
authorized for people no figure contains, and where it is narrower they are refused a drill-down
into their own total. This repository has recorded the same one-rule-two-paths failure on four
consecutive review rounds; here it would be an authorization defect rather than a wrong number.

**Upward rather than downward-and-test-membership.** Both answer the question. A downward walk from
the actor is O(the actor's subtree), which for a Senior Pastor is the whole church, and the guard
runs on every request; the upward walk from the target is O(depth). The placement graph gives each
person at most one out-edge, so walking up is resolving that edge repeatedly — the same rows, read
the other way.

**Cycle-safe in both directions**, on Section 5's terms and for the reason decision 0206 gives: this
map collapses rows from several instants and is not the active tree, so it can hold a cycle no write
ever created.

## What this does not decide

**It does not move a write.** Decision 0207's closing paragraph stands unchanged: authority to *act*
resolves through the current leader, a write carrying an effective date other than now is still
authorized now, and that is what stops privilege being reclaimed through a date field. A viewing
capability confers no write.

**It does not settle which target a `CELL`-valued scope selector resolves through**, which is a
separate open item and concerns a different target.

## Alternatives refused

- **The as-of tree.** Refuses drill-downs into totals it permits, which is the defect 0207 was
  written to prevent, arriving through the other half of the same sentence.
- **Authorize against the placement graph and compute from the as-of tree.** Makes the guard wider
  than the figure, which is safe, and makes the figure wrong, which is not — it drops the population
  0206 exists to add.
- **Two implementations, one per direction, kept in step by review.** Named because it is what
  happens by default, and refused for the reason above.

---

Decision 0211, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report is computed in one read-only transaction at `REPEATABLE READ`](0210-a-report-is-one-read-only-transaction-at-repeatable-read.md)
