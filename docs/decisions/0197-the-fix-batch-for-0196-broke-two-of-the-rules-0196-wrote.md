# 2026-09-04 — The fix batch for 0196 broke two of the rules 0196 wrote

`CLAUDE.md` requires a review of the fixes made in response to a review, and gives the
reason: measured on this repository, every fix batch has introduced defects of its own. The
tenth pass reviewed the batch that closed the ninth's findings. It found eleven things. One
was behavioural, one was a checkable claim the same batch refuted, and one reintroduced —
inside the commit recording decision 0196 — the exact shape decision 0196 exists to condemn.

That last one is the reason this file exists rather than a line in a commit message.

## The regression: a field that reached a column for the first time

Decision 0196 made an unchanged-roster reschedule write `correction_reason` into
`cell_meeting_changes.note`, where before it was written nowhere. That was the fix. It also
made the field reach a `text` column on that path for the first time, and `text` refuses
two things a JSON string may legally carry:

- **U+0000.** PostgreSQL rejects a null byte outright.
- **A lone surrogate.** Not well-formed Unicode, so it has no UTF-8 encoding for the wire.

`correction_reason` carried `@IsString()` and `@MaxLength(500)` and nothing else, so a body
answering `201` on `11c7226` answered `500 INTERNAL_ERROR` on the fix — Section 22's named
failure mode, introduced by a commit whose subject was closing that failure mode.

Three more instances of the same class were already reachable and were not found by the
audit that produced 0196: `correction_reason` on a plain correction, on a move that changes
a line, and `not_held_note` on a `NOT_HELD` transition. **The audit could not have found
them.** It enumerated every constraint on the three attendance tables, and none of these is
constraint-driven — they are the column type refusing a value. The audit's scope was
constraints and its conclusion was written about the route.

**The ruling: free text is refused at the edge, on every field of a route rather than the
one that broke.** `@IsStorableText` (`common/text/is-storable-text.ts`) is applied to
`correction_reason` and `not_held_note` together, and answers `VALIDATION_FAILED` with the
field named. Refused rather than stripped: no section gives a null byte a meaning, so there
is nothing for a domain layer to decide, and stripping it would store text nobody wrote.

Applied to both fields on the evidence of this same file's history — the null class took
four fixes because each closed one read and left the next open — and stated here so the
next free-text field on this route is written with the decorator rather than without it.

## The claim the batch made that the batch refuted

The batch added to `CLAUDE.md`, of the `facilitated_by` foreign key:

> So the five-500 family that shaped this route is closed, and this bullet is the whole of
> what remains of it.

False in four places at the moment it was committed, by the count above. It is the sentence
a later reviewer trusts *instead of* re-checking, which is what makes it worse than the
defect it described. It now says what was actually established — that there is no sibling
**among the constraints** — and records what it originally claimed and why that was wrong.

## The shape 0196 condemned, reintroduced in the commit that condemned it

Decision 0196's first half rules that Section 13's `NOT_HELD` refusal "is a property of the
status and not of the path that reached it", because it had been enforced on one path and
not its neighbour.

The same batch added a blank-note rule to Section 13 — "A note that is blank is a note
nobody wrote, and is stored as absent" — and implemented it for `correction_reason` alone.
The comment justifying that gave a false premise: that `assertNotHeldIsExplained` "has
already refused a blank one where section 13 requires it, and where it does not require one
the field is absent". It refuses a blank note only where the reason is `OTHER`. So
`LEADER_UNAVAILABLE` with a note of `"   "` met nothing and stored the whitespace.

One rule, two fields, one enforced — written into the specification as a general rule, in
the commit ruling that a general rule must not be enforced on one path only.

**The ruling: blankness is normalised at the route's door, for every free-text field at
once**, alongside the null normalisation that is already there and for the same reason. The
one-write-site helper is gone. Section 13 now states the rule of both fields explicitly,
because stating it generally is what failed.

Nulls are stripped from the whole body and blankness is named field by field, and the
difference is deliberate: null and absent mean one thing on every field here, while
blankness is only a question for prose. Every other string on this DTO is a format, and a
blank one is better refused by its own decorator with a message naming the format than
silently dropped.

## Eight claims, and the arithmetic

The pass also found: a `SKILL.md` cross-reference pointing "below" at a block fifty-five
lines above; an ordinal collision, where "the sixth constraint-driven 500" was claimed by
`CLAUDE.md` for one thing and by decision 0196 for another, in the same batch; a false
citation naming `people.dto.ts`'s reasons as refusing blankness when they carry
`@Length(1, 500)` and accept `"   "`; and `blankToNull` inserted between `withoutNulls`'s
docblock and `withoutNulls`, so the paragraph the batch had just corrected — about which
function it describes — came to sit above a different function. Each is corrected.

The ordinal is dropped rather than renumbered, which is what this log does with an ordinal
whose only content is a number. The bullet count is not, because it is one command.

## What was checked and was sound

Recorded because a review that reports only defects gives no signal about the rest. The
reachability argument behind calling the roster assertion unconditionally was derived
independently and holds, from `classifyOperation` and from `transitionWithin`'s parameter
type both. Migration 0014 adds no constraint, drops no column, rewrites no row, touches none
of the snapshot-and-reconcile tables, and round-tripped up-down-up on a scratch database with
its stated abort condition reproduced. The correction path is byte-identical. Writing the
note discloses nothing: `cell_meeting_changes` is read by no route, so the column is
write-only until a change-history read exists, at which point it becomes a Section 7
question. Section 21 asks for no reason on `cell_meeting.rescheduled`, so leaving the audit
entry's reason null is what it wants.

## One thing fixed that is not this branch's defect

The full suite was not reproducibly green. `resetRateLimits` cleared the throttler's
storage map without cancelling the 60-second timers whose callbacks read it, so each one
destructured `undefined` and threw into whatever case was running a minute later — 15
failures in one file, none of them about rate limiting, and only in a run long enough to
reach the first timer. That is why the file passed alone and failed in a full run, and why
one full run of this branch reported 1249 passing and another reported 15 failed.

Pre-existing on `main` and fixed here anyway: a suite whose result depends on how long the
process has been alive cannot support a Definition of Done that turns on it, and "four gates
green" is a claim this project makes in commit messages.

---

Decision 0197, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — Two the ninth pass found, and a Section 13 clause the schema could not hold](0196-two-the-ninth-pass-found-and-a-clause-the-schema-could-not-hold.md)
