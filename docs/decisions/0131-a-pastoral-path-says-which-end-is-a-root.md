# 2026-08-28 — A pastoral path says which end is a root


`GET /api/v1/people/{id}/pastoral-path` is the last Stage 2 endpoint, and building it
turned one sentence of Section 5 into a question no section answered.

Section 5 settled on 2026-08-23 that a root **is a row** — an open assignment carrying
a null `leader_id` — precisely so "is this person a root" is answerable in the
database, and it closes with: a Person with no row at all "is therefore never a root;
they are unassigned — surface them as such rather than silently rendering them as a
second root of the tree."

Both produce a path of exactly one node. The first implementation returned the same
payload for each, which is the rendering that sentence forbids, and no section said
what shape carries the distinction.

**Each node carries `network_root`.** True only on the first, since only the first can
hold a null-leader row. Written to Section 8 with the rest of the path's shape.

The alternatives were a top-level discriminator, which puts a fact about one node
outside the node, and refusing an unassigned subject, which turns a legitimate state
— Section 5 invariant 3 names three of them — into an error on a read.

**What is deliberately not claimed is which of invariant 3's three cases an
unassigned Person is in.** Section 5 says the schema holds no `why` and that the
remedy is for a list to exclude accounts holding `ADMIN` rather than for the
specification to claim a distinction it cannot make. `network_root: false` says the
person is not the top of a tree, and nothing more.

**The review of this endpoint corrected two things worth keeping.** The first draft
resolved names by reading `persons` from `hierarchy`, and Section 2 permits exactly
one cross-module read shape — a join rooted in a table the reading module owns —
naming the two queries that qualify and closing the list. A bare id lookup is a third,
and it was avoidable: the walk returns identifiers and `people` puts the names on
them. The docblock had meanwhile asserted it was a join, was rooted correctly, and
could not be moved, none of which was true.

And the docblock misquoted invariant 3, listing a Network root as one of its three
zero-assignment cases when Section 5 names a root as explicitly **not** one — the
three are a Person not yet assigned, an archived Person, and an administrator outside
the pastoral structure. Two test comments repeated it, and one asserted that a root
and an unassigned Person were indistinguishable in the data and that this was
correct, which is the opposite of the rule this ruling exists to satisfy.

**One review finding was rejected rather than fixed.** It reported that nothing
exercises the recursive walk's cycle rejection, making the endpoint's claim to inherit
it unfalsifiable. `api/test/database/cycle-safety.spec.ts` writes a two-person cycle
directly and asserts both `subtreeOf` and `ancestorsOf` reject it, and
`pastoralPathOf` calls `ancestorsOf`. The rejection rests on that file existing and
nothing else: how the finding was arrived at is not something this log can observe,
and an entry asserting it would be the fault the entry above it records.

---

Decision 0131, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — Two engines, and the width argument gets something that can fail](0130-two-engines-and-the-width-argument-gets-something-that-can.md) | Next: [2026-08-28 — Three rulings before Stage 3, and a fourth withdrawn](0132-three-rulings-before-stage-3-and-a-fourth-withdrawn.md)
