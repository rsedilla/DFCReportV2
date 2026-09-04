# 2026-09-04 — Three refusals that belonged at the edge

Three items from the pre-Stage-5 backlog, each a well-formed request getting an answer that
was wrong about *why*. None needed a new rule so much as a rule applied where the request
enters rather than where it lands.

Five reachable `INTERNAL_ERROR`s were closed by decision 0198 and this one together. This is
the remainder.

## A facilitator must be a Person who exists

Section 13 makes `facilitated_by` nullable and defaulted, and `@IsUUID()` checks its shape.
Nothing asked whether the Person exists, so a well-formed body naming an absent one reached
`cell_meetings_facilitated_by_fkey` and answered `INTERNAL_ERROR`.

**The ruling: existence is refused, and refused by name.** `isForeignKeyViolation` joins
`isUniqueViolation` in `postgres-errors.ts`, and the branch narrows on that one constraint —
because the other three foreign keys on `cell_meetings` take server-derived values (the Cell
from the path, the responsible leader from the leadership lookup, the submitter from the
actor), so one of *those* failing is a defect and must keep failing loudly rather than being
reported to a leader as their typo.

**What the field may name beyond existing is deliberately left open.** Any Person, a member
of that Cell, or someone in the leader's subtree are three readings that refuse different
bodies, and `SKILL.md` says only "who conducted this meeting". Existence is what all three
share, so it is the part that can be enforced without settling the rest — and the narrowing
stays recorded in `CLAUDE.md` for the first screen that offers a facilitator picker.

This is translation rather than a pre-flight check, and that matters for a reason beyond
cost: `persons` belongs to the `people` module (Section 2), and a pre-flight would have been
`attendance` reading another module's tables. The constraint already knows the answer.

## An explicit null correction reason means the same as omitting it, on DCC too

`@IsOptional()` treats `null` as absent for the purpose of *skipping validation* and then
leaves the null in place, so `record.correction_reason !== undefined` was true of a line that
had said nothing — and a body meaning "no correction reason" was answered
`INVARIANT_VIOLATION` where omitting the key entirely answered 201. Two bodies with one
meaning and two answers, and the loud one belonged to the body that had said nothing.

**The ruling: the same normalisation the Cell route uses, in the shape this route's DTO
actually has.** The Cell submission carries its optionals at the top level and is normalised
there. Here the only per-line optional lives inside `records`, so the fix is per record — a
top-level sweep copied from the neighbour would have looked right and changed nothing.
Section 25 rule 19 asks *this had that shape because X; does X hold here?* — X is where the
optional fields sit, and it does not.

**`version` is excluded, and it is the one field where null and absent differ.** Section 22
makes a null version an assertion — "I read no record" — rather than a field the caller
declined to fill, which is why the DTO declares it required and nullable. Stripping it would
turn a claim about what the client read into silence.

## An element of a typed array must be an object

`@ValidateNested({ each: true })` recurses into an array-valued element, finds no declared
property on it, and passes. So `[[]]` reached the domain layer.

**The two routes then failed differently from the identical body**, which is what turned this
from a tidy-up into a ruling. The Cell roster refused it as "attendance is recorded only for
the Cell's own members" — a `422` wearing a `409`, naming a rule the request had not broken
and sending a client to the roster. The DCC checklist answered **500**.

*The open bullet described the Cell behaviour only, and called it "not blocking, no malformed
body is admitted". Half of that was wrong: the DCC path admitted the same body as far as the
database. It was found by running the mutation rather than by reading either route.*

**The ruling: the element type is checked at the edge, on both arrays.** `isObject` excludes
arrays by definition, so `@IsObject({ each: true })` refuses the shape as
`VALIDATION_FAILED`, naming the field, before any domain rule is consulted.

## What is not settled

Whether a refusal inside a nested object should name the member rather than the container
stays open, and this ruling makes it slightly more visible rather than worse: an element
refused by `@IsObject` names the array, as every nested refusal does. That is the error
filter's shape and is recorded separately.

---

Decision 0199, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — A field that takes text refuses what cannot be stored, everywhere, and a check derives where](0198-a-field-that-takes-text-refuses-what-cannot-be-stored.md)
