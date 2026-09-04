# 2026-09-04 — A format validator must not throw on a value it refuses

Decision 0198 bound every field that accepts arbitrary text to refuse text the database
cannot store, and deliberately said nothing about fields constrained to a *format* — an
email address is not a field that accepts arbitrary text, so the rule did not reach it and
the coverage check skips it by design.

The review of that ruling then reproduced the consequence: **every `@IsEmail` field answered
`INTERNAL_ERROR` on an unpaired surrogate**, and two of the three routes carrying one are
unauthenticated. Signing in and asking for a password reset were the only defects of this
class in the system reachable by somebody with no account.

## The mechanism is not the database

`validator`'s `isEmail` calls `encodeURI` inside its own length check, and `encodeURI` throws
`URIError: URI malformed` on a lone surrogate. So the failure happens *inside the validator*,
before any question about storage arises — the value never reaches a statement. A null byte
in the same field was always refused cleanly at 422.

That distinction matters, because it rules out the fix that looks obvious. **Decorator
ordering cannot help**: class-validator runs every validator on a property and collects their
answers rather than stopping at the first refusal, so putting `@IsStorableText` in front of
`@IsEmail` leaves `isEmail` running and throwing anyway.

## The ruling

**A validator that constrains a format must be able to evaluate every value it is given, and
must refuse rather than throw.** Where the format library cannot, the guard belongs *inside*
the same validator, ahead of the call that throws.

`IsEmailAddress` is `isStorableText(value) && isEmail(value)`, in that order, in one
validator. `&&` never evaluates the second on a value the first refuses, and the result is a
single answer — `VALIDATION_FAILED` naming the field, which is what a client can act on.

Section 22 states this beside the storability rule rather than as a separate one, because it
is the same rule reaching a field the first form of it could not describe: a format-checked
field stores a `text` column like any other, and a format that cannot be *evaluated* on a
value is a worse failure than one that rejects it.

## What this does not claim

**The coverage check still cannot see these fields, and that is not a gap this ruling
closes.** Decision 0198's check classifies a property as free text by asking whether it
accepts a harmless string; `email` refuses one, so it is skipped — correctly, since the
storability decorator is not what belongs on it. So the enforcement here is three call sites
and a decorator, with the test that pins them, rather than something derived.

Worse, and recorded rather than left to be discovered: if an email field ever *did* accept a
harmless string, the coverage check would not fail — it would throw `URIError` out of
`validate()` and take the suite with it. That was reproduced while instrumenting the check
during the review of 0198.

**`isEmail` is the only validator in this codebase that throws, and that was measured rather
than reasoned.** Twenty-two distinct validation decorators are in use across the DTOs; every
library-backed one was called directly with a lone surrogate and with a null byte, and
`isEmail` on a surrogate was the single failure. `isDateString`, `length`, `maxLength`,
`minLength`, `matches`, `isUUID`, `isInt`, `isIn`, `isBoolean`, `isArray` and `isObject` all
answered normally on both.

*A draft of this paragraph named five decorators as "the others" and omitted `@IsDateString`
along with fifteen more. The conclusion survived the recount, which is luck rather than
method: the list was written from memory in a ruling whose whole subject is a rule applied
from memory.*

That is a fact about today's decorators rather than a guarantee about future ones, which is
why the rule above is stated over behaviour — *must not throw* — rather than over a list of
libraries. A validator added next year is bound by it without anybody remembering to check
this file.

---

Decision 0200, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — Three refusals that belonged at the edge](0199-three-refusals-that-belonged-at-the-edge.md)
