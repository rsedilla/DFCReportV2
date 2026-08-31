# 2026-08-31 — Eight on the fix batch, and the outcome that was a 500

The second `architecture-guardian` pass reviewed the response to the first. It found
eight — four behavioural, four prose — and confirmed that the connection discipline
was complete, the reordering opened nothing, and every factual claim in the previous
commit that could be checked by grep was true.

**Three of the four behavioural findings were introduced by the batch that fixed the
first eleven.** That is the outcome `CLAUDE.md` records as expected, arriving for the
seventh consecutive round on this project.

Two of the eight changed a rule. The rest are recorded in the commit.

## 1. A rule split across two loops disagreed with itself

The first batch exempted an unchanged line from the version check, on Section 22's
text: a conflict carrying two identical values is not the choice Section 14 requires a
person to make.

It changed **one** of the two places that rule lives. `conflictAfterLostRace` — the
re-read after a submission loses the race on `dcc_attendance_one_live` — kept the
original comparison, so every conflict reported after a race reinstated exactly the
response the exemption exists to prevent, and a stale-but-agreeing line early in a
submission would mask the honest conflict about whoever actually lost.

**The check was to become one function both callers use.** Not as tidiness: the two
are the same rule at two moments, and nothing prevented them from being changed apart.
The first batch demonstrated that by changing them apart.

*It was not done in this batch, and this paragraph said it was.* The edit that would
have replaced the in-transaction loop was in a script that aborted on a later assertion
before writing anything; the function was added, one caller was moved to it, and the
commit message, this ruling and the function's own docblock all asserted a
consolidation that had not happened. Decision 0177 records it, along with the pass that
found it — the third false "this was done" claim on this project, and the second found
by a reviewer counting call sites.*

## 2. A lost race has a second outcome, and it was a 500

Factoring the rule surfaced a case neither loop had:

A submission loses the race, and by the time it re-reads, the winner has recorded the
value it was carrying. The line is now unchanged, so it takes no part in the version
check, so there is no conflict to report — and the original uniqueness violation was
rethrown, answering `INTERNAL_ERROR` on an ordinary race. Which is the exact failure
Section 22 names the case for.

**It answers `RESOURCE_BUSY`.** Decision 0158 places a refusal by one question: could
this same body, resubmitted unchanged, succeed? Here it plainly could — the retry
finds the line unchanged, writes nothing, and answers 201. So the request reached no
decision about the body, which is what `RESOURCE_BUSY` means, and Section 22's third
condition names it exactly: "a premise read before a lock no longer held under it". A
5xx also releases the idempotency key, which is what the retry needs.

**This ruling then claimed a fourth outcome does not exist, and that was wrong twice
over.** The argument was that `present` is a boolean, so a loser that disagrees with
the pre-race value must agree with what the winner wrote. It bounds the number of
*values* and not the number of *commits*: the loser re-reads holding no lock, and an
even number of further writes returns the stored value to the one it disagrees with, so
a correction race does produce a `VERSION_CONFLICT`. Two writes by one account are
enough.

And the case deleted on that argument had not been "passing for the wrong reason". It
submitted the **post**-race value, so it was a correction, it did take the lock, it did
assert a waiter, and it did race. What had changed was its *answer*: 409 became 503 when
an unchanged line stopped taking part in the version check. Re-pinning it at 503 was the
fix; deleting it removed the only coverage of the zero-row supersede.

Both are corrected in decision 0177, which restores that case and adds the conflict this
paragraph said was impossible.

## 3. Two derivations of one fact, and the audit entry took the wrong one

The row and its audit entry each resolved the responsible leader, from different
sources: the row took the frozen value from the superseded record, as Section 9
requires, and the entry re-resolved the assignment at the event instant.

They diverge whenever the person's assignment moved between the original write and the
correction — which an Admin backdating a reassignment (Section 5) produces
unconditionally, and which an ordinary same-day move produces too, since a record filed
during the service resolves against that moment while every later correction resolves
against the end of the day.

The consequence ran in both directions and both were the failure the `on_behalf` flag
had just been added to prevent: a leader correcting a record that is no longer theirs
was written as acting on their own, and a leader correcting their own was written as
acting on somebody else's, naming a leader the row does not name.

**Resolved once and used by both.** The fix is not a second correct derivation but the
removal of the second derivation, because two derivations of one fact are what allowed
them to differ.

## 4. A chain that overlapped itself

`superseded_at` was closed at `clock_timestamp()` — an instant *during* the transaction
— while the successor's `recorded_at` fell to the column default, `now()`, the instant
the transaction **began**. Every correction therefore stamped its successor as
beginning before its predecessor ended, by however long the transaction had already
run: the checklist descent, a scope check per line, and the wait on the predecessor's
own row lock. Two rows of one chain were both live across that interval.

Migration 0012 states the model this breaks — "the two ends of one period: the row is
the live record from the first until the second" — and constrains only *within* a row,
so nothing refused it. The closing instant was returned and handed to the successor —
which **did not work**, and decision 0177 records why: node-postgres renders
`timestamptz` as a JavaScript `Date`, so a `clock_timestamp()` of `…883142+08` came back
as `…883+08` and the successor still began 142µs before its predecessor ended. The
overlap shrank from the transaction's duration to under a millisecond and stayed, and
the case written to assert contiguity compared two truncated values and could not fail
on it.

**There is no constraint for this**, which is why it survived: a between-row check would
be a trigger, and migration 0012 constrains only within a row.

## What was corrected without changing a rule

- Inside `assertMayRecord`, the `dcc.correct_subtree` check — reached only when a
  record exists *and disagrees* — preceded the `dcc.submit_on_behalf` check, which
  depends on nothing stored. That is the oracle the previous batch closed one level up,
  left behind one method down. Harmless under role defaults, a Section 8 disclosure
  under a Whole Church `dcc.take_attendance` grant that Section 7 explicitly permits,
  and free to reorder.
- Migration 0012 justified `>=` with Section 5's zero-length-correction argument,
  transplanted. Sections 9 and 14 define no such operation, so the case is unreachable
  and the operator is chosen on the narrower ground that it is the looser of the two.
  Decision 0100's pattern, recurring.
- The DTO gained a sentence saying an omitted version "fails safe" in the same commit
  that made it false for the agreeing case.
- The new unit spec's docblock said nothing in it reads a clock, beside a case
  iterating `Date.now()`.

## What the constraint caught on the day it was added

Two `cell_attendance` fixtures in `test/database/attendance.spec.ts` stamped
`superseded_at` from the host clock against a `recorded_at` from the database, and
migration 0012 refused them. They had been green since the table existed, which on this
branch means since migration 0011 three commits earlier — they never reached `main`. That is the
argument for a constraint over a convention, made by the constraint rather than about
it.

## The migration policy clause that has no mechanism

`CLAUDE.md` requires "snapshot before, reconcile after" for any migration touching
attendance, and to re-run Section 20's reconciliation test. Migration 0012 rewrites no
row, so there is no state to snapshot; Section 20's test does not exist, because
reporting is Stage 5. Both halves are now argued in the migration itself rather than
passed over — a migration that simply said nothing would look like one that had not
read the policy. Whether the clause binds a constraint-only migration is left to
whoever writes that test.

---

Decision 0176, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Eleven on the DCC recording review, and the one that was a disclosure](0175-eleven-on-the-dcc-recording-review-and-the-one-that-was-a-disclosure.md) | Next: [2026-08-31 — Six on the third pass, and a fix that was never applied](0177-six-on-the-third-pass-and-a-fix-that-was-never-applied.md)
