# 2026-09-10 — People with no Cell are a Cell attention list, and leading one counts as having one

Section 15 requires this list, inside *Cells needing attention*:

> "People with no active Cell membership within the viewer's scope (Section 10)"

Section 19 puts it in every leader's outstanding work, and Section 10 says where the
people come from: closure "must not complete without the decision being made", members
may be "left unassigned by explicit choice", and "people left without a Cell appear in
the attention list in Section 15".

So the list is specified and its population is specified. Nothing says which capability
guards it, which module owns it, or what it does about a Cell's leader.

## `cell.view_subtree`, resolved against the actor

**It is a Cell attention list, and Section 15 says so by placing it there.** Its two
neighbours in that list are Cells; this is the one row that names a Person, and it names
them because of a Cell fact about them. The reader is doing Cell work: the entry exists
so somebody is placed in a Cell.

**The act that resolves it is a Cell act**, which is the discriminator. Section 19 asks
each entry to carry the action that resolves it, and decision 0229 states the
consequence for the sibling list — an entry no act resolves is what an attention list
must never carry. That act is `POST /api/v1/cells/{id}/members`, in the `cells` domain.
Guarding the list with `people.view_subtree` would offer it to a reader whose grants
reach no Cell at all.

**`{ kind: 'actor' }`, with the narrowing in the service**, because there is no Cell to
resolve against — that is the condition. Decision 0226 established exactly this shape for
`GET /api/v1/cells`, which carries the same capability against the same target kind and
narrows inside `CellsIndexService`. This is that shape reused rather than a new one
derived, and reusing it is legitimate here for the reason decision 0100 requires: the
question it answers is the same question, a collection under a Cell capability with no
single Cell to resolve through.

*The alternative considered was `people.view_subtree` against the actor, which is decision
0232's shape one list over and would have made two attention lists of Persons agree. It
was rejected on the act rather than on the row: 0232's entry is resolved by a pastoral
reassignment and this one by a Cell membership, and the capability follows the act.*

## Leading a Cell counts as having one

A Cell's leader holds no `cell_memberships` row. Reproduced against the demo database:
both current Cells return their leader in `cells.leader` and not in
`GET /cells/{id}/members`, and neither leader holds an open membership anywhere.

**So the literal reading of Section 15 — a Person with no active `cell_memberships` row —
puts every Cell Leader in the church on a list of people needing a Cell.** That is plainly
not what Section 15 asks for, and it would put the leaders at the top of an alphabetical
list of their own downline.

**A person who leads an `ACTIVE` Cell is excluded.** They are not waiting to be placed;
they are running the thing other people are placed into. The exclusion is on *leading an
Cell* rather than on holding any Cell relationship, so a person whose Cell has closed
reappears — correctly, because a closed Cell's leader does need a Cell.

**This deliberately does not settle whether a leader is a *member* of their own Cell**,
which is a wider question with consequences elsewhere and is recorded as open. This ruling
settles only that such a person does not appear on this list, which is true under either
answer.

## Two exclusions this list shares with its sibling

**An archived Person is excluded**, on decision 0232's ground and Section 10's: adding an
archived Person to a Cell is refused, so the entry would carry no act that resolves it.

**A merged-away Person is excluded**, because the survivor carries the identity (Section
3). Unreachable until Person Merge ships.

## It is current-state, and names no period

The list asks about now: somebody placed in a Cell last week needs no action today. So it
names no period and is an undated read under Section 7's first clause — decision 0232's
reasoning, and decision 0204's before it.

**It is deliberately not dated to the month the Cells index uses.** Decision 0231 dates a
collection that *names* a period; this one names none, and adding a month to it would
create the dated read that ruling's own warning is about.

## Ordering, and the prohibition

**Ordered by name**, never by how long somebody has been without a Cell (Sections 13, 15
and 17). A list ordered by that is a ranking of neglect, and it would rank the leaders who
have not yet placed people rather than the people.

Each entry names the Person and their Member ID, both of which Section 8 publishes
church-wide, and carries the action that resolves it.

---

Decision 0233, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — The archived-leader attention list keys on the condition, not on the lifecycle flag](0232-the-archived-leader-attention-list-keys-on-the-condition.md)
