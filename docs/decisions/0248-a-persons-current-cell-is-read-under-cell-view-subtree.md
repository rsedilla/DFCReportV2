# 2026-09-15 — A person's current Cell is read under `cell.view_subtree`

The People screens of the redesign show a person's Cell on their profile and on Edit, and
the move to another Cell starts from it. No route returns it. `GET /api/v1/people/{id}`
returns a person's own details and nothing about Cells.

## The ruling

**`GET /api/v1/cells/people/{id}/membership` returns the Cell a person currently belongs
to, with that Cell's current leader, or none, and separately the Cells the person currently
leads.**

- **It is guarded by `cell.view_subtree`, resolved against the person.** Section 7 gives
  `cell.*` everything under `/api/v1/cells`, and `cell.view_subtree` is that domain's read
  capability. Section 7 resolves a membership through the Cell's leader; this one is asked
  from the person, and resolves through them (Sections 7 and 8).
- **It names no period, so it asks about now** (Section 7, *An effective date does not move
  the scope decision*). The actor must hold the person in scope today.
- **It returns the open membership and the open leaderships, apart.** Section 10 gives a
  person at most one membership, and zero is legitimate, so that half is one Cell or none.
  Section 15 says one leader can have multiple Cells, so the other half is a list, possibly
  empty.
- **It changes nothing.** A move is still an add on `POST /api/v1/cells/{id}/members`.

## The ground

**The move needs a starting point.** Section 10 makes a move one change that closes the
current membership and opens the next, and a screen offering it has to say which Cell the
person is leaving.

**No role changes.** Every role in Section 7's catalog holds `cell.view_subtree` at the same
scope it holds `people.view_subtree`.

**Leading a Cell counts as having one.** A Cell's leader holds no membership row (decision
0233), so an answer carrying membership alone reads every Cell Leader as having no Cell,
which contradicts the people-without-a-Cell list that decision 0233 excludes them from. It
would also let a screen offer to add a leader to a Cell, and nothing refuses that: neither
`cells.membership.service.ts` nor any trigger, constraint or index on `cell_memberships`
checks whether the person leads a Cell. Each such addition would answer the open question
below in the data. The owner chose to return both halves on 2026-09-15, after
`architecture-guardian` raised it.

## What it widens

Section 10 makes membership independent of pastoral assignment, so a person in a leader's
scope can belong to a Cell whose leader is outside it. This route shows that leader the
Cell and its leader's name, and nothing of the Cell's other members. The Cell's ID is one
Section 8 withholds from a search for its leader.

The move does not justify that, because in that case the move is refused: a move is checked
against the source Cell through that Cell's leader, and an actor whose scope does not reach
the leader is refused (`cells.membership.service.ts`). What justifies it is the profile. The
question is about the person, whom the reader holds in scope; the Cell leader's full name is
one of the five fields Section 8 returns about anyone; and requiring authority over the Cell
would leave a leader unable to see where somebody in their own scope attends.

The owner chose this on 2026-09-15 over reading a person's Cell under authority over the
Cell, after `architecture-guardian` found that Section 7 resolved a membership through the
Cell's leader and Section 8 bounded every Cell surface by authority over the Cell. Sections
7, 8 and 10 now say so.

## What it costs

A leader cannot read the Cell of somebody who has left their scope, because the route asks
about now.

## What this does not settle

- **Whether a Cell's leader is a member of their own Cell**, which `CLAUDE.md` records as
  open. The route returns membership and leadership apart, so a leader with no membership
  row reads as leading their Cell and belonging to none, which is what the data holds today.
- **A person's Cell attendance or Cell classification.**

---

Decision 0248, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-15 — One person's DCC attendance is read under `dcc.view_subtree`, and their classification comes with it](0247-one-persons-dcc-attendance-is-read-under-dcc-view-subtree.md)
