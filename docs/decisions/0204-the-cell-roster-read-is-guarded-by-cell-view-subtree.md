# 2026-09-04 — The Cell roster read is guarded by `cell.view_subtree`, and an undated viewing read asks about now

Decision 0203 found that `GET /api/v1/cells/{id}/members` is guarded by
`cell.manage_membership` while `cell.view_subtree` — in Section 7's list, named among its
Read capabilities, one of the three that resolve as of the period being viewed (decision
0186) — guards no route at all. It deliberately did not settle it, because changing which
capability guards a live route changes authorization and belongs in a change reviewable as
one. This is that change.

## The ruling: the roster read carries `cell.view_subtree`

Section 7 makes `read_only` valid only on a read capability. Guarded by a management
capability, roster visibility cannot be granted without the power to change the roster —
a grant of `cell.manage_membership` with `read_only` true is *rejected at creation*, so
there is no way to express "may see this Cell's members" at all. That is the defect, and
it is the same one Section 7 already fixed one route over when it took the meeting roster
off `cell.manage_membership`: "requiring it to record a meeting would mean nobody could
take attendance without also being able to move the roster."

Section 7's sentence closing that bullet — "This says nothing about
`GET /api/v1/cells/{id}/members`, which manages membership and stays where it is" — was
written while the reason to move it was believed unavailable. Decision 0203 refuted that
premise. The sentence is amended rather than left standing beside a route that no longer
matches it.

**It must precede Stage 5.** Stage 5 adds Cell-scoped reads, and the precedent they would
copy is whichever capability the one existing Cell-scoped read carries.

## What it does not change, measured rather than assumed

**No role gains or loses access.** `role-defaults.ts` gives `cell.view_subtree` and
`cell.manage_membership` the identical scope at all three roles — Whole Church for Senior
Pastor and Admin, own/subtree for Leader. Every account reaching this route today reaches
it after the swap, and no account reaches it that did not.

**Scope resolution is unchanged.** `CapabilityGuard` branches on the target's `kind` and
never reads the capability, so a `{ kind: 'cell' }` target takes `leaderForScope` under
either name. `leaderForScope` is the current leader falling back to the last where the
Cell is closed, which is what Section 7's base bullet prescribes for a Cell target.

So the whole behavioural change is which capability an *explicit grant* must name, and
that `read_only` is now expressible on it. That is the point of the change, and it is the
entire extent of it.

**The closed-Cell benefit is real but smaller than it looks.** Moving the route into the
viewing class removes it from the contradiction Section 7 states twice — the base bullet's
last-leader fallback against the closed-Cell clause's "every write against one resolves
through nobody" — so the base bullet now governs it cleanly. What that does *not* deliver
is a closed Cell's roster: closure sets `ended_at` on every membership, and this route
lists current members, so a closed Cell answers an empty list whoever asks. The open
bullet in `CLAUDE.md` loses one of its two routes; the contradiction itself survives for
`GET /api/v1/cells/{id}/meetings` and stays open.

## The tripwire this trips, and why it is narrowed rather than deleted

`capability-scope-resolution.spec.ts` asserts that **no route declares a viewing capability
against a Cell-resolved target**, on the ground that "a resolution 'as of the period being
viewed' does not exist yet, and the first Cell-targeted viewing route is what owes it".
This change is the first such route, so that case goes red. Neither decision 0203 nor the
open bullet mentions it.

**The obligation it names is not owed here, and Section 7 says why.** Under *An effective
date does not move the scope decision*: "'The period being viewed' is the period a request
under a viewing capability is asking about." A request carrying no period is asking about
**now**, and `leaderForScope` is the resolution for now. The dated resolution is owed by a
viewing read that asks about a *past* period — a report for March, a leadership as it stood
in a closed month — and this route asks about neither. The test conflated "declares a
viewing capability" with "asks about a past period"; those are different, and only the
second owes a resolution that does not exist.

**So the rule is narrowed to keep its teeth rather than dropped.** The case becomes an
allowlist holding exactly this route, with the period it asks about stated. Any *other*
Cell-targeted viewing route reddens it and its author has to say which period it asks
about — which is the whole value of the tripwire, preserved. A test that merely counted
would have been satisfied by the swap and by a dated report alike.

## What it does not settle

`GET /api/v1/cells/{id}/meetings` carries `cell.take_attendance` against a `cell` target
and is not touched. Section 7 gives that a deliberate argument — an attendance surface must
not require a capability the recorder need not hold — and moving it would be a second
authorization change in one branch. It remains the harder half of the closed-Cell fallback
question, and that bullet stays open naming it.

The two meeting routes `capability-scope-resolution.spec.ts` requires to carry identical
declarations are `CellMeetingsController.roster` and `.submit`. Neither is this route, and
the disclosure argument binding them is untouched.

---

Decision 0204, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — Two reporting rulings settled before Stage 5 code, and a third whose premise was wrong](0203-two-reporting-rulings-settled-before-stage-five-code.md)
