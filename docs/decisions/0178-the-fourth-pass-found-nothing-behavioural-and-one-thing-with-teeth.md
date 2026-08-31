# 2026-08-31 — The fourth pass found nothing behavioural, and one thing with teeth

The fourth `architecture-guardian` pass on the DCC recording slice reported **no
behavioural defects**. After 11, 8 and 6, that is the first batch on this branch to
introduce none — and it is recorded because the decision to stop reviewing rests on
it.

Its four findings were one enforcement gap and three documentation defects. The gap
is the one worth a ruling.

## The contiguity invariant gets a constraint, and the reason is its own history

Decisions 0176 and 0177 both declined to enforce chain contiguity in the database, on
the ground that "a between-row check would be a trigger". That is not a reason in this
schema: it already carries constraint triggers for the same-Network edge and for
refusing attendance against a `NOT_HELD` meeting. *An earlier version of this sentence
enumerated the no-delete rule with them — that is five plain `BEFORE DELETE` triggers,
not constraint triggers. The count was right and the kind was not, and the argument
survives without it.*

**The invariant shipped broken twice in two commits, and nothing could fail on it
either time.** First the successor's `recorded_at` fell to the column default —
`now()`, the transaction's start, while the close happened at `clock_timestamp()`
during it. Then the closing instant was carried back through the application to fix
that, and node-postgres truncated its microseconds to milliseconds. Decision 0177 says
in terms why the second survived: "**There is no constraint for this**, which is why it
survived."

That sentence is an argument for the constraint, written as though it were an
explanation for its absence. **Migration 0013** adds it: a deferred constraint trigger
on both attendance tables asserting that where a row names a `superseded_by`, that
successor's `recorded_at` is this row's `superseded_at`.

Deferred, because the successor does not exist when the predecessor is closed — the
same reason `superseded_by` is a deferred foreign key. Validated by an explicit scan
before the triggers are created, because PostgreSQL does not apply a trigger
retroactively the way `ADD CONSTRAINT` validates a `CHECK`, so a deployment holding an
overlapping chain would install this and keep it silently.

**It refused five test cases on the day it was added** — three in
`test/database/attendance.spec.ts` and two in `test/api/dcc-attendance.e2e.spec.ts` —
across six fixture write sites. Two of those cases, and three of those write sites,
were written by the commit that removed the overlap from the service.

*Stated in one unit, because the first version of this paragraph mixed them: it said
"five fixtures, three of them", which is true of neither count.* Cases refused: five, of
which two came from that commit. Write sites **refused**: six, of which three came from
it — and five were corrected, the sixth being the self-reference below, which was
exempted rather than changed.

Four of the six left the successor's `recorded_at` to the column default after closing
at `clock_timestamp()` — the exact shape the service comment six lines away calls out.
The fifth, the zero-length case, set both ends from a host `Date` literal and was
refused for the default alone. The sixth is the self-reference below, which is not a
defect.

That is the third time on this branch a host-or-transaction instant has been written
where a database instant was meant, and the first time something other than a reviewer
caught it.

## A record closed with no replacement has no shape

One of the five was not a defect. `test/database/attendance.spec.ts` supersedes a Cell
attendance row onto **itself**, because Section 13 requires a `RESCHEDULED` meeting to
become `NOT_HELD` "preserving both records" — and a `NOT_HELD` meeting carries no live
attendance, so the attendance must be closed with nothing replacing it.

`..._supersession_is_whole` (migration 0011) requires a `superseded_by` wherever
`superseded_at` is set. It was written as an equivalence because `superseded_by` "holds
the id of the row that replaced this one", and a close with no replacement looked like
an incomplete write. It is not: it is the one operation Section 13 names that has no
successor.

**The trigger exempts a self-reference by name**, and says why. Refusing it would make
a path Section 13 requires unwritable, while nothing had decided it should be. Whether
the pair constraint should permit a null `superseded_by` instead is recorded as open —
it belongs to the slice that builds Cell recording, which is the first thing that can
reach the path at all.

## Three documentation defects, and what they have in common

- **Section 14 received the formulation Section 22 repudiates, in the same commit that
  wrote both.** §22 says the outcome is decided by what the loser finds when it
  re-reads, "which is not the same question as what the winner wrote"; §14 was
  corrected to say it depends on "what the winner recorded". The false model is the one
  that produced the deleted test two passes earlier, and it was reinstated in the
  authority document by the change correcting it.
- **A comment described a `RETURNING` the same commit had deleted**, and named it "the
  whole of the enforcement" — reading, to a maintainer, as an instruction to restore
  the truncation defect.
- **The contiguity assertion turned on `IntervalStyle`.** It compared the gap's
  rendering to `'00:00:00'`, which is `0` under `sql_standard`; the pool pins
  `DateStyle` alone. Third rendering-dependent comparison on this project. It now
  compares booleans, which have no rendering.

All three are the same defect this log keeps recording: a rule that is right beside a
statement about it that is not. Two of the three were introduced by the batch that
fixed the previous pass's findings.

## What four passes have now confirmed

Recorded so a fifth need not re-derive it: the refusal ordering, the unchanged-line
exemption, the single on-behalf correction entry, the responsible-leader freeze on
every path, the capability reorder changing only which refusal is seen, the
`RESOURCE_BUSY` path being unable to lose one person's conflict behind another's, the
`violatedConstraint` narrowing, and the version check having exactly one definition and
two callers.

**The findings converged**: 11, 8, 6, then none behavioural. That is the signal to
stop, and it is a measurement rather than a judgement — which is the whole reason each
pass was asked to say plainly whether it found anything behavioural.

---

Decision 0178, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Six on the third pass, and a fix that was never applied](0177-six-on-the-third-pass-and-a-fix-that-was-never-applied.md) | Next: [2026-08-31 — A symmetry that was not there, and the index a claim needed](0179-a-symmetry-that-was-not-there-and-the-index-a-claim-needed.md)
