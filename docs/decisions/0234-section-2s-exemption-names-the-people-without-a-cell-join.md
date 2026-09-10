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

- `CellsReadService.openLeadershipsOf` selects from `cell_leaderships`, inner-joins
  `cells`, and takes a `personId` as a parameter. It is rooted in the **owning** module's
  tables throughout.
- `CellScopePort.leaderForScope` takes a `cellId` and resolves a Cell's leader. Rooted in
  `cells` tables likewise.

Neither is a join onto a query rooted in a table the *reading* module owns. Both are
standalone lookups in another module's tables — which is precisely what Section 2's main
rule sends through a service interface, and which becomes a port where the direction
would be a cycle. They are instances of the rule, not of the exemption, so they were
never evidence about this case at all.

The distinction is the whole ruling. The exemption says a read of this shape is not a
cross-module dependency; the port rule governs dependencies that exist. Reaching for a
port here would have been answering the wrong rule's question.

## What a port would have cost, which is not only an indirection

`CLAUDE.md` costed the port option as materialising "the whole church's placed set on
every page". That named the smaller half.

The three anti-joins sit in the `WHERE` clause that the `LIMIT` applies to. Behind a port
the filter leaves that clause: a page of `limit + 1` rows is fetched **unfiltered**,
filtered in memory, and comes back short — so the route would return a page smaller than
its own limit while more rows remain, and paging would need a loop no section bounds.
That is a correctness consequence rather than an efficiency one.

## The query cannot be re-homed in `cells`

A third option was available and is not viable. Moving the query into `cells` fails on
its population: the list is people with **no** Cell relationship, and `cells` owns no
table containing the people who have none. Rooting it there would reverse the violation
rather than remove it.

So the real choice was two-way, and the two-way choice is what was put and answered.

## What this accepts

**The closed list is widened for the second time, and the next module has a precedent to
argue from.** That cost is real and is taken deliberately. The list stays closed, and
adding to it stays an amendment — a ruling with all three legs — which is the mechanism
working rather than failing. What is refused is a module deciding this for itself, which
is what had happened and what decision 0233 escalated rather than ratified.

## What this does not settle

**Whether a Cell's leader is a member of their own Cell.** Still open, with consequences
in Section 12, and untouched here.

Decision 0233's other two answers — the capability, and that leading an `ACTIVE` Cell
counts as having one — are undisturbed. This supplies only the third question that ruling
named and left standing.

---

Decision 0234, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — People with no Cell are a Cell attention list, and leading one counts as having one](0233-people-with-no-cell-are-a-cell-attention-list.md)
