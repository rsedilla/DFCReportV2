# 2026-09-01 — A migration is frozen by merging, not by its number, and two on the seventh pass

The seventh `architecture-guardian` pass was scoped to one commit, as the sixth
recommended. It found **one behavioural defect**, and verifying it turned up a second
that it had not looked for. Both are in migration 0013, and fixing them meant editing an
applied migration for the third time on this branch — which is the ruling below, made
because the previous two edits were made without one.

## The exception was about the filename; the reasoning was about the fact

The ruling of 2026-08-21 permits `0001_foundations.sql` to be corrected in place "until
first deployment". Its argument is not about `0001`: it is that no durable database has
applied the file, that CI builds the schema from empty, and that the alternative is
carrying a corrective migration "that exists only because of the order we happened to
review in". Every word of that is true of `0011`, `0012` and `0013`, which exist on one
unmerged branch.

**The narrow reading has been applied four times, and every one of them turned on the
migration being merged rather than on its number.** Decision 0109 on migration `0005`:
"it is merged, and only `0001` may be corrected in place". Decision 0115 on `0007`: "It
is merged and applied". Decision 0133 on `0005` and `0006`: "are merged, so those
comments now name something that does not exist". Decision 0149 on `0009`: "The
migration is merged and only the first may be corrected in place". Four rulings reached
for the filename as the rule while citing merging as the fact, and **not one of them
refused an in-place edit to an unmerged migration**, because none was ever asked to.

So this widens the exception to what those four were already deciding: **a migration not
yet merged to `main` may be corrected in place; a merged one is frozen.**

**It is a loosening, and saying otherwise would be arguing past the cases it changes.**
An earlier version of this paragraph called it "a clarification rather than a loosening",
on the evidence that it changes the answer in none of the four cases that have arisen —
which is evidence selected to exclude the cases where it differs, because all four concern
merged migrations and those are exactly the ones both rules answer identically. The cases
it changes are `0011`, `0012` and `0013`. Under 2026-08-21 the three edits made to `0013`
on this branch were forbidden; under this ruling they are permitted, which is why this
ruling exists and is stated in the opening paragraph. What the four citations establish is
narrower and still worth having: the line being drawn here is the one those rulings were
already reasoning from, so no earlier decision has to be reread or reversed.

**Merging rather than deployment, and the difference matters now.** 2026-08-21 said
"until first deployment", which was the same line while nothing had been merged and
nothing deployed. They have since come apart: **ten** migrations are merged, `0001`
through `0010`, and nothing is deployed — so a deployment-shaped rule would still permit
editing `0010` today. Merging is also the observable event: after it the file is what
every other branch builds from and what a reviewer has already read. Before it, a
migration exists only on the branch writing it.

The cost is unchanged and is the mechanism: a developer who applied the file locally sees
`migrate:up` refuse the changed checksum and rebuilds. `scripts/migrate.ts` said so in
the words of the narrow rule and now says it in the words of this one — a fourth site,
found by grep rather than by reading, which is what the method note about rules living at
three to five sites is for.

**Migration `0006`'s own comment still says "only 0001 may be corrected in place".** It
is merged, so this ruling freezes it exactly as the old one did, and its conclusion — that
the correction goes elsewhere — is unchanged. It stands, as `0005`, `0007` and `0009`
stand.

## The index refused what the exemption exists to permit

`cell_attendance_one_successor` was created `WHERE superseded_by IS NOT NULL`. Section 13
requires a `RESCHEDULED` meeting later declared `NOT_HELD` to preserve both records, and
a `NOT_HELD` meeting carries no live attendance — so its attendance is closed with nothing
in its place, which the schema can only say by having the row name itself. The trigger
exempts that. The index did not, **and a unique index cannot be deferred.**

Take a record corrected once: the predecessor names the successor, the successor is live.
Close the successor with nothing replacing it and two rows carry the same `superseded_by`
— the predecessor's pointer and the successor's self-reference. The index refuses the
second write.

So the path was writable only for a record that had never been corrected, which is not a
distinction section 13 draws. It survived because the case covering the shape happened to
use an uncorrected record. Migration 0013's own prose had already written the argument
against it, one screen up: the exemption exists "because refusing it would make that path
unwritable while nothing had decided it should be". The index reinstated that refusal one
constraint over, in the batch that wrote the sentence.

The predicate is now `superseded_by IS NOT NULL AND superseded_by <> id`, which is what
the index was always meant to say: of the rows naming a *different* row as their
successor, at most one names any given row.

**The pass argued this made the open question blocking. It does not, and the distinction
is worth stating.** Whether `superseded_by` may be null where `superseded_at` is set is
still open, and the predicate is neutral to every answer it might take: if a null is
permitted, `IS NOT NULL` already excludes those rows and `<> id` is vacuous; if the
self-reference stays the documented idiom, `<> id` is exactly right; if the operation gets
a column of its own, vacuous again. What the pass found was a defect against the shape as
it stands, not a position taken in advance of the ruling — and the fix is available
without anticipating one.

## Section 9 was enforced by a side effect, and very nearly not at all

Found while verifying the above rather than reported by it. The sixth pass had narrowed
the self-reference exemption to `cell_attendance`, on the correct ground that section 9
says `NOT_HELD` "has no DCC equivalent" and that leaving DCC exempt left the section
resting on nobody writing the row. The narrowing refused most of the DCC shape and not
all of it.

A self-referenced row is compared against **its own** `recorded_at`, which differs from
its own `superseded_at` on any close of non-zero length. A close where the two are the
same instant compares equal and raises nothing — `period_ordered` is `>=` deliberately,
`supersession_is_whole` has both columns set, and `dcc_attendance_one_live` excludes a
superseded row. The row exists, is not live, and never was, which is exactly the premise
section 9 leans on.

**What was reachable was narrower than that, and by the same qualifier as the Cell
defect.** For a record already corrected once, the predecessor names the successor and the
self-closing successor names itself, so both carry the same `superseded_by` and
`dcc_attendance_one_successor` — bare `IS NOT NULL` — already refused it. The gap was a
**first** record for a person at an event, closed at zero length. Narrow, and still a case
where section 9's premise held because nothing had written the row. *An earlier version of
this paragraph said the shape "passed every constraint in the schema", which is the
unqualified form of exactly the claim this entry records the Cell index shipping on.*

The refusal was a side effect of a comparison rather than a rule about a shape. It is now
stated as the rule it is: a `dcc_attendance` row naming itself is refused because it is
one, at any length. The existing case pinned the non-zero-length variety and was named
wider than it pinned; a second case pins the rest, and the first now asserts the new
message rather than the contiguity one.

This is the same pattern the sixth pass recorded and one layer down: a rule was made true
of every case but one, and the sentence claiming it was enforced was written in the same
change.

## The validation scan, and the two counts

The migration's scan is what makes it reversible, because PostgreSQL does not apply a
trigger retroactively. Section 9's refusal is scanned for separately, because the
contiguity comparison passes a self-reference whenever its two ends are the same instant.
The DCC contiguity query now excludes self-references as the Cell one does, for the
opposite reason — not because the shape is blessed here, but so that it is reported by
the section 9 scan in section 9's terms rather than as a chain that "overlaps or gaps",
whose stated remedy is to move an instant and is no remedy for a row that should not
exist.

*An earlier version of this paragraph, and of the comment above the block, said the DCC
half "no longer carries" the exemption — the reverse of what the diff does, which is to
add it. Both were written from the rule the two tables differ on rather than from the
query beneath them. The fifth pass found a defect in this same paragraph, and the seventh
found it stale; this is the third.*

**Neither of those two scan changes has anything that can fail on it**, and the mutation
list below should not be read as covering them. Pinning a validation scan means seeding
data that violates the rule and re-running the migration, and the trigger now refuses that
data on the way in — so the shape cannot be created through the suite to be scanned for.
The pre-existing contiguity scans are unpinned for the same reason, so this is not a
regression. It is disclosed because a rule added in a commit whose subject is rules
enforced by side effect should say which of its own rules nothing enforces.

Two prose findings, one on decision 0179 and one on the commit message carrying it. The
message said **three** new database cases where two were added — the Cell-branch mirror
case belongs to the commit before it, and the `it(` count in `attendance.spec.ts` goes 22
at `635c098`, 23 at `ca5e762`, 25 at `9a0048c`. *Written here first as "22, 23, 25 across
the last three commits", which was true in the message it was lifted from and false the
moment it moved into a file with a further commit after it. The commits are named
instead.* And 0179 said "A case pins each" of the two indexes when only the DCC one
had a case; the Cell one now has its own, and it goes red when the index is dropped. That
second one is the load-bearing half: an unpinned index is what let the defect above ship.

*The pass reported the miscount as appearing in both the message and 0179. It is in the
message only — `grep` finds no such claim in the decision — which is worth recording
because a review's own claims about the work are subject to the rule this log keeps
restating, and checking it cost one command.*

## Where the two rates now stand

Behavioural findings by pass: 7, 4, 4, 0, 1, 0, **1**. Claims about the work: 4, 4, 2, 4,
6, 3, **6**.

*The seventh pass found one behavioural defect. The section 9 defect above is not in
that figure and deliberately not attributed to it: it was found while reproducing the
pass's finding, by asking what else the narrowed exemption failed to refuse. The row
counts what each pass reported, and inflating a pass's figure with what verifying it
turned up would make the series measure two different things — which is the class of
error the previous entry's counts were corrected for.*

The stopping rule — two consecutive passes finding nothing behavioural — was met at the
sixth and did not survive the seventh, which is the second time on this branch that a
streak has broken on the pass after it was declared. The lesson is not that the rule is
wrong. It is that both times the defect was in the *fix* rather than in the original: the
fifth pass found one in migration 0013, and the seventh found one in the index the fourth
pass's finding produced. Every fix batch on this branch has introduced a defect of its
own, and a stopping rule counted over passes rather than over batches will keep meeting
that.

Five mutations were run against these fixes, each named and each caught with the case
count unchanged at 28: the Cell predicate reverted, the DCC refusal disabled, the
exemption widened back to both tables, and each index in turn not created.

---

Decision 0180, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A symmetry that was not there, and the index a claim needed](0179-a-symmetry-that-was-not-there-and-the-index-a-claim-needed.md)
