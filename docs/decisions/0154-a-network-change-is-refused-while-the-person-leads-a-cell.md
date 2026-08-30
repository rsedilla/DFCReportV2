# 2026-08-30 — A Network change is refused while the person leads a Cell


Stage 3's last item, and the second half of Section 4's closing paragraph: a Network change
must not leave the person holding relationships the homogeneous-network rule no longer
permits. Section 4 settled the pastoral half on 2026-08-22 and left the Cell half undefined,
because neither `cells` nor `cell_leaderships` existed yet.

**Refused, on the same terms as the pastoral half.** The remedy is a handover through
request-and-approve, or a closure, both separately authorized and separately audited. Once
the person leads no Cell, the correction is retried.

*Both are Section 10 operations; only closure is built on `main` today.* Approval of a
leadership request lands with `feat/cell-leadership-approval`, so until that merges the
only remedy an installation can actually perform is closing the Cell — which sharpens the
cost recorded below rather than changing the rule. An earlier version of this entry said
both were built, which was true of the branch it was written beside and not of the tree it
was committed to.

Worth stating plainly because the question is usually framed as a choice between refusing and
handing over, and those are not alternatives: **refusing is the mechanism, and a handover is
one of the two ways to clear it.** The genuine alternative was to cascade — let the change
through and carry the Cell across with its leader.

**Cascading is rejected on the argument Section 4 already made once.** Where a Cell holds a
dozen members, moving them is a dozen pastoral decisions, and an administrator supplying
destinations inside a data-correction form is exactly what that section refused for the
pastoral case. Section 10 gives those decisions their own operation with an explicit recorded
choice about every member.

**The failure it prevents is silent, which is what decides it.** A Cell takes its Network from
its leader, and membership is compared against that Network only when a membership row is
written. So a leader's Network change carries the Cell across and leaves every existing member
on the wrong side of the rule with **nothing raised** — coverage, attendance and
classification all keep computing. Migration 0009 names this as the widest of its three
uncovered paths, and the cross-Network approval case on `feat/cell-leadership-approval` had
to exploit it to build a fixture, which is how sharply reachable it is. *That test is on that
branch and not this one, which is spec-only; an earlier version of this sentence said "this
branch's own".*

**A Cell with no members is refused too.** The Cell carries a Network itself, so flipping it
part-way through its life moves every past-period figure for it, against Section 3's
reproducibility guarantee. A roster-dependent rule would also make the refusal depend on
something the administrator cannot see from the correction form.

**It is a domain-layer rule, and the reason is the pastoral half's own rather than a new
one.** A deferred check sees only commit-time state, so a transaction that resolves the
conflict and performs the correction together commits legally — which is exactly what
Section 4 says about disciples. Making the trigger immediate does not rescue it either: that
enforces statement *ordering* rather than the precondition, so an implementer who resolves
the Cell first still passes, and migration 0009 records that trap for the sibling trigger.
The refusal is about the state the request arrives in, and no constraint observes arrival
state.

*An earlier version called this "a different reason worth checking rather than assuming",
and `SKILL.md` said "the reason the pastoral half gives above" — so the two documents
disagreed about whether the reasoning was borrowed. `SKILL.md` had it right. What differs is
only that one describes a trigger that exists and the other one that would have to be
written, which is a difference in subject rather than in reason.*

**The cost is accepted in writing.** Finding a new leader for a Cell takes weeks, not an
afternoon, so somebody whose record is wrong stays wrong until the Cell is resolved or closed.
Section 4 accepts the identical cost for the pastoral half. The alternative is a correction
that quietly invalidates every membership in the Cell.

**The membership half is settled with it, and separately rather than by symmetry.** A Network
change is refused while the person holds a Cell membership too. Section 10 left the choice to
Section 4 — "resolve both together or reject the change" — and the failure is identical in
kind: the membership is compared as of its own `started_at`, so after a change it is a
cross-Network relationship no check revisits.

It is reached by nothing the leadership half does, which is why it needed its own decision:
membership does not mirror pastoral assignment, so an ordinary member need not lead anything
and need not be pastorally under the Cell's leader.

**The remedy is to end the membership, not to move it**, and that is a finding rather than a
wording choice. A person still in the Men's Network cannot be moved into a Women's Cell first
— the new membership would be compared at its own start with member and leader in different
Networks, and refused. The order is end, correct, then add them to a Cell in the Network they
now belong to.

That is what makes this half cheap where the leadership half is expensive: one authorized
operation the same afternoon, nobody waiting weeks, no Cell closed, no second party. Settling
it by symmetry with the leadership rule would have imported a cost it does not have.

**Leadership is refused before membership**, so somebody holding both is told about the
obligation that takes weeks rather than the one that takes minutes. Section 4 already fixes an
order for that reason, the root refusal before the disciple refusal. That closes one of the
three Stop Conditions the review raised; the other two — the backdate floor, and whether a
narrower grant could make naming the Cells a disclosure — are on the open list.

Written to `SKILL.md` Section 4, and verified by grepping that section for both rules rather
than by asserting it here.

---

Decision 0154 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Three rulings the approval endpoint needed, and a condition nothing could evaluate](0153-three-rulings-the-approval-endpoint-needed-and-a-condition.md) | Next: [2026-08-30 — The backdate floor gains two Cell terms, one per mechanism](0155-the-backdate-floor-gains-two-cell-terms-one-per-mechanism.md)
