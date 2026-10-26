# 2026-10-26 — One refusal for anybody outside your scope

Owner ruling, 2026-10-26, agreed as the follow-up to decision 0389. It amends that ruling's
fourth point and settles the open question of what Section 8 permits a refusal to reveal by its
existence, for the one route it was asked about.

## The ruling

**1. Adding somebody the actor does not oversee to a Cell is refused with one answer, whether or
not they are in a Cell.** On `POST /api/v1/cells/{id}/members`, when the actor's
`cell.manage_membership` does not cover the person and the actor may not move them, the answer is
`SCOPE_DENIED` with the words decision 0389 gave the in-no-Cell case and empty details. That
covers somebody in no Cell, as before, and now somebody in a Cell: for a Leader without *Moves
people* the refusal was the move's `CAPABILITY_DENIED`, and for a ticked leader whose
`cell.move_members` does not reach the person's Cell a `SCOPE_DENIED` with the move's own words
and `details.capability`. It is decided before the person is read and before any other refusal that
concerns them, so nothing that follows, not that the person is already in this Cell, nor that a merge
absorbed them, can tell the two apart.

**2. A move the actor may make is unchanged.** A ticked Primary still moves a member between two
Cells of their own branch whoever pastors them (decision 0389). That answer differs from the
refusal, and what it tells the actor, that the person is in one of their own Cells, those Cells'
rosters already show them.

**3. For somebody the actor oversees nothing changes.** The move's refusals keep their codes,
words and details, which the screen uses to say what the reader may do. Their Cell is visible to
the actor under `cell.view_subtree`, so the refusal discloses nothing new.

## Why

Decision 0389 refused somebody in no Cell before reading them, so a leader learned nothing from
that refusal. Somebody outside their scope who was in a Cell was still refused differently, so
the two answers side by side told the leader which of the two held a membership: for a Leader
without the tick, `CAPABILITY_DENIED` against `SCOPE_DENIED`, and for a ticked one the message and
`details.capability`. Section 8 forbids exposing Cell membership outside the actor's scope, and no
screen reaches either refusal since decision 0389, so the difference served nobody.

## What this supersedes

Decision 0389's fourth point where it left a move of somebody outside the actor's scope to the
move's own refusal. Section 10 is amended. The open question in `CLAUDE.md` of what Section 8
permits a refusal to reveal by its existence leaves, its subject being this route's refusal.

Decision 0390, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 10.

Previous: [2026-10-25 — Every search finds the searcher's own people](0389-every-search-finds-the-searchers-own-people.md)
