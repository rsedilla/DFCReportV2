# 2026-09-15 — A person's current Cell is read under `cell.view_subtree`

The People screens of the redesign show a person's Cell on their profile and on Edit, and
the move to another Cell starts from it. No route returns it. `GET /api/v1/people/{id}`
returns a person's own details and nothing about Cells, and every Cell route in Section 22
starts from a Cell rather than from a person.

## The ruling

**`GET /api/v1/cells/people/{id}/membership` returns the Cell a person currently belongs
to, with that Cell's current leader, or none.**

- **It is guarded by `cell.view_subtree`, resolved against the person.** Section 7 gives
  `cell.*` everything under `/api/v1/cells`, and `cell.view_subtree` is that domain's read
  capability.
- **It names no period, so it asks about now** (Section 7, *An effective date does not move
  the scope decision*). The actor must hold the person in scope today.
- **It returns the open membership only.** Section 10 gives a person at most one, and zero
  is legitimate, so the answer is one Cell or none.
- **It changes nothing.** A move is still an add on `POST /api/v1/cells/{id}/members`, under
  `cell.manage_membership` over both Cells.

## The ground

**The move needs a starting point.** Section 10 makes a move one change that closes the
current membership and opens the next, and a screen offering it has to say which Cell the
person is leaving.

**No role changes.** Every role in Section 7's catalog holds `cell.view_subtree` at the same
scope it holds `people.view_subtree`, so a reader who may open the profile may read the
Cell on it.

## What it widens

Section 10 makes membership independent of pastoral assignment, so a person in a leader's
scope can belong to a Cell whose leader is outside it. This route shows that leader the
Cell and its leader's name. This ruling is where that is chosen.

## What it costs

A leader cannot read the Cell of somebody who has left their scope, because the route asks
about now.

## What this does not settle

- **Whether a Cell's leader is a member of their own Cell**, which `CLAUDE.md` records as
  open. This route reads membership only, so a leader with no membership row reads as
  having none.
- **The Cells a person leads.** Section 11's leadership is a separate relationship and this
  route does not return it.
- **A person's Cell attendance or Cell classification.**

---

Decision 0248, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-15 — One person's DCC attendance is read under `dcc.view_subtree`, and their classification comes with it](0247-one-persons-dcc-attendance-is-read-under-dcc-view-subtree.md)
