# 2026-08-29 — A Cell is placed in the tree by its leader, and a move is two changes


Stage 3 slice 3: Cell membership. Section 10 specifies it closely enough to build,
and three things it does not settle had to be decided.

**`Target` gains a Cell, resolved through a port.** Section 7 already states the
rule — "a Cell, a Cell meeting, a membership or a leadership resolves through the
Cell's leader as of the period being viewed, falling back to its last leader where
the Cell is closed" — and `scopes.ts` already anticipated it: a Cell target "arrives
with the module that owns it". This is that module.

**A port rather than a direct call, because the alternative is a cycle.** `cells`
owns `cell_leaderships`, so only `cells` may answer; and `cells` imports
`AuthorizationModule` to ask its own authorization questions, so a dependency the
other way would close a loop. The interface lives with the guard, the implementation
with the table, and `AppModule` binds them — the inversion `EMAIL_PORT` already uses
here. Absent, the guard denies, which is what `scopes.ts` says of a target the
resolver has no rule for.

**What that buys is that section 10's list of holders is never restated.** "The
Cell's current leader, over their own Cells; any leader upline of that Cell's leader,
acting within their own authorized pastoral subtree; Admin; Senior Pastors" is
exactly what `OWN_SUBTREE`, `NETWORK` and `WHOLE_CHURCH` already mean once the target
is the Cell's leader. Nothing in the service enumerates roles.

**The guard resolves the Cell, deliberately not the person being added.** Section 10
says membership need not mirror pastoral assignment — "a person may be pastorally
under one leader and a member of another leader's Cell" — so resolving scope against
the member would refuse exactly what that sentence permits. Pinned by a case that
adds somebody from outside the actor's own subtree.

**A move is an add, and it is two membership changes rather than one.** A person
holds at most one active membership, so adding somebody who already belongs
elsewhere *is* section 10's move. One operation rather than two, because two would
let a client perform half of it.

**The source Cell is checked in the domain layer, and section 10 does not spell this
case out.** The guard resolves the destination, which is the request's primary
target; section 7 settles that a rule about a second object is a check in the owning
module. Without it a leader could pull anybody in the church into their own Cell —
ending a membership in a Cell they have nothing to do with, and moving that person
out of another leader's denominator, with no involvement from the leader who holds
them. That is the shape section 5 forbids for pastoral assignment (authorization case
1, pulling from a sibling branch), reached through the relationship section 1 keeps
separate from it.

This is a reading rather than a quotation: it is what "over their own Cells" means
when an operation touches two. Admin and the Senior Pastors are unaffected, an upline
leader is unaffected, and only a peer taking from a peer is refused — which is a
pastoral conversation rather than a system action. Listed as open below, because
section 10 could as easily be read the other way and the difference is visible to a
leader.

**The same-Network rule needed a domain check as well as the trigger, and a test is
what found that.** Migration 0009 carries `cell_memberships_same_network` as a
*deferred* constraint trigger, so it raises at COMMIT as a raw `check_violation` —
which `ApiExceptionFilter` does not recognise and renders `INTERNAL_ERROR`. Adding a
member of the other Network was a 500 until a case asked for the error code rather
than only for a failure. The constraint remains the enforcement, because it holds
under a concurrent Network change that this check would be stale for; what the check
adds is an answer.

Three mutations verified: the source-Cell check, the same-Network check, and the
guard resolving the Cell rather than the member — each reddening exactly its own
cases.

**One `architecture-guardian` pass, nine findings, and the four that were live are
worth keeping.**

**A second path parameter reached a `uuid` column unvalidated.** §7 says a route with
a path parameter the guard does not resolve against must validate it itself, and this
is the first route in the API with two: the guard resolves the Cell, `ValidationPipe`
skips a `String` metatype, and `CanonicalIdentifierPipe` canonicalizes without
throwing — so `DELETE .../members/not-a-uuid` raised `22P02` and rendered
`INTERNAL_ERROR`. `ParseUUIDPipe` fixes it, with an exception factory, because the
pipe's own `BadRequestException` is a 400 carrying a body no client of this API is
written against.

**The source-Cell refusal disclosed a Cell membership and a Cell ID.** §8's closed
list forbids both for a person outside the searching leader's pastoral scope — and
this refusal is reached exactly for such a person, because the guard resolves against
the destination Cell rather than the member. Names are church-wide, so any Leader
could take a UUID out of a search, submit it against their own Cell, and read back
both facts, writing nothing. It now names no Cell and does not say the person belongs
to one. The Network refusal beside it may name Networks: Network is one of the five
fields §8 publishes.

**A Cell the guard could not place answered `CAPABILITY_DENIED`.** False about the
actor's grants — §7 makes the code name the half that failed — and it made the
refusal *distinguishable* from the one an existing out-of-scope Cell gets, which is an
existence oracle over Cell identifiers, the thing refusing rather than answering 404
was supposed to prevent. Both are `SCOPE_DENIED` now, which is what the guard already
does for an Account target resolving to no Person.

**No person lock.** Every writer of a person-scoped edge in `people`, `hierarchy` and
`networks` takes one, and a membership is such an edge — `cell_memberships_one_open`
is over the person. Without it, two concurrent adds of the same person both insert and
the second raises `23505`, and a Network change committing between the same-Network
check and COMMIT raises `check_violation` at COMMIT. Neither code is classified, so
both were 500s.

**Three smaller ones.** §21 names "Cell membership added, moved, **or ended**" and the
first version had two actions and no `moved`, so a move was searchable only by
inspecting a payload — a move is one action and is now one entry carrying both Cells.
`cell_id` carried three different values across two endpoints, against §22's "one
concept carries one field name": it is the `CELL-000000` handle everywhere now, with
the UUID as `id` or `*_uuid`, which is what slice 2 established. And the three refusals
this service makes about a Person — archived, merged, already a member — were enforced
in code and stated in no section; §10 now carries them, as §5 already does for the
archived pastoral leader.

**Two test lessons, and the second is one I repeated.** The DELETE route's
`current.cell_uuid !== cellId` clause is its entire cross-Cell authorization —
without it a leader scoped to their own Cell could end a membership held anywhere in
the church — and the case for it gave the person no membership at all, so it entered
the other branch and left the clause unfalsifiable. That is the disjunction-with-one-
member shape slices 1 and 2 each shipped once.

And the ordering in `leaderForScope`: I wrote that `ended_at DESC NULLS FIRST` was
"the key that does the work", **twice**, once after the review corrected me — and
neither version was right. What implements §7's fallback is the *absence* of an
`ended_at IS NULL` filter; `started_at DESC` picks the right row in every ordinary
history, because leadership is contiguous; the `ended_at` key decides only the pair a
§5 correction leaves sharing a `started_at`. Each is now pinned by the mutation that
reaches it, and the tie-break case fixes the corrected row's id to the lowest possible
value so the `id DESC` fallback loses deterministically — the same construction slice
1 needed, for the same reason.

Six mutations verified in the fix batch: the DELETE clause, the closed-Cell fallback,
the closed-Cell refusal, the tie-break key, the `person_id` validation, and the
source-Cell scope check.

**A second pass on the fixes found nine more, two of them live defects the first fix
batch introduced — one in each of its two structural changes.**

**The guard's refusal ran before the capability check.** Answering `SCOPE_DENIED`
from `resolveTarget` put it ahead of `authorize`, which checks the capability first
and the scope second — so an actor holding no `cell.manage_membership` at all was
told a scope refusal for a request whose capability half was never evaluated, and §7
makes the code name the half that failed. It also left the two refusals
distinguishable — by code for that actor, by message and `details` for every other —
which is the existence oracle over Cell identifiers the change was made to close. The
precedent cited for it was misdescribed too: the Account path returns null *inside*
`scopeCovers`, after the capability check, and produces the identical message and
details for an absent and an out-of-scope target. A Cell that cannot be placed is now
handed a target that resolves to nobody, so both refusals come out of `authorize` in
one shape.

**The person lock made the write instant wrong.** `now()` is transaction start, which
is *before* the lock is waited for — so a request that queued behind another writer
stamped its rows with the instant it arrived. Interleaved: T2 begins at 99 and blocks;
T1 begins at 100, opens a membership, commits; T2 wakes, reads T1's row as current,
and closes it at 99. `cell_memberships_period_ordered` then raises at the statement,
so the lock turned a `23505` into a `23514` — one 500 into another. The docblock
argued the reverse of the truth, rejecting a JavaScript instant because it "can land
before a row it must not precede": it is `now()` that can, because the row to be
superseded committed before this transaction was allowed to proceed.
`clock_timestamp()` is the value taken after the wait, on the clock the columns are
compared against.

**A comparison that fails open used `===`.** The already-belongs check compares a
client-supplied path value against one out of a `uuid` column, and a mis-cased
identifier would skip the refusal and close and reopen the membership *in the same
Cell* — the spurious history boundary §10 forbids, with a `moved` entry naming one
Cell twice. §7's 2026-08-23 rule is that a check failing open normalizes again rather
than relying on the boundary pipe; `remove`'s equivalent fails closed and was left.

**Two more statements that were false, both in the batch written to fix false
statements.** The no-leader refusal stopped naming a Cell and went on asserting the
person belongs to one, which is the §8 fact — half a fix, described as a whole one.
And the lock comment claimed it ordered a Network change against the same-Network
check, when that check reads two Networks and the lock is taken on one of the two
people: the Cell leader's side is uncovered, which migration 0009 already names as
the widest of its three uncovered paths.

**`leaderForScope`'s ordering was described backwards for the third time.** The query
read `ended_at DESC NULLS FIRST` first while the paragraph called `started_at`
primary — the reverse — and the closing claim that migration 0009 "carries the same
three for the same reasons" was false, because 0009 orders them the other way. The
query is reordered to match 0009 rather than the prose reworded again, so the code,
the comment and the migration now agree. Three versions of one paragraph, two of them
written after a review corrected it, is the strongest case this log has for describing
a mechanism from the mechanism rather than from the last thing said about it.

***Superseded** by the fourth pass below: `ParseUUIDPipe` with no `version` option is
as loose as `isUuid`, so the 422 described here never happened and the decision stands
on section 22's single error envelope instead. Left in place rather than deleted, per
this log's convention.* **`ParseUUIDPipe` was a fourth UUID predicate.** It carries
`validator`'s own, which
refuses values this API accepts everywhere else — `01234567-89ab-cdef-0123-456789abcdef`
among them — so one parameter of one route answered 422 for identifiers the `{id}` in
the same path takes, and §3 permits a client-generated Person UUID. `UuidParamPipe`
uses `isUuid`, which `identifiers.ts` exists to be the single copy of.

**And the vacuous test was in the case written to pin field naming.** It matched both
handles by shape, so swapping `cell_id` and `moved_from_cell_id` passed — against the
exact defect it existed for. Two weaker ones with it: the §8 assertion excluded the
source Cell's UUID and not its `CELL-000000` handle, which is what §8 calls a Cell ID;
and the audit case justified its tie-break by an intra-transaction tie that case does
not have.

**Three fixes needed a test that did not exist, and two of those took a second
attempt.** The lock-instant case first held an undispatched supertest object, so
nothing ever blocked and it passed against the defect — the lazy-supertest fault
CLAUDE.md already records once, at `19dfe3c`. It now dispatches and polls until a
backend is genuinely blocked. And the failing-open comparison is unreachable through
the API at all, because the identifier pipe is global — so it is called directly with
an uppercase identifier, which is what the 2026-08-23 ruling prescribes for exactly
this and which no end-to-end case can substitute for.

Nine mutations verified across the two fix batches.

**A third pass, scoped to the second fix batch, found four things and no behavioural
defect.** That is the convergence the two before it did not show, and the scoping is
part of why — the same shape slice 1 needed on its fourth pass. Both structural
mechanisms this batch introduced were traced and confirmed: the `NIL_UUID` target
makes an absent Cell and an out-of-scope one indistinguishable at every scope value
that refuses — `OWN_SUBTREE`, `SUBTREE_EXCL_SELF` and `NETWORK`, each producing one
`ScopeDeniedError` message and one details payload — but **not** at `WHOLE_CHURCH`,
where `scopeCovers` returns true before the target is read and the two answers are a
`NOT_FOUND` and a 201. The unqualified claim is false and this same entry says so forty
lines below it, which is the fault it exists to record,
and `clock_timestamp()` is read after the lock in both methods with the two writes of
a move still sharing one instant. The `ORDER BY` reorder is equivalent in every state
migration 0009 permits — which also means nothing can fail against reverting it, and
that is declared rather than left to be discovered.

**`UuidParamPipe`'s stated reason was false, and both this log and the file asserted
it without checking.** The claim was that Nest's `ParseUUIDPipe` "carries `validator`'s
own predicate", pins the version and variant nibbles, and would refuse
`01234567-89ab-cdef-0123-456789abcdef`. Executed against the installed package it does
not: with no `version` option it uses a table of its own whose `all` entry is the same
loose pattern as `isUuid`. The 422 this entry said had happened never happened. The
decision stands on the reason given second — section 22 fixes one error envelope and
`BadRequestException` is not it — and `isUuid` is still right, because
`identifiers.ts` exists to be the single copy of that question.

**What the check surfaced instead is a real split, now escalated.** The predicate that
*does* pin the nibbles is `class-validator`'s `@IsUUID()`, which every DTO uses. So an
identifier in a **body** is validated strictly and one in a **path** loosely, and
`POST /cells/{id}/members` would refuse as `person_id` a value the `DELETE` beside it
accepts. Every identifier in the database is a v4, so it is a consistency question
rather than a defect.

**The concurrency poll was keyed on nothing, and justified by the wrong fact.** It
looked for any active backend blocked on any lock and cited `--runInBand` — which
bounds the jest suite and not the PostgreSQL instance. `pg_stat_activity` is
cluster-wide, this machine also carries `dfc_dev`, and in CI the test role is a
superuser, so there the predicate matched every blocked backend in the cluster. What
was keeping it honest locally is a property of the *role* — a non-superuser reads
other roles' backends as null — which stops holding the moment a second process
connects as the same role. The waiter's PID is genuinely unknown, being a pooled
connection inside the application; the **lock key is not**, and `pg_locks` keyed on it
in this database names exactly the wait being waited for.

**Section 22 names the mirror image of what the guard now does.** It says: "where
revealing that a record exists would itself disclose something, return `NOT_FOUND`
rather than a denial". This change makes an absence look like a *denial*. Both close
the oracle; only one is the remedy written down, and the comment credited section 22
for the direction not taken. It also leaves the API answering both codes for one fact
— `CellsMembershipService` answers `NOT_FOUND` for an absent Cell to a Whole Church
actor, because `scopeCovers` returns true before the target is read. Whether a Cell's
existence is a case that rule covers is escalated: section 22 settles it for a Person
("Section 8 already discloses minimal identity church-wide by design") and for nothing
else.

**And the no-leader refusal took two attempts and still asserted the protected fact.**
The first stopped naming the Cell and went on saying the person belongs to one; the
second said "that membership", which presupposes the same fact one word further in.
The branch is unreachable — a Cell with no leadership row can hold no membership — and
that is precisely why a wrong sentence survived two corrections in it.

Across three passes on this slice: nine findings, nine, then four, the last with no
behavioural defect. Twelve mutations verified in total.

---

Decision 0136, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-29 — Direct creation, and a subtree check where Section 2 asks for Whole Church](0135-direct-creation-and-a-subtree-check-where-section-2-asks-for.md) | Next: [2026-08-29 — Six rulings the closure endpoint needed, and two the review raised](0137-six-rulings-the-closure-endpoint-needed-and-two-the-review.md)
