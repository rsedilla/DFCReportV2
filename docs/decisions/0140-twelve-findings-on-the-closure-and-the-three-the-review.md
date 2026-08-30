# 2026-08-29 — Twelve findings on the closure, and the three the review escalated


`architecture-guardian` on the closure branch. **It could not construct a cycle**, and
said so having traced every pair — two closures crossing, closure against a move in
either direction, closure against an add into the closing Cell and into a destination,
closure against a configuration change, and the row locks the deferred triggers in 0009
and 0010 take at COMMIT. The property carrying it is that no `cells` row is ever held
while an advisory lock is waited for, and that every lock a commit-time trigger takes is
already held at equal or greater strength. That half of the work stood.

Everything it found was elsewhere, and two were live 500s.

**A backdated dispersal into a Cell created later was a raw `check_violation`.** The
destination check resolved the Cell's leader with `leaderForScopeWithin`, which is
section 7's rule for a *scope* — current, falling back to last, ignoring dates —
while `assert_membership_same_network` resolves the row *covering* the membership's
`started_at`. `CellsMembershipService` already records that the two "coincide in every
state migration 0009 permits" and that keeping them agreeing is something to watch
rather than something the code guarantees. A backdated closure is the state where they
stop: a membership dated February in a Cell created in August has no leader to compare
against, the scope rule answers with the current one, and the deferred trigger raises at
COMMIT. `leaderAsOfWithin` is the second question asked properly.

**A closure reasoned `OTHER` with no note was a 500**, because the DTO's docblock
described conditional validation the decorators did not carry — a rule stated in a
comment and enforced nowhere, which is the shape this log keeps recording. The same
block also claimed a note was "refused otherwise", which was false in the other
direction.

**Three statements were false of the code**, and one was a promise a file made about
itself. `postgres-errors.ts` said its narrowness "lands with the closure endpoint,
which is the first operation that can produce `40P01` in ordinary practice"; the
endpoint landed and the predicate was not widened, so a deadlock still rendered
`INTERNAL_ERROR` against section 5's own rule. `cell-lock.ts` then asserted the
opposite of that. And the closure service cited a test file that does not exist —
`api/test/cells/closure-floor.e2e.spec.ts`, for cases living in
`api/test/api/cell-closure.e2e.spec.ts`.

**Section 21 requires an audit entry for the leadership ending and the closure wrote
none**, on the reasoning that it "is not a separate decision, and its date is the
closure's". That is the reasoning the same commit *rejects* twelve lines earlier for
memberships — a dispersal is a move and must be findable as one whichever operation
performed it — and section 21 makes no exception for leadership.

**Section 5's own new lock-strength rule was broken by an existing writer.**
`CellsConfigurationService` took `FOR UPDATE` on a `cells` row it does not write, which
the rule this branch added refuses: `FOR NO KEY UPDATE` conflicts with itself, which is
all that service needs, and does not conflict with the `FOR KEY SHARE` a membership
insert takes through its foreign key. Writing a rule and leaving the neighbouring caller
non-compliant is how a rule becomes advisory.

**And the `ResourceBusyError` branch of the floor refusal is unreachable**, with a
comment claiming a reachability the strict comparison above it excludes. It was copied
from `PeopleReassignmentService`, where the identical shape **is** reachable because
section 5 lets Admin backdate a pastoral row; Cell leadership and membership rows cannot
be backdated, so the reason does not carry. Section 25 rule 19, in the branch whose own
entry is about rule 19. Kept as a fail-safe with an honest comment rather than deleted,
because the floor is read from rows rather than guaranteed by a constraint.

**Three Stop Conditions, all three settled here.**

*What reason a backdated closure requires.* The note, not the closure reason. Every
closure carries a reason from the fixed list, so reading section 7's "always requires a
reason" as satisfied by it makes the requirement vacuous. What is owed is an explanation
of the backdating, which is what section 5 requires of a backdated reassignment and for
the reason section 10 gives: a backdated closure erases the scheduled-meeting count a
coverage line is read against.

*Whether a closure may rewrite an already-closed configuration row's `ended_at`.* It
may, and section 10 now says so rather than leaving the code to do it silently. This is
the one write in the system that shortens a closed effective-dated period in place. It
is confined — the value replaced always reaches beyond the closure, so what is removed
is a period the Cell no longer existed for — and the alternatives are all worse: leaving
the row is the forbidden state, refusing makes a rescheduled Cell unclosable, opening a
replacement records a schedule for a Cell that has none.

*Whether an explicit effective date of today is backdating.* It is not. Section 10 says
"earlier than the current day", and the code asked for the capability on any supplied
date — stricter than the specification, with the difference unrecorded, and refusing a
leader `SCOPE_DENIED` for a request section 10 permits. The floor is what actually
refuses such a date, which is the more useful answer.

**One thing the review found that needed building rather than fixing.** Making the
member list mandatory turned `GET /api/v1/cells/{id}/members` from a documented-but-
unbuilt route into a blocker: the closure refuses any list that is not exactly the
current membership, so no client could construct a valid request. It is built, guarded
by `cell.manage_membership` against the Cell — the same target the write routes declare,
and a derivation rather than a new rule, since section 7's capability list is closed.
The cost is escalated rather than hidden and is listed as open below.

---

Decision 0140 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — The closure ordering and the closure floor, settled by running the database](0139-the-closure-ordering-and-the-closure-floor-settled-by.md) | Next: [2026-08-29 — Ten more on the fixes, and the one the fixes introduced](0141-ten-more-on-the-fixes-and-the-one-the-fixes-introduced.md)
