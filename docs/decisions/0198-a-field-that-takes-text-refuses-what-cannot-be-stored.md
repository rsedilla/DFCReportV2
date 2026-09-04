# 2026-09-04 — A field that takes text refuses what cannot be stored, everywhere, and a check derives where

Decision 0197 added `@IsStorableText` and applied it to one route. Its own docblock then
claimed a scope the code did not have — twice, in opposite directions — and `CLAUDE.md`
recorded the question this ruling answers: Section 22 names `INTERNAL_ERROR` on a
well-formed request as a failure mode and says **nothing** about what a free-text field may
contain, so the decorator had no derivable scope and was applied from memory.

Three reproduced `INTERNAL_ERROR`s were left standing on merged routes by that gap, and a
fourth class of harm was not an error at all.

## The two characters, and why they are not the same problem

- **U+0000** is refused by PostgreSQL: `invalid byte sequence for encoding "UTF8": 0x00`.
  Loud, and it surfaces as a 500 on a well-formed request.
- **An unpaired surrogate** is *accepted* and silently rewritten to U+FFFD by
  `node-postgres`. The request answers 201 and the stored record says a person wrote
  something they did not write.

The second is why this is worth a rule rather than three one-line guards. A 500 is visible
and gets reported; silent substitution in an audit reason or a person's name is not, and
Section 3's reproducibility guarantee and Section 21's audit both assume it does not happen.

*Both halves were measured against the database rather than reasoned about, after decision
0197 asserted the surrogate mechanism and was wrong.*

## The ruling

**A field that accepts arbitrary text refuses text the database cannot store as written, at
the edge, on every such field.** Section 22 states it; `@IsStorableText` enforces it. A
refusal is `VALIDATION_FAILED` naming the field.

Refused rather than stripped or substituted. Nothing in the specification gives either
character a meaning, so no domain layer has anything to decide, and accepting the
substitution stores text nobody typed. A valid surrogate pair is unaffected — an emoji is
two well-formed code units, and a note typed on a phone is the ordinary case.

**Nineteen fields were added to the three already carrying it**, twenty-two in total, counted
from the source rather than remembered: both Cell notes; thirteen `people` fields — eight
name fields across three classes (three `first_name`, three `last_name`, two `middle_name`),
three `mobile_number`, and the Network-change and backdate reasons; two `device_label`s;
DCC's `correction_reason`; and `SearchPeopleDto.q`.

## The check derives the list, and that is the whole point

The failure this ruling corrects was not that a field was missed. It was that the scope
lived in a docblock, so *being missed was undetectable*. A list maintained by hand would
have the same property.

`api/test/unit/storable-text-coverage.spec.ts` asks two questions of every property of every
DTO under `src`:

1. Does it accept a harmless string?
2. Does it refuse a number?

Both yes means the property is genuinely typed as free text — a UUID, a date, an enum and a
bounded number all fail the first, and a property whose validation is conditional on an unset
sibling fails the second. Such a property must then refuse a null byte **and** an unpaired
surrogate, or it is named in the failure.

Exemption is by appearing in `NEVER_STORED` with a reason, and every reason has the same
shape: the value never reaches a column as written. Four pagination cursors, which are
decoded before anything reads them and refused when unresolvable (decision 0159); two
refresh tokens and a reset token, compared against a hash; and two passwords, which Section
6 says are never stored at all.

**It found a field this ruling would otherwise have missed.** `SearchPeopleDto.q` is a search
term, not a stored value — and it reaches the database as a query parameter, so a null byte
in it answers `INTERNAL_ERROR` exactly as a stored field does. Nobody enumerating "free-text
fields that get written" would have listed it. The check did, on its first run.

The mutation is named where the file is written: remove the decorator from any one field and
the run goes red naming that field.

## What this does not settle

Whether a **name** has a maximum length stays open, and is a different question about the
same fields. Section 3 says a name may hold any character; this ruling narrows that to any
character the database can keep, which is a smaller change than it looks and does not touch
the length question recorded in `CLAUDE.md`.

---

Decision 0198, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-04 — The fix batch for 0196 broke two of the rules 0196 wrote](0197-the-fix-batch-for-0196-broke-two-of-the-rules-0196-wrote.md)
