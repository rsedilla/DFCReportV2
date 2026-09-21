# 2026-09-21 — Section 7's closed-Cell clause governs the Cell an operation acts on, not a Cell a request names

Decision 0264 gave a leader **Restart this Cell**, and shipped its migration and its route with
nothing settling what `cell.manage_lifecycle` resolves to on a closed Cell. Section 7 answers that
twice and not identically.

Its base bullet says a Cell target resolves through the Cell's leader as of the period viewed,
"falling back to its last leader where the Cell is closed", and the bullet settling decision 0186
says that fallback "governs every Cell target whichever class its capability is in". Its
closed-Cell clause says the opposite about the same case: a write resolves through the Cell's
current leader, "and a closed Cell has none, so every write against one resolves through nobody…
Nothing else does — not a membership, not a leadership, not a configuration change."

A restart is guarded by a management capability, which resolves as a write (decision 0186). Under
the first pair of sentences the leader above the Cell's last leader may request one, which is what
decision 0264 describes. Under the clause only a Whole Church grant may, which would leave Section
10's own sentence — "in practice this is a leader saying that one of their own disciples is ready
to lead" — describing something nobody can do.

## The ruling

**Section 7's closed-Cell clause governs an operation whose target is the closed Cell.** Every item
it enumerates is one: a membership, a leadership, a configuration change, and a Cell meeting with
the roster read that write requires.

**A second object a request names is not that.** Where a request's target is a Person and it names
a Cell besides — which is what Section 10 calls the second-object rule, and what a handover and a
restart both carry — the scope check on that Cell is a read of who led it. It resolves by the base
bullet, through the Cell's leader, falling back to its last leader where the Cell is closed.

So a restart is requested by a leader upline of the person who led the Cell, and the clause's
"Nothing else does" stays true of the things it is about.

**The test is the operation's target and nothing else.** In particular it is not whether the
closed Cell changes. That would be a wider rule and a different one: a listing changes nothing
either, so deciding on it would settle by inference the question this ruling says stays open.
`GET /api/v1/cells/{id}/meetings` has the closed Cell as its own target, so it stays where
`CLAUDE.md` records it — open in both its halves, the admission and whether that admission
survives the month's window shutting.

**It settles the second-object shape, which is two operations rather than one.** A handover names
a Cell too, and `assertHandoverCellWithin` resolves its leader and runs the scope check *before*
refusing a `CLOSED` Cell — so a handover request naming a closed Cell has been deciding between
`SCOPE_DENIED` and `INVARIANT_VIOLATION` on this fallback since that path shipped, pinned green by
`cell-leadership-request.e2e.spec.ts`. The ambiguity was live in the repository before the restart
existed; what the restart did was make an answer load-bearing.

## Why

**The alternative is not the safe reading, it is a different rule.** Refusing the fallback here
would put the one route whose whole premise is that the Cell *is* closed behind a Whole Church
grant, and Section 10 says the opposite in terms: the actor must have the Cell "within their
authorized scope, on the terms that govern closing it", which is `cell.manage_lifecycle` resolved
against its leader. Reading the clause by capability class rather than by what the operation
targets would make Section 10's rule unsatisfiable by anybody Section 10 names.

**It is a narrowing of the clause and not a clarification of it.** The clause reasons from
decision 0186 — a capability resolving as a write, resolving through a current leader the Cell no
longer has — so on its own terms it does reach a restart. What this ruling says is that the class
of operation, and not the class of capability, is what the clause is about, and it says it for the
one shape that forced the question. The wider version, that the fallback survives for every
write-resolving capability on a closed Cell, is what `CLAUDE.md` still records as open; it is not
taken here, because a ruling written past the case in front of it is how this repository has twice
settled a question nobody had asked.

**Who this reaches, concretely — and it is narrower than this second-object check alone.** This
ruling decides who has the closed Cell *in scope*: anyone holding `cell.manage_lifecycle` over its
last leader, which is that leader's upline within their own subtree, Admin, the two Senior Pastors,
and a Network grantee, the last being wider than the list Section 10 gives and named as a gap where
Section 10 states it. **Asking for the restart also needs `cell.request_leadership` over the leader**,
which every role holds at subtree-excluding-self, so the actor must be upline of them in their own
tree: an administrator outside the tree has the Cell in scope and cannot request its restart. Not the
former leader themselves, at any scope, because Section 10 lets no holder of that capability name
themselves.

---

Decision 0265, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-20 — Restarting a closed Cell is a new-Cell request that names it](0264-restarting-a-closed-cell-is-a-new-cell-request.md)
