# 2026-09-09 — A leader lists the Cells of their scope, with a filter for their own

Every route under `/api/v1/cells` acts on a Cell whose identifier the caller already holds,
and nothing handed them one. Section 22's route table named no index, so
`GET /cells/{id}/meetings`, `GET /cells/{id}/members`, the meeting roster and both submit
routes were unreachable from a screen.

**`GET /api/v1/cells` lists the Cells whose leader falls within the actor's pastoral scope,
under `cell.view_subtree`, cursor-paginated. `?led_by=me` narrows it to the Cells the actor
personally leads.**

## Why the subtree, with the narrowing as a filter

Section 19 wants both. Its Cell-leader dashboard leads with "meetings awaiting a record, for
the user's **own Cells**", and its upline-leader dashboard leads with "Cells needing
attention **within their scope**". A route serving only the first cannot serve the second,
and two routes would put one scope rule in two places — which is the shape this repository
records against itself more often than any other.

**The filter is the narrower of two readings of one scope, not a second authorization.** A
Cell the actor leads is inside the actor's own subtree by definition, so `?led_by=me` removes
rows the caller may already see and grants nothing. Authorization is decided once, by the
capability, and the filter is a convenience over the result.

## Why `cell.view_subtree` and no new capability

It already exists, it is a **Read** capability, it is grantable `read_only`, and decision 0204
already moved `GET /cells/{id}/members` onto it on exactly this reasoning: roster visibility
guarded by a management capability could not be granted at all, because a management
capability granted `read_only` is refused at creation. A list of Cells is the same kind of
read as the roster of one, one level up.

Section 7's list is closed, and adding to it is an amendment rather than a decision taken in
a module. Nothing here needs the amendment, which is itself the argument: a capability that
already guards the neighbouring read is the one this route wants.

## What a row carries, and what it must not

Each row carries the Cell's identifier, category, schedule, current leader, and its coverage
line for the month asked about — **recorded out of scheduled, as two figures** (Section 12,
and Section 13's prohibition on a derived score).

**The list is never ordered by coverage, and no row is colour-graded.** Sections 13, 17 and
19 forbid ranking, scoring and colour-grading a leader, and a list of Cells ordered worst-first
is a leaderboard whatever it is called. Sorting is permitted where Section 13 permits it — a
leader's own Cells — and ordering leaders against one another is not.

## Pagination

Cursor, per Section 22, with no total. The church runs to hundreds of Cells rather than tens,
so this is a real collection rather than one bounded by arithmetic the way a month's meetings
are.

## What this does not settle

**Whether a closed Cell appears.** Section 7's base bullet keeps a closed Cell visible to the
leader who led it, and its closed-Cell clause says the opposite; that tension is recorded as
open in `CLAUDE.md` and this ruling does not touch it. The route inherits whatever that
question settles.

**The four routes Section 22 names and nothing implements** — `network/my-tree` and three
under `leaders/{id}` — which are My Network's API and remain unbuilt.

---

Decision 0226, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — A Cell that scheduled nothing stays in the coverage denominator](0225-a-cell-that-scheduled-nothing-stays-in-the-coverage-denominator.md)
