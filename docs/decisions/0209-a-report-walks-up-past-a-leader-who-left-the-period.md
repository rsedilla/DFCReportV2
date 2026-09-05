# 2026-09-05 — A report walks up past a leader who left the period, and the gap is surfaced rather than hidden

Decision 0206 placed a person by their open assignment at the period's end, or by the last
one they held within it. `architecture-guardian` found that this loses people, and that
Section 20's own additivity claim is false as a result. This settles what the walk does
instead, and it is the owner's ruling rather than one derived here.

## What was wrong

The placement graph is **functional** — one out-edge per person — so a component that cannot
be reached from a leader is not merely unvisited, it is invisible. Two shapes:

- **A cycle.** Two people can each end a period unassigned having each been under the other
  within it, from two writes that were individually legal, because Section 5 invariant 2
  constrains the *active* tree and this map is not it. Section 20 says a detected cycle
  refuses the figure rather than truncating the chain — but a cycle is a closed component,
  so a walk seeded at a leader above never enters it and never detects it.
- **A dangling parent.** A person holds an open assignment under a leader who is themselves
  unreachable — archived before the period began, say, with their disciples not yet
  reassigned. That person is **not** in Section 20's residual, which covers only somebody who
  held no open assignment at *any* instant of the period. They are nonetheless in no leader's
  subtree, and Section 20's "a drill-down adds up to the level above except for the residual"
  is false with nothing detecting it.

**The common case was never broken**, and that is worth recording because it decided the
ruling. A leader archived *during* the period still holds an assignment within it, so they
fall back correctly and their disciples come up the chain with them. The defect needs the gap
to span an entire reporting period.

## The ruling: the chain continues past a leader who has no in-period assignment

**Where the fallback lands on a leader who held no assignment within the period, that
leader's own placement is resolved from their last assignment, whenever it was.** The chain
continues until it reaches a root, or a person who has never held an assignment at all.

The fallback for the **person** stays in-period, as Section 20 already says. What extends is
the **chain** — resolving a leader who has already left. Those are two rules where Section 20
had one, and the distinction is stated because a reader will otherwise apply the wrong one.

## Why, and what was refused

**The data holds the answer.** The person was somebody's, and that somebody was somebody's.
Dropping them discards a relationship the database plainly records, and reconstructing the
chain invents nothing.

**It matches where those people actually sit.** During the gap the disciples of an archived
leader are informally that leader's upline's, which is where this places them and usually
where they will be formally reassigned.

**It stays reproducible**, which was the main risk. Assignment history is never deleted
(Section 5), so the chain resolves identically on every re-run — the guarantee Section 3
makes and Section 20 depends on.

Three alternatives were considered and refused.

- **Leave them out**, which is the current behaviour. Refused: it is a wrong total nobody can
  see, and Section 20 already forbids exactly that for the cycle case.
- **Refuse the whole report.** Disproportionate. It punishes a leader for a transient state in
  another branch, which they can neither cause nor repair.
- **Refuse the archive, as Section 3 refuses archiving a Person who leads a Cell.** This was
  recommended and then withdrawn, and the withdrawal is recorded because the reasoning matters.
  The precedent's *form* fits and its *substance* does not, and the sound ground is narrower
  than the first version of this paragraph claimed. A leaderless `ACTIVE` Cell violates a
  deferred constraint trigger (Section 11): the database refuses to hold that state at all.
  Zero open pastoral assignments is the opposite — Section 5 invariant 3 makes it explicitly
  legitimate, for three separate reasons. One is a state the schema forbids; the other is a
  state the schema provides for. *An earlier version rested this on the Cell case being
  “permanent”, which Section 3 does not say and which is false — Section 3 names two
  resolutions, handover and closure.* Worse, blocking the archive inverts the
  real workflow — the pastoral decision about the disciples is usually made *after* — so the
  likely outcome is that the archive never happens and the person stays recorded as active,
  corrupting every current-state count. *That is a different harm from the one Section 3's
  rule addresses — Section 3 guards against a Cell whose leader is not a current Person, and
  separately warns in the other direction that “a real Person who has stopped attending must
  not automatically be archived”. The point stands on its own terms and does not need
  Section 3 to have made it.*

## The gap is surfaced, and this half is not optional

A correct report removes the pressure to reassign anybody, so the transient state could
quietly stop being transient. **An attention list of people whose pastoral leader is archived
is therefore required**, shown to the upline who can act — the idiom Section 15 already sets
out, filtered and never ranked. Without it this ruling fixes the number and hides the
problem.

## The cycle is a separate fix and needs no ruling

Section 20 already says a detected cycle refuses the figure. What was wrong is that detection
was scoped to the component the walk reached. Detecting over the whole placement graph
implements the rule as written, and this ruling does not change it.

---

Decision 0209, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-05 — A report resolves the tree at the last millisecond of its period's final day](0208-a-report-resolves-the-tree-at-the-last-millisecond-of-its-period.md)
