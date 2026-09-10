# 2026-09-10 — Section 2's exemption names the people-without-a-Cell join

Decision 0233 named this in its own opening as a question it was not settling: which
module owns the people-without-a-Cell query, and whether Section 2's exemption admits
the join it makes. It shipped the code with the question escalated. This settles it.

`PeopleReadService.withoutACell` selects from `persons`, which `people` owns, and
anti-joins three tables `cells` owns — `cell_memberships`, `cell_leaderships` and
`cells` itself.

Section 2's main rule sends every cross-module read through the owning module's service
interface. Its one exemption is "a read joined onto a query rooted in a table the reading
module owns", which names two instances and closes the list: "Nothing else qualifies
today, and adding to this is an amendment rather than a decision taken in a module."

No amendment had been made. This is that amendment.

## The exemption admits it, and Section 2 now names it

The query satisfies the exemption's premise exactly. It is rooted in `persons`, and the
three reads are joins onto that root rather than questions asked of `cells` on their own
account.

It also satisfies the exemption's stated ground. Section 2 closes that paragraph with
"a join reads rows the owning module would have returned anyway and changes nothing",
and draws the asymmetry deliberately: a write is what an invariant guards, so a write has
one home, while a read of this shape does not move an invariant anywhere. Nothing about
membership, leadership or Cell state is decided here. The three anti-joins ask whether a
row exists and never interpret one.

## The two ports are not counter-examples, and that is what makes this principled

`CLAUDE.md` recorded the repository's precedent as "unanimous the other way", naming
`networks` asking these same two questions through `cell-relationships.port.ts` and
`auth` through `cell-scope.port.ts`. **That claim is withdrawn.** Both were read before
this ruling was written, and neither satisfies the exemption's premise:

**The discriminator is the call site, not where the port's implementation roots.** A first
version of this ruling argued that both ports are rooted in the owning module's tables
throughout, and `architecture-guardian` pointed out that this is true of *any* port
implementation, the one `withoutACell` was offered included, so it distinguishes nothing.
The argument is restated on the reads themselves:

- `NetworksService` calls `openLeadershipsOf(transaction, personId)` as a precondition
  check inside a Network-change transaction. It is a standalone lookup keyed by an
  identifier the caller already holds.
- `CapabilityGuard` calls `leaderForScope(cellId)` to resolve one Cell. The same shape.

Neither read is a join onto a query rooted in a table the *reading* module owns, because
neither is joined onto anything: each is a question asked on its own account. That is
precisely what Section 2's main rule sends through a service interface, and what becomes a
port where the direction would be a cycle. They instance the rule, not the exemption, so
they were never evidence about this case at all.

The distinction is the whole ruling. The exemption says a read of this shape is not a
cross-module dependency; the port rule governs dependencies that exist. Reaching for a
port here would have been answering the wrong rule's question.

## A cost this ruling claimed, and withdraws

**A first version argued that a port would return a page short of its own limit**, on the
ground that the three anti-joins sit in the `WHERE` clause the `LIMIT` applies to and
would leave it. `CLAUDE.md` had costed the port option as materialising the placed set,
and this ruling claimed to enlarge on that. **It is withdrawn, and it was never the same
option.**

A port returning the placed set puts the filter straight back into the `WHERE` clause as a
`NOT IN`, so the `LIMIT` applies to the filtered set and the page is full. The short page
belongs to a different shape — one asked per page and filtered in memory — which nobody
proposed. **This method already demonstrates the refutation**: `scope.personIds` is a
materialised set from `hierarchy`, applied as `.where('person.id', 'in', [...])` on every
page, with no effect on page fullness.

It is withdrawn rather than restated for the narrower shape, because a cost the decision
does not rest on is a claim the next module gets to argue from, and this one was wrong.
The first ground carries the ruling alone.

## The query cannot be re-homed in `cells`

A third option was available and is not viable. Moving the query into `cells` fails on
its population: the list is people with **no** Cell relationship, and `cells` owns no
table containing the people who have none. Rooting it there would reverse the violation
rather than remove it.

So the real choice was two-way, and the two-way choice is what was put and answered.

## What this accepts

**The closed list is widened, and the next module has a precedent to argue from.** *Two
successive versions of this sentence stated an ordinal and neither survived. "The second
time" was refuted by the specification's own history — `git log -S "Nothing else qualifies
today" -- SKILL.md` returns the one commit that created the sentence, and the correction of
2026-08-26 rewrote the exemption's description without adding an instance. "The first" was
then refuted by the tree, where `cells` joins `persons` in `membersAsOfWithin` and
`membersOfWithin` and no home names either. Which ordinal is right depends on whether §2
enumerates instances or argued instances, which is now a Stop Condition. It is deleted
rather than corrected a third time, in the paragraph whose whole subject is the precedent a
figure sets.* That cost is real and is taken deliberately. The list stays closed, and
adding to it stays an amendment — a ruling with all three legs — which is the mechanism
working rather than failing. What is refused is a module deciding this for itself, which
is what had happened and what decision 0233 escalated rather than ratified.

## What this does not settle

**Whether a Cell's leader is a member of their own Cell.** Still open, with consequences
in Section 12, and untouched here.

**Whether Section 2's enumeration is a list of instances or a list of argued instances.**
This ruling adds one instance and re-derived the paragraph around it, and the re-derivation
asserted a total that the tree refutes: `cells` joins `persons` in two places that neither
Section 2, nor `people.module.ts`, nor any docblock names. So the amendment this ruling
makes is sound and the enumeration it sits inside is not known to be complete. Recorded in
`CLAUDE.md` rather than settled here, because deciding it would either admit two instances
nobody argued or narrow a sentence the owner did not rule on.

**Whether Section 2 admits `awaitingReassignment`, or `attendance` writing `settings`.**
Both are recorded as Stop Conditions. Neither is reached by this ruling, and the second is
on the write side, where Section 2 admits no exemption at all.

Decision 0233's other two answers — the capability, and that leading an `ACTIVE` Cell
counts as having one — are undisturbed. This supplies only the third question that ruling
named and left standing.

---

Decision 0234, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — People with no Cell are a Cell attention list, and leading one counts as having one](0233-people-with-no-cell-are-a-cell-attention-list.md)
