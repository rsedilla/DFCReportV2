# 2026-08-29 — Direct creation, and a subtree check where Section 2 asks for Whole Church


Stage 3 slice 2: the `cells` module, the one Cell-creation path the initial-encoding
phase relaxes, and the `LEADER` account provisioning that path exists to enable.
Mostly Sections 2, 6, 10 and 11 followed rather than decided. What is recorded here is
the authorization, which took a review pass to get right.

**Three checks, and Section 2 names all three.** The guard declares
`cell.approve_leadership` — the decision being made, Admin's alone, and in
`WHOLE_CHURCH_ONLY` so a narrower grant covers nothing. The domain layer checks
`cell.manage_leadership` **against a `church` target**, because Section 7 settles that
a guard resolves one capability against one target and Section 2 asks for both "at
Whole Church scope". And the actor must hold the `ADMIN` role, read from
`account_roles` through the transaction.

**The first version resolved the second capability against the prospective leader, and
that was a live authorization gap.** `cell.manage_leadership` is not
Whole-Church-only; every role default carries it, and `LEADER` carries it at
`OWN_SUBTREE` with the actor themselves included. So a Leader holding an Admin-issued
Whole Church grant of `cell.approve_leadership` — which Section 7 permits explicitly —
passed the guard and then satisfied a subtree check against their own disciple, or
against themselves. That is Section 10's own sentence verbatim: "`cell.manage_leadership`
at own/subtree scope would let a leader hand a Cell to their own disciple with nobody
else involved — the outcome the creation workflow exists to prevent, reached by the one
route it did not cover." Naming themselves is what Section 10 forbids outright.

The test that was supposed to pin that check pointed such an actor at somebody
**outside** their subtree, which is the half that was already refused. The half that
was not had no case at all.

**The `ADMIN` role is required, and the capabilities alone are not it.** Section 2
settles the identical ambiguity one paragraph away, for the tree import: "The role is
required, and the capabilities alone are not enough… an implementer following the
stated condition accepts a `LEADER` account holding both at Whole Church, which
Section 7 lets Admin grant." Sections 2 and 10 both give direct creation to Admin, and
the escalation the capabilities-only reading admits is larger here, because a Cell
created outside request-and-approve mints a Cell Leader. Whether Sections 2 and 10
should say so in the same words Section 2 uses for the import is listed as open below.

**Authorization is read before the transaction opens.** `authorize` reads
`account_roles`, `capability_grants` and, for a subtree scope, the tree — all on the
pool. The first version called it *inside* `db.transaction()`, which is the liveness
hazard Section 24 names: the pool is bounded at ten with no acquisition timeout, so
ten concurrent creations would hold ten connections and each wait for ever on an
eleventh, with the liveness probe sharing that pool. `PeopleReassignmentService` is the
established shape and this follows it. The role check stays inside, because it reads
through the transaction's own executor rather than the pool.

**The account step is not in the same transaction.** Section 10 has approval proceed
to it, and Section 7 provides in terms for "an actor holding only the first, who
records the assignment and leaves the account step pending" — so the two are separately
authorized actions. Folding it in was rejected on Section 6's own shape: the activation
email is sent after the transaction commits, and a delivery failure would then be a
fact about a Cell. Section 6's dual-authorization rule is therefore not owed here, and
becomes owed with the approval workflow, where Section 10 puts the account step inside
the same transaction.

**What that costs is an audit entry, and Section 21 already names it**: "Cell
leadership assignment left with account provisioning pending". Every Cell this path
creates is in that state, and nothing else in the system would record it. Written
unconditionally rather than only where the actor lacks `accounts.manage`, because
Section 21's item names a state rather than an actor.

**`LEADER` provisioning arrives with the check that qualifies it**, which is what
`account-provisioning.service.ts` said Stage 3 would do in one change. Section 11
defines a current Cell Leader as a conjunction — an active leadership assignment **on
an `ACTIVE` Cell** — and `CellsReadService` asks both halves.

**Only one of those halves can be shown to matter, and that is recorded rather than
left for somebody to delete.** Migration 0009 refuses a CLOSED Cell holding an open
assignment, so the state where the two disagree is unreachable through any operation.
A first attempt at a case for it closed the Cell — which also ends the leadership — so
each condition sufficed alone and mutating *either* left the suite green: a disjunction
pinned, with neither member. A handover separates them, because the Cell stays `ACTIVE`
while the outgoing assignment closes. The `cells.state` half is kept anyway, for the
reason this repository has already accepted twice: the rule making the two agree is a
constraint trigger, and `pg_restore --disable-triggers` skips one.

**Three test faults, all the same class, and all found by mutation rather than by
reading.** The scope case pinned the wrong half, above. The Senior Pastor case never
called `nameSeniorPastors`, so the role row was not honoured and the account held no
capabilities at all — it was refused for a reason having nothing to do with this
endpoint, while its comment claimed it pinned which capability the guard declares. It
does not, and with the role check in place it cannot: a Senior Pastor is refused by
role whichever capability the guard names. That is pinned by the Leader case instead,
and the comment now says so. And `actor_id` was written null on the category and
schedule rows while an authenticated actor was in hand, with no case looking — Section
10 gives both shapes an actor, and migration 0009's header says null there is for a
system action.

Six mutations verified: the phase gate, the qualification query's two halves
separately, the second capability's target, the role check, and the guard's declared
capability — each reddening exactly its own cases.

---

Decision 0135, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — The Cell schema, and a test that agreed with itself on one machine only](0134-the-cell-schema-and-a-test-that-agreed-with-itself-on-one.md) | Next: [2026-08-29 — A Cell is placed in the tree by its leader, and a move is two changes](0136-a-cell-is-placed-in-the-tree-by-its-leader-and-a-move-is-two.md)
