# 2026-08-29 — The closure ordering and the closure floor, settled by running the database


The two rulings withdrawn from the closure pre-flight (#42), and the reason they are
recorded here rather than re-argued: each had been written three times in prose and
refuted three times, the last by `architecture-guardian` reproducing a deadlock. The
standing instruction was to build the mechanism first and let `SKILL.md` record what
survived, so the branch opened with a harness and no endpoint.

**The harness measured the unfixed world first, and that is what made it useful.** Two
of its four cases asserted that a deadlock *occurs*. Applying the candidate ordering
turned both red — the second closure waits at the bound instead of cycling — and only
then were they rewritten as the cases the ordering must keep green. A harness written
against the fixed world could not have shown the fix worked.

**The ordering has three clauses and each is held by a case that fails without it.**

*Advisory locks on people first, then the `cells` rows.* A membership write already
takes that pair in that order, so it was fixed by an existing writer rather than free
to choose. The reverse was staged and PostgreSQL answered `40P01`.

*Every `cells` row up front, in one order.* Ascending canonical identifier, because a
`uuid` comparison is case-insensitive and two callers naming one Cell in different
cases would otherwise sort it to different positions — the third place on this project
that defect has been reachable.

*Each row taken once, at the final strength.* **This is the clause every prose version
missed.** Both parties taking every row shared and then upgrading their own to
exclusive deadlock exactly as if nothing had been sorted, because the upgrade is not
sorted. So the closing Cell is taken `FOR NO KEY UPDATE` — what its own `UPDATE`
takes — and a destination `FOR SHARE`, which is all the closure needs and which
`FOR UPDATE` would have made expensive: that conflicts with the `FOR KEY SHARE` a
`cell_memberships` insert takes through its foreign key, so closing one Cell would
block every concurrent add into every Cell it disperses into.

**What unblocked it was not a better ordering but a different reading of the
operation.** Every earlier attempt assumed a closure must read its member list before
knowing whom to lock, which is a read another transaction can invalidate. It does not:
Section 10 already requires an explicit decision about every member, so the client
sends the list and the people are an input. What the operation then owes is a check
that the list is the Cell's actual membership, made after the locks — Section 14's
version check reached through a membership list. A member added or removed since the
client read the roster refuses the closure and asks for it to be re-read.

**The floor was blocked behind a question, and the question had to be answered by
narrowing a rule rather than reusing it.** Section 10 says no row of a closed Cell may
end after the Cell did, and whether that reached category and schedule rows was open.
It does — expressed as **in force at or after the closure** rather than **ends after
it**, which differ on exactly one case: a zero-length row, in force at no instant.

Admitting that case is what makes a Cell closable at all. A schedule change takes
effect at the start of the following month, so a Cell with one queued holds two rows
carrying next month's timestamps, and neither can be ended at an earlier closure
because `period_ordered` refuses a period ending before it starts. Under the literal
wording such a Cell is closable by nobody. The closure instead ends each row at the
later of the closure and the row's own start, so a change that will never take effect
goes inert.

That is also what makes the floor statable: category and schedule rows contribute **no
term**, because that write is satisfiable for any date. A floor including them sat in
the future for every rescheduled Cell, which is how two of the three withdrawn
formulations died. What remains is two terms over two tables — the start of every open
leadership and membership row, and the end of every closed one — and the bound is
**inclusive**, unlike Section 4's, because a closure at exactly an open row's start
closes a relationship that genuinely had no duration.

Reusing Section 10's own neighbouring wording verbatim is what produced the unclosable
Cell, which is Section 25 rule 19 met in the one place the pre-flight had been warned
about it. The reason that rule has its shape — a leadership or membership row can
always be ended at the closure instant — is exactly the reason it does not carry.

**Two rules were unpinned when first written, and both are recorded rather than
quietly fixed.** Term (b) of the floor could be deleted with the whole suite green,
because every floor case bound on an *open* row — the identical gap Section 5's own
backdate floor had on 2026-08-23. And the in-transaction scope re-check Section 10
requires could be deleted with everything green, because every case was decided the
same way by the guard; separating the two layers needs the guard's answer made stale
on purpose, which is a concurrent handover. The harness's own sort had the same
problem: removing it left all five cases passing, because nothing interleaved the two
acquisitions.

**And one thing Section 10 had promised was still owed.** It said the destination of an
ordinary membership move would be re-checked inside its transaction "with the closure
endpoint, which builds the mechanism". The mechanism is built, so that half is built
too — the membership endpoint had been re-checking only the source Cell, which the
guard never resolved, and leaving the destination on an answer taken before the request
queued.

Written to `SKILL.md` Sections 5, 10 and 22, and to migration `0010`. Verified by
grepping for each rule rather than by asserting it here, this log having recorded at
least six false "written to Section x" claims.

---

Decision 0139, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — A second schedule change corrects the pending one](0138-a-second-schedule-change-corrects-the-pending-one.md) | Next: [2026-08-29 — Twelve findings on the closure, and the three the review escalated](0140-twelve-findings-on-the-closure-and-the-three-the-review.md)
