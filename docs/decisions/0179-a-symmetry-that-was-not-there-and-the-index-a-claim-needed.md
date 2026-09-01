# 2026-08-31 — A symmetry that was not there, and the index a claim needed

The sixth `architecture-guardian` pass found **no behavioural defect in application
code** — the second consecutive pass to do so. Its three findings were all about what
the schema and the specification *claim*, and the most serious was written into
`SKILL.md` §9 by the batch responding to the fifth pass.

## §9 does not have the exception §13 has, and I gave it one anyway

The fifth pass asked for a pointer, in §9 and §13, from `superseded_by`'s definition to
the open question about a record closed with nothing replacing it. §13's addition was
right. **§9's was not, and it contradicted two statements in its own section.**

- §9 says the three-status model "is specific to Cell meetings and does not apply to
  DCC. `NOT_HELD` in particular has no DCC equivalent." The path cited as the
  justification therefore cannot produce a `dcc_attendance` row at all. A removed
  Sunday keeps its event row and supersedes no attendance.
- §9's argument that a version sent for a person with no record is unreachable rests on
  "nothing removes a `dcc_attendance` row, so a live row exists once one ever has". A
  self-referenced close does not remove the row but does make it non-live, so the
  premise fails and a documented-unreachable refusal becomes reachable.

**This is decision 0100's pattern in its purest form** — reusing a shape without
re-deriving why it has that shape. The instruction was "add the pointer in §9 and §13";
§13's reason was checked and §9's was assumed from the symmetry of the request.

§9 now states the opposite, and states it because the symmetry is inviting: no DCC
operation closes a record with nothing replacing it, so a live row exists once one ever
has.

**And the trigger was narrowed to match.** Migration 0013's self-reference exemption
was written on both tables and is now on `cell_attendance` alone. Exempting DCC left
§9's premise resting on nobody writing the row rather than on anything refusing it —
which is the difference between an invariant and a habit, and the whole argument for
the migration existing. A case now pins it: a self-referenced `dcc_attendance` row is
refused, and it goes red when the exemption is widened back.

## A chain is a partition of time, and now something makes it one

Migration 0013's header claimed the two constraints "make an attendance chain a
partition of time rather than a set of overlapping intervals". They did not. Two
predecessors superseded onto **one** successor, each ending exactly where it begins,
satisfies contiguity pairwise and still overlaps — the structure was a DAG, not a
chain, because nothing constrained `superseded_by` to be unique.

Two answers were available: weaken the sentence, or make it true.
`dcc_attendance_one_successor` and its Cell twin make it true — partial unique indexes
over `superseded_by`, which `CREATE UNIQUE INDEX` validates against existing data as it
builds. A case pins each, and dropping them turns it red.

*Neither half of that last sentence was true when it was written. Only the DCC index had
a case; the Cell one had none, so dropping it left the suite green — and the Cell index
as written was itself the defect decision 0180 records, refusing section 13's
close-with-no-replacement path on any record already corrected once. The claim that a
case pinned it is what would have caught the defect, and it was made instead of the case.
Both now exist, and both go red when their index is dropped.*

That is the better answer here for the reason this whole migration exists: the claim
was load-bearing, and the alternative was a third sentence disclosing a third residual
in a file whose subject is a residual that shipped twice.

**One residual is disclosed rather than enforced**: nothing requires a successor to
concern the same event and person as the row it replaces. Unreachable — the service
mints a fresh successor per correction and writes both from one line — and named so the
next reader knows the file constrains the shape of a chain and not its subject.

## The word in the sentence whose job was to be checkable

Decision 0178's corrected counts said "Write sites corrected: six", four lines above
"The sixth is the self-reference, which is not a defect". Five were corrected; six were
refused; the sixth was exempted. One verb, in the sentence rewritten one pass earlier
precisely so the units would be checkable.

## Where the two rates now stand

Behavioural findings by pass: 7, 4, 4, 0, 1, 0. The one at pass five was in a `DO`
block that never persists into a schema, and it was found because that pass read the
whole migration rather than the diff.

Claims-about-the-work findings: 4, 4, 2, 4, 6, 3. Not declining, and this pass's are
the same three shapes as every previous batch's — a symmetry assumed rather than
derived, a property of the callers stated as a property of the schema, and a count that
did not survive being checked.

*That row said "4, 4, 3, 2" when this file was written: four numbers for six passes,
neither of them the pass's own total minus its behavioural count, and the commit
message carrying the same file said "4, 4, 2, 3, 2, 3" — six numbers, disagreeing with
the four beside them and with the reports. Every figure is recoverable in one line from
the decision that recorded the pass: 0175 says "eleven — seven behavioural, four
prose"; 0176 "eight — four behavioural, four prose"; 0177 "four of its six"; 0178 "its
four findings" against no behavioural defect; the fifth pass one behavioural and six
further; this one three against none. The counts were written from memory of the passes
rather than from the files that recorded them, in the same paragraph whose subject is a
count that did not survive being checked, and they were caught by the author rather
than by a seventh reader. The behavioural row, 7, 4, 4, 0, 1, 0, was checked and is
right.*

The behavioural work has converged. **The prose has not**, and the honest reading is
that it converges more slowly because every batch writes new prose about what it just
did, and a claim about a change is written at exactly the moment its author is least
able to check it.

---

Decision 0179, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — The fourth pass found nothing behavioural, and one thing with teeth](0178-the-fourth-pass-found-nothing-behavioural-and-one-thing-with-teeth.md) | Next: [2026-09-01 — A migration is frozen by merging, not by its number, and two on the seventh pass](0180-a-migration-is-frozen-by-merging-not-by-its-number.md)
