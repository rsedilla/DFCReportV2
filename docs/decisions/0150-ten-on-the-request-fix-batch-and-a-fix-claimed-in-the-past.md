# 2026-08-30 — Ten on the request fix batch, and a fix claimed in the past tense that was never made


Second pass, scoped to the first batch's fixes. Both live mechanisms it introduced — the
self-naming domain check and the nil-target answer for an absent Cell — were traced at
every scope value and confirmed correct, and the Stop Condition the first pass offered is
confirmed not to be one. Every finding is a statement, a rule left unamended, or a test
that does not pin what it names.

**Three docblocks still said the prohibition was enforced by the scope value, and the
entry recording that said it in the past tense.** The previous entry listed "three
docblocks asserted the prohibition was enforced by the scope value" among the things the
batch addressed; the commit touches none of them, and one of the three sits thirty-three
lines above the check that replaced it, in the same method. That is worse than the class
it belongs to: not a wrong reason, but a fix claimed and not made — the same shape as the
orphaned docblock recorded on 2026-08-29, and the reason this log's "written to §x" habit
keeps costing passes.

**Section 7 still stated the mechanism the fix stopped relying on, and was not amended in
the same change.** It said `SUBTREE_EXCL_SELF` "exists for the one case where a scope
value genuinely does the work", which tells the next implementer the domain check is
unnecessary — while section 10 carries the rule requiring it. Section 10 *was* amended in
that commit for a smaller point, so the amendment was in scope and was simply not made.
Section 7 now says the scope value is chosen to match the prohibition and does not enforce
it, and why: a wider grant is an ordinary row, and the rule refusing a grant for being too
narrow has no counterpart refusing one for being too wide.

**The reason given for the note defect was false, and it travelled into four places.**
The claim was that `@ValidateIf` false makes "every decorator" inert, so the note was
"stored untrimmed". `@Transform` is a `class-transformer` decorator and `ValidationPipe`
runs `plainToInstance` before `validate`, so the trim ran regardless — reproduced, the
5,000-character note was stored **trimmed**. The defect was the missing bound and not the
missing trim. The same file says the true version twenty lines below, in `CloseCellDto`,
which is where the shape was copied from. Corrected in the DTO and the test comment; the
commit message is immutable and stands wrong.

**A correction introduced a new false statement, one sentence over.** Replacing the
`NETWORK` overstatement, section 10 gained "`OWN_SUBTREE` is the scope every role holds it
at by default" — false: `cell.manage_lifecycle` is Whole Church for Admin and the Senior
Pastors and `OWN_SUBTREE` for Leader alone, and read literally the sentence makes two of
section 10's own four named holders unreachable. And the service docblock grafted the
`NETWORK` correction onto the superseded sentence instead of replacing it, so it asserted
and denied the same claim four lines apart.

**The tie-break mutation was a coin flip presented as a pin.** With `gen_random_uuid()`,
which row sorts first is chance: measured over forty runs, dropping `ORDER BY id` still
returned the lowest-id row first in twenty-four. The ids are written now and inverted
against insertion order, so a plan returning insertion order disagrees every time —
verified ten times out of ten. This repository has recorded twice before that a mutation
caught two runs in three is not a pin, and shipped a third.

**The cursor's format guard depended on a deployment setting nothing pins.**
`cast(requested_at as text)` renders according to the session's `DateStyle`, which this
repository never sets and which the deployment controls — this machine's server already
runs `ISO, DMY` rather than the default `ISO, MDY`. Under `SQL`, `Postgres` or `German` the
server emits a cursor its own decoder rejects, so the client is served page one for ever,
silently. Measured across all four styles. The key is now `to_char` with an explicit
format, which is `DateStyle`-independent, and ISO 8601 parses back the same way under any
of them because it is unambiguous. A case pins it by paging under `German, DMY`.

*The time-zone half is right and the reason first given for it was the superseded one.
Those three offsets — `+00`, `+05:45`, `-02:30` — were properties of the pattern that was
deleted. The one that shipped accepts no offset at all, because `at time zone 'UTC'` in the
`to_char` makes the key zone-independent and it always ends `Z`. Right answer, wrong reason,
in the entry recording wrong reasons.*

**Two smaller ones.** The new constant was inserted between the module docblock and the
interface it documented, leaving the block dangling above a regex — the orphaned-docblock
shape again, one batch after it was recorded. And `NIL_PERSON` was a second copy of the
guard's `NIL_UUID`: two sentinels with a rule attached, free to drift. It lives in
`common/identifiers.ts` now and both call sites import it, which is what
`CURSOR_MAX_LENGTH` already did for the same reason.

---

Decision 0150, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-30 — Section 10's "at any scope" was resting on a scope value](0149-section-10s-at-any-scope-was-resting-on-a-scope-value.md) | Next: [2026-08-30 — Four on the second fix batch, and a pin that pinned nothing](0151-four-on-the-second-fix-batch-and-a-pin-that-pinned-nothing.md)
