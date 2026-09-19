# 2026-09-17 — A report scope selector naming nobody answers `NOT_FOUND`, and scope is checked first

Section 7 makes a report's scope selector the target and says nothing about whether it must
resolve to anybody. `reportingSubtree` seeds its walk with the identifier unconditionally,
and `AuthorizationService.scopeMembership` answers `WHOLE_CHURCH` as "the absence of a
narrowing" rather than as a set — so a Whole Church holder naming any identifier at all
receives a well-formed report of zeroes, and a narrower grant is refused by scope before the
question arises.

`NIL_UUID` is accepted here too. `common/identifiers.ts` describes it as "a target that
resolves to nobody", and the capability guard and the leadership-request service both hand
it over precisely so that a request refuses. This is the one place in the application where
it means the opposite.

## The ruling

**1. A scope selector naming no Person answers `NOT_FOUND`.** A report is a figure about a
subject; where there is no subject there is no figure, and zeroes are an answer to a
question nobody asked.

**2. Scope is resolved first and existence second.** The order is the rule, not an
implementation detail. A narrow grant must keep receiving the refusal it receives today,
whether or not the identifier names anybody, so that each actor gets one consistent answer
and which one they get is decided by their own scope rather than by the record.

**3. It binds `CELL` selectors on the same terms.** A Cell that does not exist resolves
through nobody, so a narrower grant is already refused and a Whole Church holder receives
the same zeroes. One silence in two places is one rule, and this specification has paid
repeatedly for settling such a pair one half at a time.

## Why

**Because the screen that reaches this is a leader picker, and every selector it offers
exists.** The only way to arrive here is a stale identifier, a typed one, or a tampered one
— which are exactly the cases where `NOT_FOUND` helps and a confident report of zeroes
misleads.

**Because the ordering is already Section 22's rule rather than something invented here.**
That section settles it for a Cell in terms — "`NOT_FOUND` is therefore reached only by an
actor whose scope *would* have covered the Cell, for whom absence is genuinely absence" and
"each actor gets one consistent answer, and which one they get is decided by their own scope
rather than by the record". This ruling applies that to a report selector, which is the one
target kind reaching it that Section 22 had not been read against.
`GET /api/v1/people/{id}/pastoral-path` already implements it and says why in a comment.

**Because it discloses nothing, and the reason is Section 22's rather than the one first
written here.** *A draft grounded clause 2 on closing an existence oracle over every
identifier in the church. Section 22 refutes that for this target kind in one sentence —
"People are not such a case: Section 8 already discloses minimal identity church-wide by
design" — so a Person's existence is learnable anyway and the oracle was never the cost.*
What clause 2 protects is the consistency above: an actor's answer must depend on their own
scope and not on whether a record happens to be there.

**`VALIDATION_FAILED` was considered and refused.** The request is well formed and names
nobody, which is a different thing from being malformed; collapsing the two makes the error
say the wrong thing to whoever has to fix it, and Section 22 keeps that code for the shape
of a request rather than for what it refers to.

## What this does not settle

- **Whether `NIL_UUID` should be reserved**, which `CLAUDE.md` records as open and which
  this ruling narrows rather than closes: the sentinel is now refused where it is a report
  selector, and nothing says a Person may not hold that identifier.
- **What a report answers for a Person who exists and is outside the actor's scope.**
  Unchanged: `SCOPE_DENIED`, decided before existence is consulted.

---

Decision 0253, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-18 — The Network screen is a branch view, and it carries its figures with their month](0252-the-network-screen-is-a-branch-view.md)
